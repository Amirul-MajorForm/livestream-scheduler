import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { one, tx } from '@/lib/db';
import { monthRange } from '@/lib/data';

/** Replaces a host's availability for one month. Hosts may only edit their own, and only while the month is open. */
export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const hostId = Number(body?.hostId), monthId = Number(body?.monthId);
  const slots: { date: string; slot: number }[] = Array.isArray(body?.slots) ? body.slots : [];
  if (!hostId || !monthId) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  if (user.role !== 'admin' && user.hostId !== hostId) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const m = await one('SELECT * FROM months WHERE id = $1', [monthId]);
  if (!m) return NextResponse.json({ error: 'Month not found' }, { status: 404 });
  if (user.role !== 'admin' && !m.availability_open)
    return NextResponse.json({ error: 'Availability for this month is locked. Ask the ops team to make changes.' }, { status: 403 });

  const { start, end } = monthRange(m.year, m.month);
  const valid = slots.filter(s => typeof s?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    s.date >= start && s.date <= end && Number.isInteger(s.slot) && s.slot >= 0 && s.slot <= 6);

  const submittedAt = await tx(async c => {
    await c.query('DELETE FROM availability WHERE host_id = $1 AND date BETWEEN $2 AND $3', [hostId, start, end]);
    if (valid.length) {
      const params: unknown[] = [hostId];
      const values = valid.map((s, i) => {
        params.push(s.date, s.slot);
        return `($1, $${i * 2 + 2}, $${i * 2 + 3})`;
      });
      await c.query('INSERT INTO availability(host_id, date, slot) VALUES ' + values.join(',') + ' ON CONFLICT DO NOTHING', params);
    }
    const r = await c.query(`INSERT INTO availability_submissions(host_id, month_id) VALUES ($1, $2)
      ON CONFLICT (host_id, month_id) DO UPDATE SET submitted_at = now() RETURNING submitted_at`, [hostId, monthId]);
    return r.rows[0].submitted_at;
  });
  return NextResponse.json({ ok: true, count: valid.length, submittedAt });
}
