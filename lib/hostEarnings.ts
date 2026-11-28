import { query } from './db';
import { loadRates } from './rates';
import { loadMonthSales, hasSales, type SaleRow } from './salesData';
import { splitHosts, type Rate } from './earnings';
import type { MonthRow } from './data';

/** Payment statuses that mean the host has been paid. */
const PAID = new Set(['paid', 'paid to host, pending payment from brand']);

export interface HostStream {
  key: string;
  streamId: number | null;  // the published stream it belongs to (null = sales for a stream since moved)
  month: number;            // 0-based
  date: string;
  start_min: number;
  end_min: number;
  brand: string;
  platform: string;
  period: string;
  hours: number;
  coHosts: string[];        // other hosts on a shared stream
  tiktok: number | null;    // the stream's GMV (not split)
  shopee: number | null;
  gmv: number | null;
  fee: number | null;       // this host's share of the talent fee
  state: 'paid' | 'due' | 'pending' | 'none' | 'upcoming';
  //  paid: fee paid to the host; due: fee worked out, not paid yet; pending: sales not entered / fee being worked out;
  //  none: no fee for this stream (e.g. a creator deal); upcoming: hasn't happened yet
}

/**
 * Every stream this host did (or shares) in a year, from each month's published schedule, with
 * their share of the talent fee. Only this host's own figures: no rates, agency share or other hosts' pay.
 */
export async function loadHostEarnings(host: { id: number; name: string }, year: number, today: string): Promise<HostStream[]> {
  const months = await query<MonthRow>('SELECT * FROM months WHERE year = $1 AND published_run_id IS NOT NULL ORDER BY month', [year]);
  const rates = await loadRates();
  const out: HostStream[] = [];
  for (const m of months) out.push(...await loadHostMonth(host, m, today, rates));
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
}

/** One month of the host's streams with sales and their share of the fee. */
export async function loadHostMonth(host: { id: number; name: string }, m: MonthRow, today: string, rates?: Rate[]): Promise<HostStream[]> {
  if (!m.published_run_id) return [];
  const name = host.name.trim().toLowerCase();
  const mine = (r: SaleRow) => r.host_id === host.id || splitHosts(r.host_name).some(h => h.toLowerCase() === name);
  const { rows, orphans } = await loadMonthSales(m.id, m.published_run_id, rates);
  const out: HostStream[] = [];
  for (const r of [...rows, ...orphans.filter(hasSales)]) {
    if (!mine(r)) continue;
    const hosts = splitHosts(r.host_name);
    const share = 1 / Math.max(1, hosts.length);
    const entered = hasSales(r);
    const fee = entered && r.result.fee != null ? Math.round(r.result.fee * share * 100) / 100 : null;
    const state: HostStream['state'] =
      !entered ? (r.date > today ? 'upcoming' : 'pending')
      : r.result.recorded && r.result.fee == null ? 'none'
      : fee == null ? 'pending'
      : PAID.has(r.pay_status.toLowerCase()) ? 'paid' : 'due';
    const gmv = r.tiktok_gmv != null || r.shopee_gmv != null ? (r.tiktok_gmv ?? 0) + (r.shopee_gmv ?? 0) : null;
    out.push({
      key: `${r.date}|${r.start_min}|${r.brand}|${r.platform}`, streamId: r.streamId, month: m.month,
      date: r.date, start_min: r.start_min, end_min: r.end_min, brand: r.brand, platform: r.platform, period: r.period,
      hours: (r.end_min - r.start_min) / 60,
      coHosts: hosts.filter(h => h.toLowerCase() !== name),
      tiktok: r.tiktok_gmv, shopee: r.shopee_gmv, gmv, fee, state,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
}

/** Years this host has published streams in (for the year switcher). */
export async function hostYears(): Promise<number[]> {
  return (await query<{ year: number }>('SELECT DISTINCT year FROM months WHERE published_run_id IS NOT NULL ORDER BY year DESC')).map(r => r.year);
}
