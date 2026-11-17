import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { monthLabel } from '@/lib/data';
import { fmtDate, formatTime } from '@/lib/format';

/** CSV in the same column layout as the sheet's Schedule tab. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return new NextResponse('Not allowed', { status: 403 });
  const { id } = await params;
  const run = await one('SELECT * FROM schedule_runs WHERE id = $1', [Number(id)]);
  if (!run) return new NextResponse('Not found', { status: 404 });
  const m = (await one('SELECT * FROM months WHERE id = $1', [run.month_id]))!;
  const rows = await query('SELECT * FROM scheduled_streams WHERE run_id = $1 ORDER BY date, start_min, room', [run.id]);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [['date', 'day', 'start time', 'end time', 'talent', 'brand', 'period', 'sale', 'platform', 'room']];
  rows.forEach(r => {
    const [dow, d, mon] = fmtDate(r.date).split(' ');
    lines.push([`${d} ${mon} ${r.date.slice(0, 4)}`, dow, formatTime(r.start_min), formatTime(r.end_min), r.host_name, r.brand, r.period, r.sale, r.platform, r.room]);
  });
  const csv = lines.map(l => l.map(esc).join(',')).join('\n') + '\n';
  const name = `schedule-${monthLabel(m.year, m.month).replace(' ', '-').toLowerCase()}-${run.label ? run.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'v' + run.id}.csv`;
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` },
  });
}
