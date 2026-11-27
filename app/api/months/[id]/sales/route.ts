import { getUser } from '@/lib/auth';
import { getMonth, monthLabel } from '@/lib/data';
import { loadMonthSales } from '@/lib/salesData';
import { formatTime } from '@/lib/format';

const cell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const n2 = (x: number | null | undefined) => (x == null ? '' : x.toFixed(2));

/** The month's streams with sales and talent fees, in the Master Availability Sheet's column order. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return new Response('Not allowed', { status: 403 });
  const m = await getMonth(Number((await params).id));
  if (!m) return new Response('Not found', { status: 404 });
  const { rows, orphans } = await loadMonthSales(m.id, m.published_run_id);
  const head = ['Date', 'Start Time', 'End Time', 'Host', 'Brand', 'Period', 'Platform', 'Status', 'TikTok GMV', 'Shopee GMV', 'Total GMV',
    'Hours', 'GMV / Hour', 'Version', 'Method', 'Tier', 'Gross', 'Agency', 'Talent Fee', 'Payment', 'Notes', 'In published schedule'];
  const lines = [head.join(',')];
  for (const r of [...rows, ...orphans]) {
    const x = r.result, rate = x.rate, entered = r.tiktok_gmv != null || r.shopee_gmv != null;
    lines.push([r.date, formatTime(r.start_min), formatTime(r.end_min), r.host_name, r.brand, r.period, r.platform, r.status,
      n2(r.tiktok_gmv), n2(r.shopee_gmv), entered ? n2(x.totalGmv) : '', x.hours, entered ? n2(x.gmvPerHour) : '',
      rate?.label ?? 'No rate', rate ? (rate.method === 'split' ? 'Split comms' : 'Base + Comms') : '', rate?.tier ?? '',
      entered ? n2(x.gross) : '', entered ? n2(x.agency) : '', entered ? n2(x.fee) : '', r.pay_status, r.notes, r.streamId ? 'Yes' : 'No',
    ].map(cell).join(','));
  }
  const name = `sales-${monthLabel(m.year, m.month).replace(/\s+/g, '-').toLowerCase()}.csv`;
  return new Response('﻿' + lines.join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` },
  });
}
