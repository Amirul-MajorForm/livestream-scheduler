import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { query, one, tx } from '@/lib/db';
import { readPreplannedFile } from '@/lib/preplannedFile';
import { monthLabel } from '@/lib/data';

export const maxDuration = 60;

/**
 * Ops only. Multipart form with `file` (.csv/.xlsx) and `mode`:
 *  - "preview": read and check the file, change nothing
 *  - "add": insert the valid rows (rows identical to an existing pre-planned stream are skipped)
 *  - "replace": delete this month's pre-planned streams, then insert the valid rows
 * The file is re-read and re-checked on import, so the preview can't be tampered with.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const monthId = Number((await params).id);
  const m = await one('SELECT * FROM months WHERE id = $1', [monthId]);
  if (!m) return NextResponse.json({ error: 'Month not found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const mode = String(form?.get('mode') || 'preview');
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose a .csv or .xlsx file' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'That file is too large (5 MB max)' }, { status: 400 });
  if (!['preview', 'add', 'replace'].includes(mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });

  const [hosts, brands, rooms, saleDays, existing] = await Promise.all([
    query('SELECT id, name, active FROM hosts'),
    query('SELECT id, name FROM brands'),
    query('SELECT name FROM rooms ORDER BY sort_order'),
    query('SELECT name, day FROM sale_days WHERE month_id = $1', [monthId]),
    query(`SELECT p.date, p.start_min, b.name AS brand, p.platform FROM preplanned_streams p JOIN brands b ON b.id = p.brand_id WHERE p.month_id = $1`, [monthId]),
  ]);
  const { rows, error, otherMonths } = await readPreplannedFile({
    fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()), year: m.year, month: m.month,
    hosts: hosts.map(h => ({ id: h.id, name: h.name, active: h.active })), brands: brands.map(b => ({ id: b.id, name: b.name })),
    rooms: rooms.map(r => r.name), saleDays: saleDays.map(s => ({ name: s.name, day: s.day })),
    // In replace mode nothing existing survives, so nothing counts as a duplicate.
    existing: mode === 'replace' ? [] : existing.map(e => ({ date: e.date, start_min: e.start_min, brand: e.brand, platform: e.platform })),
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (mode === 'preview') return NextResponse.json({ rows, otherMonths: otherMonths ?? 0, existingCount: existing.length, month: monthLabel(m.year, m.month) });

  const toInsert = rows.filter(r => !r.errors.length && !r.duplicate);
  const result = await tx(async c => {
    let removed = 0;
    if (mode === 'replace') removed = (await c.query('DELETE FROM preplanned_streams WHERE month_id = $1', [monthId])).rowCount ?? 0;
    const base = (await c.query('SELECT coalesce(max(sort_order), 0) AS n FROM preplanned_streams WHERE month_id = $1', [monthId])).rows[0].n as number;
    for (const [i, r] of toInsert.entries()) {
      await c.query(`INSERT INTO preplanned_streams(month_id, date, start_min, end_min, host_id, brand_id, period, sale, platform, room, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [monthId, r.date, r.start, r.end, r.hostId, r.brandId, r.period, r.sale, r.platform, r.room, base + i + 1]);
    }
    return { removed, added: toInsert.length };
  });
  revalidatePath(`/admin/months/${monthId}`);
  return NextResponse.json({
    ok: true, ...result,
    skipped: rows.filter(r => r.errors.length).length,
    duplicates: rows.filter(r => !r.errors.length && r.duplicate).length,
  });
}
