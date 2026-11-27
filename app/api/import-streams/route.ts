import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { query, tx } from '@/lib/db';
import { ensureMonth, monthLabel, type MonthRow } from '@/lib/data';
import { readStreamFile, type SheetStream } from '@/lib/streamImport';

export const maxDuration = 120;

/**
 * Ops only. Multipart form: `file` (.xlsx), `year`, `mode` = "preview" | "import", and for import
 * `months` (comma-separated 0-based month numbers).
 *
 * Import, per chosen month: saves the sheet's streams as a new schedule version
 * ("Imported from sheet"), publishes it, and stores each stream's sales, payment status, rate
 * version, tier and recorded talent fee. Earlier versions are kept, so it can be undone by
 * publishing a previous version. The file is re-read on import, so the preview can't be tampered with.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const mode = String(form?.get('mode') || 'preview');
  const year = Number(form?.get('year') || new Date().getFullYear());
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose the .xlsx file' }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'That file is too large (25 MB max)' }, { status: 400 });
  if (!['preview', 'import'].includes(mode) || !(year >= 2020 && year <= 2100)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const [hosts, brands, months] = await Promise.all([
    query<{ id: number; name: string }>('SELECT id, name FROM hosts'),
    query<{ name: string }>('SELECT name FROM brands'),
    query(`SELECT m.*, r.label AS run_label, (SELECT count(*)::int FROM scheduled_streams s WHERE s.run_id = m.published_run_id) AS run_streams
      FROM months m LEFT JOIN schedule_runs r ON r.id = m.published_run_id WHERE m.year = $1`, [year]),
  ]);
  let parsed;
  try { parsed = await readStreamFile(await file.arrayBuffer(), year, { hosts, brands }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const byMonth = new Map<number, SheetStream[]>();
  parsed.streams.forEach(s => { const m = Number(s.date.slice(5, 7)) - 1; byMonth.set(m, [...(byMonth.get(m) || []), s]); });
  const summary = [...byMonth].sort((a, b) => a[0] - b[0]).map(([month, list]) => {
    const inApp = months.find(m => m.month === month);
    return {
      month, label: monthLabel(year, month),
      streams: list.length,
      withSales: list.filter(s => s.tiktok_gmv != null || s.shopee_gmv != null).length,
      gmv: Math.round(list.reduce((a, s) => a + (s.tiktok_gmv ?? 0) + (s.shopee_gmv ?? 0), 0) * 100) / 100,
      fees: Math.round(list.reduce((a, s) => a + (s.fee ?? 0), 0) * 100) / 100,
      published: inApp?.published_run_id ? { label: inApp.run_label || 'a version', streams: inApp.run_streams } : null,
    };
  });
  const cancelled = parsed.skipped.filter(s => s.reason === 'Cancelled').length;
  const problems = parsed.skipped.filter(s => s.reason !== 'Cancelled');

  if (mode === 'preview') {
    return NextResponse.json({ sheet: parsed.sheet, months: summary, cancelled, problems, unknownHosts: parsed.unknownHosts, unknownBrands: parsed.unknownBrands });
  }

  const chosen = String(form?.get('months') || '').split(',').map(Number).filter(m => byMonth.has(m));
  if (!chosen.length) return NextResponse.json({ error: 'Tick at least one month' }, { status: 400 });
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // Singapore date
  const done: { label: string; streams: number; sales: number; runId: number; monthId: number }[] = [];
  for (const month of chosen) {
    const m: MonthRow = await ensureMonth(year, month);
    const list = byMonth.get(month)!;
    const res = await tx(async c => {
      const run = (await c.query(`INSERT INTO schedule_runs(month_id, label, created_by, message, stats, sections, warnings)
        VALUES ($1, $2, $3, $4, '{"imported": true}', '[]', '[]') RETURNING id`,
        [m.id, 'Imported from sheet', user.id, `${list.length} streams imported from ${file.name} (${parsed.sheet} tab) on ${new Date().toISOString().slice(0, 10)}.`])).rows[0];
      for (const s of list) {
        await c.query(`INSERT INTO scheduled_streams(run_id, date, start_min, end_min, host_id, host_name, brand, period, sale, platform, room, fixed, status, confirmed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,false,$11,$12)`,
          [run.id, s.date, s.start_min, s.end_min, s.host_id, s.host_name, s.brand, s.period, s.platform, s.room,
            s.approved ? 'confirmed' : 'tentative', s.approved ? new Date() : null]);
      }
      await c.query('UPDATE months SET published_run_id = $2 WHERE id = $1', [m.id, run.id]);
      // Re-importing a month replaces the sales that came from the sheet; sales typed in the app for other streams stay.
      await c.query(`DELETE FROM stream_sales WHERE month_id = $1 AND source = 'sheet'`, [m.id]);
      let sales = 0;
      const seen = new Set<string>();
      for (const s of list) {
        // Streams that haven't happened yet: the sheet already shows a base-only fee; leave them for the team to fill in.
        const future = s.date > today && s.tiktok_gmv == null && s.shopee_gmv == null;
        if (future || (s.tiktok_gmv == null && s.shopee_gmv == null && s.fee == null && !s.pay_status && !s.notes)) continue;
        const k = [s.date, s.start_min, s.brand, s.platform, s.host_name].join('|');
        if (seen.has(k)) continue; // two identical rows: the first one's sales are kept
        seen.add(k);
        await c.query(`INSERT INTO stream_sales (month_id, date, start_min, brand, platform, host_name, end_min, period, tiktok_gmv, shopee_gmv,
            pay_status, notes, updated_by, rate_label, tier, recorded_fee, fee_blank, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'sheet')
          ON CONFLICT (month_id, date, start_min, brand, platform, host_name) DO UPDATE SET
            end_min = EXCLUDED.end_min, period = EXCLUDED.period, tiktok_gmv = EXCLUDED.tiktok_gmv, shopee_gmv = EXCLUDED.shopee_gmv,
            pay_status = EXCLUDED.pay_status, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now(),
            rate_label = EXCLUDED.rate_label, tier = EXCLUDED.tier, recorded_fee = EXCLUDED.recorded_fee, fee_blank = EXCLUDED.fee_blank, source = 'sheet'`,
          [m.id, s.date, s.start_min, s.brand, s.platform, s.host_name, s.end_min, s.period, s.tiktok_gmv, s.shopee_gmv,
            s.pay_status, s.notes, user.id, s.rate_label, s.tier, s.fee,
            s.fee == null && (s.tiktok_gmv != null || s.shopee_gmv != null)]);
        sales++;
      }
      return { runId: run.id as number, sales };
    });
    done.push({ label: monthLabel(year, month), streams: list.length, sales: res.sales, runId: res.runId, monthId: m.id });
  }
  revalidatePath('/admin');
  return NextResponse.json({ imported: done });
}
