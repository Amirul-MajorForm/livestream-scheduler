import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { query, one } from '@/lib/db';

/**
 * Ops only: quick edits from the Hosts grid.
 * Body { brandId, level: 'preferred' | 'regular' | 'excluded' } sets one brand preference;
 * body { active: boolean } switches the host on or off for scheduling.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const hostId = Number((await params).id);
  const body = await req.json().catch(() => null);
  const host = await one('SELECT id FROM hosts WHERE id = $1', [hostId]);
  if (!host || !body) return NextResponse.json({ error: 'Host not found' }, { status: 404 });

  if (typeof body.active === 'boolean') {
    await query('UPDATE hosts SET active = $2 WHERE id = $1', [hostId, body.active]);
  } else if (body.brandId && ['preferred', 'regular', 'excluded'].includes(body.level)) {
    const brand = await one('SELECT id FROM brands WHERE id = $1', [Number(body.brandId)]);
    if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    await query(`INSERT INTO host_brand_prefs(host_id, brand_id, level) VALUES ($1, $2, $3)
      ON CONFLICT (host_id, brand_id) DO UPDATE SET level = EXCLUDED.level`, [hostId, brand.id, body.level]);
  } else {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }
  revalidatePath('/admin/hosts');
  revalidatePath(`/admin/hosts/${hostId}`);
  return NextResponse.json({ ok: true });
}
