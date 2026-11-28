import { query } from './db';
import { loadRates } from './rates';
import { loadMonthSales, hasSales, type SaleRow } from './salesData';
import { splitHosts } from './earnings';
import type { MonthRow } from './data';

export interface AStream {
  year: number;
  month: number;          // 0-based
  date: string;
  start_min: number;
  end_min: number;
  hours: number;
  hosts: string[];
  brand: string;
  platform: 'tiktok' | 'shopee' | 'both';
  platformText: string;
  period: string;
  tt: number;             // TikTok GMV (0 when not entered)
  sp: number;
  gmv: number;
  fee: number;            // talent fee for the stream (all hosts)
  entered: boolean;       // has sales figures
  paid: boolean;
  mega: boolean;          // tagged Mega
  campaign: Campaign | null; // which sale it belongs to (Mega streams only)
}

export type CampaignType = 'dd' | 'mm' | 'pd';
export interface Campaign { type: CampaignType; phase: 'd1' | 'dday'; year: number; month: number }
export const CAMPAIGNS: { type: CampaignType; name: string; when: string }[] = [
  { type: 'dd', name: 'Double Digit', when: 'day = month (9.9, 10.10, 11.11)' },
  { type: 'mm', name: 'Mid-Month', when: '15th' },
  { type: 'pd', name: 'Payday', when: '25th' },
];

/**
 * The sale a date belongs to, by the usual calendar: Double Digit on day = month (D-1 the day before),
 * Mid-Month on the 15th (D-1 the 14th), Payday on the 25th (D-1 the 24th). The campaign's month is
 * its D-Day's month (31 Dec is D-1 of January's 1.1).
 */
export function campaignOf(date: string): Campaign | null {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear(), nm = next.getUTCMonth() + 1, nd = next.getUTCDate();
  if (d === m) return { type: 'dd', phase: 'dday', year: y, month: m - 1 };
  if (nd === nm) return { type: 'dd', phase: 'd1', year: ny, month: nm - 1 };
  if (d === 15) return { type: 'mm', phase: 'dday', year: y, month: m - 1 };
  if (d === 14) return { type: 'mm', phase: 'd1', year: y, month: m - 1 };
  if (d === 25) return { type: 'pd', phase: 'dday', year: y, month: m - 1 };
  if (d === 24) return { type: 'pd', phase: 'd1', year: y, month: m - 1 };
  return null;
}

const PAID = /^paid/i;
const platformOf = (p: string): AStream['platform'] => {
  const s = p.toLowerCase();
  return s.includes('tiktok') && s.includes('shopee') ? 'both' : s.includes('shopee') ? 'shopee' : 'tiktok';
};

/** Published streams (that have happened, or have sales) for the chosen years, with GMV and fees. */
export async function loadAnalysis(years: number[], today: string): Promise<AStream[]> {
  if (!years.length) return [];
  const months = await query<MonthRow>(
    'SELECT * FROM months WHERE year = ANY($1::int[]) AND published_run_id IS NOT NULL ORDER BY year, month', [years]);
  const rates = await loadRates();
  const out: AStream[] = [];
  for (const m of months) {
    const { rows, orphans } = await loadMonthSales(m.id, m.published_run_id, rates);
    for (const r of [...rows, ...orphans.filter(hasSales)]) {
      const entered = hasSales(r);
      if (!entered && r.date > today) continue; // upcoming
      out.push(toStream(m, r, entered));
    }
  }
  return out;
}

function toStream(m: MonthRow, r: SaleRow, entered: boolean): AStream {
  const tt = r.tiktok_gmv ?? 0, sp = r.shopee_gmv ?? 0;
  return {
    year: m.year, month: m.month, date: r.date, start_min: r.start_min, end_min: r.end_min,
    hours: (r.end_min - r.start_min) / 60,
    hosts: splitHosts(r.host_name),
    brand: r.brand, platform: platformOf(r.platform), platformText: r.platform, period: r.period,
    tt, sp, gmv: tt + sp, fee: entered ? r.result.fee ?? 0 : 0, entered,
    paid: PAID.test(r.pay_status),
    mega: r.period.toUpperCase() === 'MEGA',
    campaign: r.period.toUpperCase() === 'MEGA' ? campaignOf(r.date) : null,
  };
}

export async function analysisYears(): Promise<number[]> {
  return (await query<{ year: number }>('SELECT DISTINCT year FROM months WHERE published_run_id IS NOT NULL ORDER BY year DESC')).map(r => r.year);
}

/** Totals for a group of streams. `share` lets a shared stream count part of its GMV and fee. */
export interface Totals { streams: number; hours: number; tt: number; sp: number; gmv: number; fee: number; paid: number; entered: number }
export const emptyTotals = (): Totals => ({ streams: 0, hours: 0, tt: 0, sp: 0, gmv: 0, fee: 0, paid: 0, entered: 0 });
export function addTo(t: Totals, s: AStream, share = 1) {
  t.streams++; t.hours += s.hours;
  if (s.entered) t.entered++;
  t.tt += s.tt * share; t.sp += s.sp * share; t.gmv += s.gmv * share; t.fee += s.fee * share;
  if (s.paid) t.paid += s.fee * share;
}
