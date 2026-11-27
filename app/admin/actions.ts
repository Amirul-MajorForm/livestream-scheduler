'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '@/lib/auth';
import { query, one, tx } from '@/lib/db';
import { runAndSave, importDataset, monthLabel } from '@/lib/data';
import { parseWorkbook } from '@/lib/workbook';
import { parsePlatforms } from '@/lib/scheduler';
import { parsePctInput, parseTimeInput } from '@/lib/format';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const n = (f: FormData, k: string) => { const v = s(f, k); return v === '' ? null : Number(v); };
function back(path: string, msg?: string, kind: 'ok' | 'bad' = 'ok'): never {
  const [base, hash] = path.split('#');
  revalidatePath(base.split('?')[0]);
  const sep = base.includes('?') ? '&' : '?';
  // t= makes each success unique so pages can remount (reset) their add forms after it.
  redirect((msg ? `${base}${sep}${kind}=${encodeURIComponent(msg)}${kind === 'ok' ? '&t=' + Date.now() : ''}` : base) + (hash ? '#' + hash : ''));
}

/* ---------------- Months ---------------- */

export async function createMonth(f: FormData) {
  await requireAdmin();
  const [y, m] = s(f, 'ym').split('-').map(Number);
  if (!y || !m) back('/admin', 'Pick a month', 'bad');
  const copyFrom = n(f, 'copyFrom');
  // A month may already exist because a host opened it to enter availability early. If it has no
  // commitments or sale days yet, fill it in instead of refusing.
  const exists = await one(`SELECT id, (SELECT count(*)::int FROM commitments WHERE month_id = months.id)
      + (SELECT count(*)::int FROM sale_days WHERE month_id = months.id) AS filled FROM months WHERE year = $1 AND month = $2`, [y, m - 1]);
  if (exists && (exists.filled > 0 || !copyFrom)) back(`/admin/months/${exists.id}`, exists.filled > 0 ? 'That month already exists.' : undefined);
  const id = await tx(async c => {
    const src = copyFrom ? (await c.query('SELECT * FROM months WHERE id = $1', [copyFrom])).rows[0] : null;
    const pcts = [src?.bau_weekday_pct ?? 0.2, src?.bau_weekend_pct ?? 0.5, src?.mega_weekday_pct ?? 0.2, src?.mega_weekend_pct ?? 0.5];
    const r = exists
      ? await c.query(`UPDATE months SET bau_weekday_pct=$2, bau_weekend_pct=$3, mega_weekday_pct=$4, mega_weekend_pct=$5 WHERE id=$1 RETURNING id`, [exists.id, ...pcts])
      : await c.query(`INSERT INTO months(year, month, bau_weekday_pct, bau_weekend_pct, mega_weekday_pct, mega_weekend_pct)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [y, m - 1, ...pcts]);
    const id = r.rows[0].id as number;
    if (src) {
      await c.query(`INSERT INTO commitments(month_id, brand_id, period, sale, platform, qty, priority, sort_order)
        SELECT $1, brand_id, period, sale, platform, qty, priority, sort_order FROM commitments WHERE month_id = $2`, [id, src.id]);
      // Sale names usually repeat each month; copy them so ops only adjust the dates.
      const daysInNew = new Date(y, m, 0).getDate();
      await c.query(`INSERT INTO sale_days(month_id, name, day) SELECT $1, name, day FROM sale_days WHERE month_id = $2 AND day <= $3`, [id, src.id, daysInNew]);
    }
    return id;
  });
  back(`/admin/months/${id}`, 'Created ' + monthLabel(y, m - 1) + (copyFrom ? '. Commitments and sale days were copied: check the sale dates.' : ''));
}

export async function deleteMonth(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM months WHERE id = $1', [n(f, 'monthId')]);
  back('/admin', 'Month deleted');
}

export async function updateMonthRules(f: FormData) {
  await requireAdmin();
  const id = n(f, 'monthId');
  const vals = ['bau_weekday_pct', 'bau_weekend_pct', 'mega_weekday_pct', 'mega_weekend_pct'].map(k => parsePctInput(f.get(k)));
  if (vals.some(v => v == null)) back(`/admin/months/${id}?tab=setup`, 'Percentages must be between 0% and 100%', 'bad');
  await query(`UPDATE months SET bau_weekday_pct=$2, bau_weekend_pct=$3, mega_weekday_pct=$4, mega_weekend_pct=$5 WHERE id=$1`, [id, ...vals]);
  back(`/admin/months/${id}?tab=setup`, 'Rules saved');
}

export async function setAvailabilityOpen(f: FormData) {
  await requireAdmin();
  const id = n(f, 'monthId');
  await query('UPDATE months SET availability_open = $2 WHERE id = $1', [id, s(f, 'open') === 'true']);
  back(`/admin/months/${id}?tab=${s(f, 'tab') || 'availability'}`, s(f, 'open') === 'true' ? 'Hosts can now edit their availability' : 'Availability locked for hosts');
}

export async function addSaleDay(f: FormData) {
  await requireAdmin();
  const id = n(f, 'monthId');
  const name = s(f, 'name'), day = n(f, 'day');
  if (!name || !day || day < 1 || day > 31) back(`/admin/months/${id}?tab=setup`, 'Enter a sale name and day of month', 'bad');
  await query(`INSERT INTO sale_days(month_id, name, day) VALUES ($1,$2,$3) ON CONFLICT (month_id, day) DO UPDATE SET name = EXCLUDED.name`, [id, name, day]);
  back(`/admin/months/${id}?tab=setup`, 'Sale day saved');
}

export async function deleteSaleDay(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM sale_days WHERE id = $1', [n(f, 'id')]);
  back(`/admin/months/${n(f, 'monthId')}?tab=setup`, 'Sale day removed');
}

/* ---------------- Commitments ---------------- */

function readCommitment(f: FormData) {
  const period = s(f, 'period').toLowerCase();
  const platform = s(f, 'platform');
  const qty = n(f, 'qty');
  const sale = period === 'bau' ? '-' : f.getAll('sale').map(String).filter(Boolean).join(',') || s(f, 'saleText');
  const err = !n(f, 'brandId') ? 'Pick a brand' : !['bau', 'mega'].includes(period) ? 'Pick BAU or Mega'
    : !parsePlatforms(platform) ? 'Platform must be TikTok, Shopee or TikTok & Shopee'
      : qty == null || !Number.isInteger(qty) || qty < 0 ? 'Sessions must be a whole number'
        : period === 'mega' && !sale ? 'Pick at least one sale for a Mega commitment' : null;
  return { err, brandId: n(f, 'brandId'), period, sale, platform, qty, priority: n(f, 'priority') };
}

export async function addCommitment(f: FormData) {
  await requireAdmin();
  const id = n(f, 'monthId');
  const c = readCommitment(f);
  if (c.err) back(`/admin/months/${id}?tab=commitments`, c.err, 'bad');
  await query(`INSERT INTO commitments(month_id, brand_id, period, sale, platform, qty, priority, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT coalesce(max(sort_order),0)+1 FROM commitments WHERE month_id=$1))`,
    [id, c.brandId, c.period, c.sale, c.platform, c.qty, c.priority]);
  back(`/admin/months/${id}?tab=commitments`, 'Commitment added');
}

export async function updateCommitmentQty(f: FormData) {
  await requireAdmin();
  const qty = n(f, 'qty'), priority = n(f, 'priority');
  if (qty == null || !Number.isInteger(qty) || qty < 0) back(`/admin/months/${n(f, 'monthId')}?tab=commitments`, 'Sessions must be a whole number', 'bad');
  await query('UPDATE commitments SET qty = $2, priority = $3 WHERE id = $1', [n(f, 'id'), qty, priority]);
  back(`/admin/months/${n(f, 'monthId')}?tab=commitments`, 'Commitment updated');
}

export async function deleteCommitment(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM commitments WHERE id = $1', [n(f, 'id')]);
  back(`/admin/months/${n(f, 'monthId')}?tab=commitments`, 'Commitment removed');
}

/* ---------------- Pre-planned streams ---------------- */

export async function addPreplanned(f: FormData) {
  await requireAdmin();
  const id = n(f, 'monthId');
  const path = `/admin/months/${id}?tab=preplanned`;
  const date = s(f, 'date');
  const start = parseTimeInput(f.get('start'));
  let end = parseTimeInput(f.get('end'));
  if (end === 0) end = 1440;
  const brandId = n(f, 'brandId'), platform = s(f, 'platform');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || start == null || end == null || end <= start || !brandId || !platform)
    back(path, 'Date, start/end time, brand and platform are required (end must be after start)', 'bad');
  const m = await one('SELECT year, month FROM months WHERE id = $1', [id]);
  if (Number(date.slice(0, 4)) !== m!.year || Number(date.slice(5, 7)) - 1 !== m!.month) back(path, 'Date must be inside this month', 'bad');
  await query(`INSERT INTO preplanned_streams(month_id, date, start_min, end_min, host_id, brand_id, period, sale, platform, room, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(SELECT coalesce(max(sort_order),0)+1 FROM preplanned_streams WHERE month_id=$1))`,
    [id, date, start, end, n(f, 'hostId'), brandId, s(f, 'period').toLowerCase(), s(f, 'sale'), platform, s(f, 'room')]);
  back(path, 'Pre-planned stream added');
}

export async function updatePreplannedHost(f: FormData) {
  await requireAdmin();
  await query('UPDATE preplanned_streams SET host_id = $2 WHERE id = $1', [n(f, 'id'), n(f, 'hostId')]);
  back(`/admin/months/${n(f, 'monthId')}?tab=preplanned`, 'Host updated');
}

export async function deletePreplannedMany(f: FormData) {
  await requireAdmin();
  const monthId = n(f, 'monthId');
  const ids = f.getAll('ids').map(Number).filter(Boolean);
  if (!ids.length) back(`/admin/months/${monthId}?tab=preplanned`, 'Tick at least one stream to remove', 'bad');
  const rows = await query('DELETE FROM preplanned_streams WHERE month_id = $1 AND id = ANY($2) RETURNING id', [monthId, ids]);
  back(`/admin/months/${monthId}?tab=preplanned`, `Removed ${rows.length} pre-planned stream${rows.length === 1 ? '' : 's'}.`);
}

export async function deletePreplanned(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM preplanned_streams WHERE id = $1', [n(f, 'id')]);
  back(`/admin/months/${n(f, 'monthId')}?tab=preplanned`, 'Pre-planned stream removed');
}

/* ---------------- Scheduling runs ---------------- */

export async function runSchedule(f: FormData) {
  const user = await requireAdmin();
  const id = n(f, 'monthId')!;
  const res = await runAndSave(id, user.id, s(f, 'label'));
  if (!res.ok) back(`/admin/months/${id}?tab=schedule`, res.message + ' ' + res.errors.slice(0, 6).join(' | '), 'bad');
  else back(`/admin/runs/${res.runId}`, 'Scheduling complete. ' + res.message);
}

export async function publishRun(f: FormData) {
  await requireAdmin();
  const run = await one('SELECT id, month_id FROM schedule_runs WHERE id = $1', [n(f, 'runId')]);
  await query('UPDATE months SET published_run_id = $2 WHERE id = $1', [run!.month_id, run!.id]);
  back(`/admin/runs/${run!.id}`, 'Published. Hosts can now see their streams from this version.');
}

export async function unpublishMonth(f: FormData) {
  await requireAdmin();
  await query('UPDATE months SET published_run_id = NULL WHERE id = $1', [n(f, 'monthId')]);
  back(s(f, 'returnTo') || `/admin/months/${n(f, 'monthId')}?tab=schedule`, 'Unpublished. Hosts no longer see a schedule for this month.');
}

export async function deleteRun(f: FormData) {
  await requireAdmin();
  const run = await one('SELECT month_id FROM schedule_runs WHERE id = $1', [n(f, 'runId')]);
  await query('DELETE FROM schedule_runs WHERE id = $1', [n(f, 'runId')]);
  back(`/admin/months/${run!.month_id}?tab=schedule`, 'Version deleted');
}

export async function renameRun(f: FormData) {
  await requireAdmin();
  await query('UPDATE schedule_runs SET label = $2 WHERE id = $1', [n(f, 'runId'), s(f, 'label')]);
  back(`/admin/runs/${n(f, 'runId')}`, 'Renamed');
}

export async function duplicateRun(f: FormData) {
  const user = await requireAdmin();
  const runId = n(f, 'runId');
  const newId = await tx(async c => {
    const r = await c.query(`INSERT INTO schedule_runs(month_id, label, created_by, message, stats, sections, warnings)
      SELECT month_id, 'Copy of ' || coalesce(nullif(label,''), 'version #' || id), $2, message, stats, sections, warnings FROM schedule_runs WHERE id = $1 RETURNING id`, [runId, user.id]);
    const id = r.rows[0].id;
    await c.query(`INSERT INTO scheduled_streams(run_id, date, start_min, end_min, host_id, host_name, brand, period, sale, platform, room, fixed, auto_assigned_host, edited, status, confirmed_at)
      SELECT $2, date, start_min, end_min, host_id, host_name, brand, period, sale, platform, room, fixed, auto_assigned_host, edited, status, confirmed_at FROM scheduled_streams WHERE run_id = $1`, [runId, id]);
    return id;
  });
  back(`/admin/runs/${newId}`, 'Copied. Edit this version freely; the original is unchanged.');
}

export async function updateStream(f: FormData) {
  await requireAdmin();
  const runId = n(f, 'runId'), hostId = n(f, 'hostId');
  const host = hostId ? await one('SELECT name FROM hosts WHERE id = $1', [hostId]) : null;
  const start = parseTimeInput(f.get('start'));
  let end = parseTimeInput(f.get('end'));
  if (end === 0) end = 1440;
  if (start == null || end == null || end <= start) back(`/admin/runs/${runId}?edit=${n(f, 'id')}`, 'End time must be after start time', 'bad');
  const brand = s(f, 'brand'), platform = s(f, 'platform'), period = s(f, 'period').toUpperCase();
  if (!brand || !parsePlatforms(platform) || !['BAU', 'MEGA'].includes(period))
    back(`/admin/runs/${runId}?edit=${n(f, 'id')}`, 'Brand, platform and period are required', 'bad');
  const done = await query(`UPDATE scheduled_streams SET host_id=$2, host_name=$3, room=$4, date=$5, start_min=$6, end_min=$7,
      brand=$9, platform=$10, period=$11, sale=$12, edited=TRUE
    WHERE id=$1 AND run_id=$8 AND status = 'tentative' RETURNING id`,
    [n(f, 'id'), hostId, host?.name ?? '', s(f, 'room'), s(f, 'date'), start, end, runId, brand, platform, period, period === 'MEGA' ? s(f, 'sale') : '']);
  if (!done.length) back(`/admin/runs/${runId}#s${n(f, 'id')}`, 'This stream is confirmed. Set it back to Tentative before editing.', 'bad');
  back(`/admin/runs/${runId}#s${n(f, 'id')}`, 'Stream updated');
}

export async function deleteStream(f: FormData) {
  await requireAdmin();
  const done = await query(`DELETE FROM scheduled_streams WHERE id = $1 AND run_id = $2 AND status = 'tentative' RETURNING id`, [n(f, 'id'), n(f, 'runId')]);
  if (!done.length) back(`/admin/runs/${n(f, 'runId')}`, 'This stream is confirmed. Set it back to Tentative before removing it.', 'bad');
  back(`/admin/runs/${n(f, 'runId')}`, 'Stream removed');
}

/** Where to go back to after a status change: the page the form came from (same run only). */
function returnPath(f: FormData, runId: number | null) {
  const r = s(f, 'returnTo');
  return r.startsWith(`/admin/runs/${runId}`) ? r : `/admin/runs/${runId}`;
}

export async function setStreamStatus(f: FormData) {
  await requireAdmin();
  const runId = n(f, 'runId'), status = s(f, 'status');
  if (!['tentative', 'confirmed'].includes(status)) back(`/admin/runs/${runId}`, 'Unknown status', 'bad');
  const row = await one('SELECT host_name FROM scheduled_streams WHERE id = $1 AND run_id = $2', [n(f, 'id'), runId]);
  if (status === 'confirmed' && !row?.host_name) back(returnPath(f, runId), 'Assign a host before confirming this stream.', 'bad');
  await query(`UPDATE scheduled_streams SET status = $3, confirmed_at = CASE WHEN $3 = 'confirmed' THEN now() ELSE NULL END WHERE id = $1 AND run_id = $2`,
    [n(f, 'id'), runId, status]);
  const live = !!(await one('SELECT 1 FROM months WHERE published_run_id = $1', [runId]));
  back(returnPath(f, runId) + `#s${n(f, 'id')}`, status === 'confirmed'
    ? 'Confirmed and locked. ' + (live ? 'The host sees it as confirmed.' : 'Hosts will see it once you publish this version.')
    : 'Set back to tentative. You can edit it again.');
}

/** Confirms (or un-confirms) every stream id posted, e.g. all streams currently shown in the list. Streams without a host are skipped. */
export async function setManyStatus(f: FormData) {
  await requireAdmin();
  const runId = n(f, 'runId'), status = s(f, 'status');
  const ids = s(f, 'ids').split(',').map(Number).filter(Boolean);
  if (!ids.length || !['tentative', 'confirmed'].includes(status)) back(returnPath(f, runId), 'Nothing to change', 'bad');
  const rows = await query(`UPDATE scheduled_streams SET status = $3, confirmed_at = CASE WHEN $3 = 'confirmed' THEN now() ELSE NULL END
    WHERE run_id = $1 AND id = ANY($2) AND status <> $3 AND ($3 = 'tentative' OR host_name <> '') RETURNING id`, [runId, ids, status]);
  const live = !!(await one('SELECT 1 FROM months WHERE published_run_id = $1', [runId]));
  back(returnPath(f, runId), `${rows.length} stream${rows.length === 1 ? '' : 's'} ${status === 'confirmed' ? 'confirmed' : 'set back to tentative'}.` +
    (status === 'confirmed' && !live ? ' Hosts will see them once you publish this version.' : ''));
}

export async function addStream(f: FormData) {
  await requireAdmin();
  const runId = n(f, 'runId');
  const start = parseTimeInput(f.get('start'));
  let end = parseTimeInput(f.get('end'));
  if (end === 0) end = 1440;
  const hostId = n(f, 'hostId');
  const host = hostId ? await one('SELECT name FROM hosts WHERE id = $1', [hostId]) : null;
  const brand = s(f, 'brand'), platform = s(f, 'platform'), date = s(f, 'date');
  if (!date || start == null || end == null || end <= start || !brand || !platform) back(`/admin/runs/${runId}`, 'Date, times, brand and platform are required', 'bad');
  await query(`INSERT INTO scheduled_streams(run_id, date, start_min, end_min, host_id, host_name, brand, period, sale, platform, room, fixed, edited)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,TRUE)`,
    [runId, date, start, end, hostId, host?.name ?? '', brand, s(f, 'period').toUpperCase() || 'BAU', s(f, 'sale'), platform, s(f, 'room')]);
  back(`/admin/runs/${runId}`, 'Stream added');
}

/* ---------------- Hosts ---------------- */

export async function createHost(f: FormData) {
  await requireAdmin();
  const name = s(f, 'name');
  if (!name) back('/admin/hosts', 'Enter a name', 'bad');
  const exists = await one('SELECT id FROM hosts WHERE lower(name) = lower($1)', [name]);
  if (exists) back(`/admin/hosts/${exists.id}`, 'A host with that name already exists', 'bad');
  const r = await one(`INSERT INTO hosts(name, max_streams_month, max_brand_pct, platforms, sort_order)
    VALUES ($1, 6, 0.4, 'TikTok, Shopee', (SELECT coalesce(max(sort_order),0)+1 FROM hosts)) RETURNING id`, [name]);
  back(`/admin/hosts/${r!.id}`, 'Host created. Set their brands and login below.');
}

export async function updateHost(f: FormData) {
  await requireAdmin();
  const id = n(f, 'hostId');
  const path = `/admin/hosts/${id}`;
  const name = s(f, 'name');
  const cap = n(f, 'max_streams_month');
  const brandPct = parsePctInput(f.get('max_brand_pct'));
  const platforms = f.getAll('platforms').map(String).join(', ');
  const rooms = f.getAll('rooms').map(String);
  const allRooms = (await query('SELECT name FROM rooms')).map(r => r.name);
  if (!name) back(path, 'Name is required', 'bad');
  if (cap == null || !Number.isInteger(cap) || cap < 0) back(path, 'Max streams per month must be a whole number', 'bad');
  if (brandPct == null || brandPct <= 0) back(path, 'Max % per brand must be above 0%', 'bad');
  if (!platforms) back(path, 'Pick at least one platform', 'bad');
  if (!rooms.length) back(path, 'Pick at least one room', 'bad');
  await tx(async c => {
    await c.query(`UPDATE hosts SET name=$2, gender=$3, max_streams_month=$4, max_brand_pct=$5, platforms=$6, allowed_rooms=$7, active=$8 WHERE id=$1`,
      [id, name, s(f, 'gender'), cap, brandPct, platforms, rooms.length === allRooms.length ? null : rooms, s(f, 'active') === 'on']);
    await c.query('DELETE FROM host_brand_prefs WHERE host_id = $1', [id]);
    for (const [k, v] of f.entries()) {
      if (k.startsWith('pref_') && ['preferred', 'regular', 'excluded'].includes(String(v)))
        await c.query('INSERT INTO host_brand_prefs(host_id, brand_id, level) VALUES ($1,$2,$3)', [id, Number(k.slice(5)), String(v)]);
    }
  });
  back(path, 'Host saved');
}

export async function setHostLogin(f: FormData) {
  await requireAdmin();
  const hostId = n(f, 'hostId');
  const path = `/admin/hosts/${hostId}`;
  const email = s(f, 'email').toLowerCase();
  const password = s(f, 'password');
  if (!/^\S+@\S+\.\S+$/.test(email)) back(path, 'Enter a valid email', 'bad');
  const existing = await one('SELECT id FROM users WHERE host_id = $1', [hostId]);
  const clash = await one('SELECT id FROM users WHERE email = $1 AND (host_id IS DISTINCT FROM $2)', [email, hostId]);
  if (clash) back(path, 'That email is already used by another account', 'bad');
  if (!existing && password.length < 8) back(path, 'Set a password of at least 8 characters', 'bad');
  if (password && password.length < 8) back(path, 'Password must be at least 8 characters', 'bad');
  const host = await one('SELECT name FROM hosts WHERE id = $1', [hostId]);
  if (existing) {
    await query('UPDATE users SET email=$2, name=$3 WHERE id=$1', [existing.id, email, host!.name]);
    if (password) await query('UPDATE users SET password_hash=$2 WHERE id=$1', [existing.id, await bcrypt.hash(password, 10)]);
  } else {
    await query(`INSERT INTO users(email, name, password_hash, role, host_id) VALUES ($1,$2,$3,'host',$4)`, [email, host!.name, await bcrypt.hash(password, 10), hostId]);
  }
  back(path, password ? 'Login saved. Share the email and password with the host.' : 'Login email updated');
}

export async function removeHostLogin(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM users WHERE host_id = $1', [n(f, 'hostId')]);
  back(`/admin/hosts/${n(f, 'hostId')}`, 'Login removed');
}

export async function deleteHost(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM hosts WHERE id = $1', [n(f, 'hostId')]);
  back('/admin/hosts', 'Host deleted');
}

/* ---------------- Brands, rooms, admins ---------------- */

export async function addBrand(f: FormData) {
  await requireAdmin();
  const name = s(f, 'name');
  if (!name) back('/admin/settings', 'Enter a brand name', 'bad');
  await query(`INSERT INTO brands(name, sort_order) VALUES ($1, (SELECT coalesce(max(sort_order),0)+1 FROM brands)) ON CONFLICT DO NOTHING`, [name]);
  back('/admin/settings', 'Brand added. Set which hosts can stream it on each host’s page.');
}

export async function renameBrand(f: FormData) {
  await requireAdmin();
  const name = s(f, 'name');
  if (!name) back('/admin/settings', 'Enter a brand name', 'bad');
  await query('UPDATE brands SET name = $2 WHERE id = $1', [n(f, 'id'), name]);
  back('/admin/settings', 'Brand renamed');
}

export async function deleteBrand(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM brands WHERE id = $1', [n(f, 'id')]);
  back('/admin/settings', 'Brand deleted');
}

export async function addRoom(f: FormData) {
  await requireAdmin();
  const name = s(f, 'name');
  if (!name) back('/admin/settings', 'Enter a room name', 'bad');
  await query(`INSERT INTO rooms(name, status, sort_order) VALUES ($1, 'available', (SELECT coalesce(max(sort_order),0)+1 FROM rooms)) ON CONFLICT DO NOTHING`, [name]);
  back('/admin/settings', 'Room added');
}

export async function updateRoom(f: FormData) {
  await requireAdmin();
  const status = s(f, 'status');
  if (!['available', 'unavailable', 'last resort'].includes(status)) back('/admin/settings', 'Invalid status', 'bad');
  await query('UPDATE rooms SET status = $2, sort_order = $3 WHERE id = $1', [n(f, 'id'), status, n(f, 'sort_order') ?? 0]);
  back('/admin/settings', 'Room updated');
}

export async function deleteRoom(f: FormData) {
  await requireAdmin();
  await query('DELETE FROM rooms WHERE id = $1', [n(f, 'id')]);
  back('/admin/settings', 'Room deleted');
}

export async function addAdmin(f: FormData) {
  await requireAdmin();
  const email = s(f, 'email').toLowerCase(), password = s(f, 'password');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) back('/admin/settings', 'Enter an email and a password of at least 8 characters', 'bad');
  if (await one('SELECT id FROM users WHERE email = $1', [email])) back('/admin/settings', 'That email already has an account', 'bad');
  await query(`INSERT INTO users(email, name, password_hash, role) VALUES ($1,$2,$3,'admin')`, [email, s(f, 'name'), await bcrypt.hash(password, 10)]);
  back('/admin/settings', 'Ops team member added');
}

export async function deleteAdmin(f: FormData) {
  const me = await requireAdmin();
  if (n(f, 'id') === me.id) back('/admin/settings', 'You cannot remove yourself', 'bad');
  await query("DELETE FROM users WHERE id = $1 AND role = 'admin'", [n(f, 'id')]);
  back('/admin/settings', 'Ops team member removed');
}

/* ---------------- Import ---------------- */

export async function importWorkbook(f: FormData) {
  await requireAdmin();
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) back('/admin/import', 'Choose an .xlsx file', 'bad');
  let result: Awaited<ReturnType<typeof importDataset>>;
  let warnings: string[] = [];
  try {
    const ds = await parseWorkbook(Buffer.from(await (file as File).arrayBuffer()));
    warnings = ds.warnings;
    result = await importDataset(ds);
  } catch (e) {
    back('/admin/import', 'Import failed: ' + (e as Error).message, 'bad');
    return;
  }
  back(`/admin/months/${result.monthId}`, 'Imported: ' + result.log.join('; ') + (warnings.length ? '. Warnings: ' + warnings.join(' ') : ''));
}
