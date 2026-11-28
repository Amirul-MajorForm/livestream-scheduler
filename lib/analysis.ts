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
