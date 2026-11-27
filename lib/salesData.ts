import { query } from './db';
import { loadRates } from './rates';
import { rateGroupFor, computeFee, type Rate, type FeeResult } from './earnings';

export interface SaleRow {
  streamId: number | null;   // null = sales for a stream that's no longer in the published schedule
  saleId: number | null;
  date: string;
  start_min: number;
  end_min: number;
  host_name: string;
  brand: string;
  period: string;
  platform: string;
  status: string;            // tentative / confirmed (schedule)
  tiktok_gmv: number | null;
  shopee_gmv: number | null;
  pay_status: string;
  notes: string;
  group: Rate[];
  result: FeeResult;
}

const keyOf = (x: { date: string; start_min: number; brand: string; platform: string; host_name: string | null }) =>
  [x.date, x.start_min, x.brand, x.platform, x.host_name || ''].join('|');

/** Every published stream of the month with its entered sales and worked-out fee, plus orphaned sales entries. */
export async function loadMonthSales(monthId: number, runId: number | null) {
  const [streams, sales, rates] = await Promise.all([
    runId ? query(`SELECT id, date, start_min, end_min, host_name, brand, period, platform, status
      FROM scheduled_streams WHERE run_id = $1 ORDER BY date, start_min, brand`, [runId]) : Promise.resolve([]),
    query('SELECT * FROM stream_sales WHERE month_id = $1', [monthId]),
    loadRates(),
  ]);
  const salesByKey = new Map(sales.map(s => [keyOf(s as never), s]));
  const used = new Set<string>();
  const rows: SaleRow[] = streams.map(st => {
    const k = keyOf(st as never);
    const sale = salesByKey.get(k);
    if (sale) used.add(k);
    return build(rates, { streamId: st.id, saleId: sale?.id ?? null, date: st.date, start_min: st.start_min, end_min: st.end_min,
      host_name: st.host_name || '', brand: st.brand, period: st.period, platform: st.platform, status: st.status,
      tiktok_gmv: sale?.tiktok_gmv ?? null, shopee_gmv: sale?.shopee_gmv ?? null, pay_status: sale?.pay_status ?? '', notes: sale?.notes ?? '' });
  });
  const orphans: SaleRow[] = sales.filter(s => !used.has(keyOf(s as never))).map(s => build(rates, {
    streamId: null, saleId: s.id, date: s.date, start_min: s.start_min, end_min: s.end_min, host_name: s.host_name, brand: s.brand,
    period: s.period, platform: s.platform, status: '', tiktok_gmv: s.tiktok_gmv, shopee_gmv: s.shopee_gmv, pay_status: s.pay_status, notes: s.notes,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
  return { rows, orphans, rates };
}

function build(rates: Rate[], r: Omit<SaleRow, 'group' | 'result'>): SaleRow {
  const group = rateGroupFor(rates, r);
  return { ...r, group, result: computeFee(group, r) };
}

export const hasSales = (r: Pick<SaleRow, 'tiktok_gmv' | 'shopee_gmv'>) => r.tiktok_gmv != null || r.shopee_gmv != null;
