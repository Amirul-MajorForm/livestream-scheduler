import 'server-only';
import { query, one, tx } from './db';
import { runScheduler, formatTime, MONTH_NAMES, type SchedulerInput, type PrefLevel, type RoomStatus } from './scheduler';
import { isoDate, type Dataset } from './workbook';

export function monthLabel(year: number, month: number) {
  return MONTH_NAMES[month] + ' ' + year;
}

export function monthRange(year: number, month: number) {
  const days = new Date(year, month + 1, 0).getDate();
  return { start: isoDate(year, month, 1), end: isoDate(year, month, days), days };
}

export interface MonthRow {
  id: number;
  year: number;
  month: number;
  bau_weekday_pct: number;
  bau_weekend_pct: number;
  mega_weekday_pct: number;
  mega_weekend_pct: number;
  availability_open: boolean;
  published_run_id: number | null;
}

export async function getMonth(id: number) {
  return one<MonthRow>('SELECT * FROM months WHERE id = $1', [id]);
}

/** Builds the scheduler input for a month from the database. */
export async function loadSchedulerInput(monthId: number): Promise<SchedulerInput> {
  const m = await getMonth(monthId);
  if (!m) throw new Error('Month not found');
  const { start, end } = monthRange(m.year, m.month);

  const [saleDays, rooms, hosts, prefs, avail, commitments, preplanned] = await Promise.all([
    query('SELECT name, day FROM sale_days WHERE month_id = $1 ORDER BY day', [monthId]),
    query('SELECT name, status FROM rooms ORDER BY sort_order, id'),
    query('SELECT * FROM hosts WHERE active ORDER BY sort_order, id'),
    query('SELECT p.host_id, b.name AS brand, p.level FROM host_brand_prefs p JOIN brands b ON b.id = p.brand_id'),
    query('SELECT h.name AS host, a.date, a.slot FROM availability a JOIN hosts h ON h.id = a.host_id WHERE h.active AND a.date BETWEEN $1 AND $2', [start, end]),
    query(`SELECT c.*, b.name AS brand FROM commitments c JOIN brands b ON b.id = c.brand_id
           WHERE c.month_id = $1 ORDER BY c.sort_order, c.id`, [monthId]),
    query(`SELECT p.*, b.name AS brand, h.name AS host FROM preplanned_streams p
           JOIN brands b ON b.id = p.brand_id LEFT JOIN hosts h ON h.id = p.host_id
           WHERE p.month_id = $1 ORDER BY p.sort_order, p.id`, [monthId]),
  ]);

  const prefsByHost = new Map<number, Record<string, PrefLevel>>();
  prefs.forEach(p => {
    if (!prefsByHost.has(p.host_id)) prefsByHost.set(p.host_id, {});
    prefsByHost.get(p.host_id)![p.brand] = p.level;
  });

  return {
    year: m.year,
    month: m.month,
    pct: { bauWeekday: m.bau_weekday_pct, bauWeekend: m.bau_weekend_pct, megaWeekday: m.mega_weekday_pct, megaWeekend: m.mega_weekend_pct },
    saleDays: saleDays.map(s => ({ name: s.name, day: s.day })),
    rooms: rooms.map(r => ({ name: r.name, status: r.status as RoomStatus })),
    hosts: hosts.map(h => ({
      name: h.name,
      gender: h.gender,
      maxStreamsMonth: h.max_streams_month,
      maxBrandPct: h.max_brand_pct,
      platforms: h.platforms,
      allowedRooms: h.allowed_rooms && h.allowed_rooms.length ? h.allowed_rooms.map((r: string) => r.toLowerCase()) : null,
      prefs: prefsByHost.get(h.id) || {},
    })),
    availability: avail.map(a => ({ host: a.host, day: Number(String(a.date).slice(8, 10)), slot: a.slot })),
    commitments: commitments.map((c, i) => ({ id: i, brand: c.brand, period: c.period, sale: c.sale, platform: c.platform, qty: c.qty, priority: c.priority })),
    preplanned: preplanned.map(p => ({
      day: Number(String(p.date).slice(8, 10)),
      start: p.start_min,
      end: p.end_min,
      host: p.host || '',
      brand: p.brand,
      period: p.period,
      sale: p.sale,
      platform: p.platform,
      room: p.room,
      source: 'Pre-planned ' + p.brand + ' ' + Number(String(p.date).slice(8, 10)) + ' ' + MONTH_NAMES[m.month].slice(0, 3) + ' ' + formatTime(p.start_min),
    })),
  };
}

/** Runs the scheduler for a month and stores the result as a new draft run. */
export async function runAndSave(monthId: number, userId: number, label: string) {
  const input = await loadSchedulerInput(monthId);
  const result = runScheduler(input);
  if (!result.ok) return { ok: false as const, message: result.message, errors: result.errors };
  const hostIds = new Map<string, number>((await query('SELECT id, name FROM hosts')).map(h => [h.name, h.id]));
  const runId = await tx(async c => {
    const run = await c.query(
      `INSERT INTO schedule_runs(month_id, label, created_by, message, stats, sections, warnings)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [monthId, label, userId, result.message, JSON.stringify(result.stats), JSON.stringify(result.sections), JSON.stringify(result.warnings)],
    );
    const id = run.rows[0].id as number;
    for (const s of result.streams) {
      await c.query(
        `INSERT INTO scheduled_streams(run_id, date, start_min, end_min, host_id, host_name, brand, period, sale, platform, room, fixed, auto_assigned_host)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, isoDate(input.year, input.month, s.day), s.start, s.end, hostIds.get(s.host) ?? null, s.host, s.brand, s.period, s.sale.trim(), s.platform, s.room, s.fixed, s.autoAssignedHost],
      );
    }
    return id;
  });
  return { ok: true as const, runId, message: result.message };
}

/** Writes an imported spreadsheet dataset into the database (upserting by name). */
export async function importDataset(ds: Dataset) {
  return tx(async c => {
    const log: string[] = [];
    // Rooms
    for (const [i, r] of ds.rooms.entries()) {
      await c.query(`INSERT INTO rooms(name, status, sort_order) VALUES ($1,$2,$3)
        ON CONFLICT (name) DO UPDATE SET status = EXCLUDED.status, sort_order = EXCLUDED.sort_order`, [r.name, r.status, i]);
    }
    log.push(ds.rooms.length + ' rooms');
    // Brands
    for (const [i, b] of ds.brands.entries()) {
      await c.query(`INSERT INTO brands(name, sort_order) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`, [b, i]);
    }
    const brandIds = new Map<string, number>((await c.query('SELECT id, name FROM brands')).rows.map(r => [r.name.toLowerCase(), r.id]));
    log.push(ds.brands.length + ' brands');
    // Hosts
    for (const [i, h] of ds.hosts.entries()) {
      await c.query(`INSERT INTO hosts(name, gender, max_streams_month, max_brand_pct, platforms, allowed_rooms, active, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)
        ON CONFLICT (name) DO UPDATE SET gender=EXCLUDED.gender, max_streams_month=EXCLUDED.max_streams_month,
          max_brand_pct=EXCLUDED.max_brand_pct, platforms=EXCLUDED.platforms, allowed_rooms=EXCLUDED.allowed_rooms,
          active=TRUE, sort_order=EXCLUDED.sort_order`,
        [h.name, h.gender, h.maxStreamsMonth, h.maxBrandPct, h.platforms, h.allowedRooms ? h.allowedRooms.map(titleCase) : null, i]);
    }
    let hostIds = new Map<string, number>((await c.query('SELECT id, name FROM hosts')).rows.map(r => [r.name, r.id]));
    for (const h of ds.hosts) {
      const hid = hostIds.get(h.name)!;
      await c.query('DELETE FROM host_brand_prefs WHERE host_id = $1', [hid]);
      for (const [brand, level] of Object.entries(h.prefs)) {
        const bid = brandIds.get(brand.toLowerCase());
        if (bid) await c.query('INSERT INTO host_brand_prefs(host_id, brand_id, level) VALUES ($1,$2,$3)', [hid, bid, level]);
      }
    }
    log.push(ds.hosts.length + ' hosts with brand preferences');
    // Month and its rules
    const m = await c.query(`INSERT INTO months(year, month, bau_weekday_pct, bau_weekend_pct, mega_weekday_pct, mega_weekend_pct)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (year, month) DO UPDATE SET bau_weekday_pct=EXCLUDED.bau_weekday_pct, bau_weekend_pct=EXCLUDED.bau_weekend_pct,
        mega_weekday_pct=EXCLUDED.mega_weekday_pct, mega_weekend_pct=EXCLUDED.mega_weekend_pct RETURNING id`,
      [ds.year, ds.month, ds.pct.bauWeekday, ds.pct.bauWeekend, ds.pct.megaWeekday, ds.pct.megaWeekend]);
    const monthId = m.rows[0].id as number;
    await c.query('DELETE FROM sale_days WHERE month_id = $1', [monthId]);
    for (const s of ds.saleDays) await c.query('INSERT INTO sale_days(month_id, name, day) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [monthId, s.name, s.day]);
    await c.query('DELETE FROM commitments WHERE month_id = $1', [monthId]);
    for (const [i, cm] of ds.commitments.entries()) {
      await c.query('INSERT INTO commitments(month_id, brand_id, period, sale, platform, qty, priority, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [monthId, brandIds.get(cm.brand.toLowerCase()), cm.period, cm.sale, cm.platform, cm.qty, cm.priority, i]);
    }
    log.push(monthLabel(ds.year, ds.month) + ': ' + ds.saleDays.length + ' sale days, ' + ds.commitments.length + ' commitments');
    // Pre-planned: unknown hosts are created as inactive so the booking keeps its named host.
    await c.query('DELETE FROM preplanned_streams WHERE month_id = $1', [monthId]);
    for (const [i, p] of ds.preplanned.entries()) {
      if (p.host && !hostIds.has(p.host)) {
        await c.query("INSERT INTO hosts(name, active, platforms) VALUES ($1, FALSE, '') ON CONFLICT DO NOTHING", [p.host]);
        hostIds = new Map((await c.query('SELECT id, name FROM hosts')).rows.map(r => [r.name, r.id]));
        log.push('Created inactive host "' + p.host + '" for a pre-planned stream');
      }
      let bid = brandIds.get(p.brand.toLowerCase());
      if (!bid) {
        bid = (await c.query('INSERT INTO brands(name, sort_order) VALUES ($1, 999) RETURNING id', [p.brand])).rows[0].id as number;
        brandIds.set(p.brand.toLowerCase(), bid);
      }
      await c.query(`INSERT INTO preplanned_streams(month_id, date, start_min, end_min, host_id, brand_id, period, sale, platform, room, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [monthId, p.date, p.start, p.end, p.host ? hostIds.get(p.host) : null, bid, p.period, p.sale, p.platform, p.room, i]);
    }
    log.push(ds.preplanned.length + ' pre-planned streams');
    // Availability: replace for each imported host on each imported date.
    const dates = [...new Set(ds.availability.map(a => a.date))];
    if (dates.length) {
      const importedHostIds = ds.hosts.map(h => hostIds.get(h.name)!);
      await c.query('DELETE FROM availability WHERE host_id = ANY($1) AND date = ANY($2::date[])', [importedHostIds, dates]);
      const rows = ds.availability.filter(a => hostIds.has(a.host));
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const params: unknown[] = [];
        const values = chunk.map((a, j) => { params.push(hostIds.get(a.host), a.date, a.slot); return `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`; });
        await c.query('INSERT INTO availability(host_id, date, slot) VALUES ' + values.join(',') + ' ON CONFLICT DO NOTHING', params);
      }
      log.push(rows.length + ' availability slots across ' + dates.length + ' dates');
    }
    return { monthId, log };
  });
}

function titleCase(s: string) {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
