import ExcelJS from 'exceljs';
import { query } from './db';
import type { Rate } from './earnings';

export async function loadRates(): Promise<Rate[]> {
  return query<Rate>(`SELECT * FROM rate_cards ORDER BY lower(brand), label, period, stream_type, gmv_min NULLS FIRST, id`);
}

export type NewRate = Omit<Rate, 'id'>;

/** Cell value with formulas resolved to their cached result. */
function val(c: ExcelJS.Cell): unknown {
  const v = c.value as unknown;
  if (v && typeof v === 'object') {
    if ('result' in (v as object)) return (v as { result: unknown }).result;
    if ('richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map(t => t.text).join('');
    if (v instanceof Date) return v;
  }
  return v;
}
const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && isFinite(v)) return v;
  const t = str(v).replace(/[$,%\s]/g, '');
  if (!t || t === '-' || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return str(v).includes('%') ? n / 100 : n;
};

function sheetRows(ws: ExcelJS.Worksheet) {
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = str(val(c)).toLowerCase(); });
  const out: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), o: Record<string, unknown> = {};
    header.forEach((h, i) => { if (h) o[h] = val(row.getCell(i)); });
    out.push(o);
  }
  return out;
}

export interface RatesImport { rates: NewRate[]; skipped: string[]; inactive: string[]; renamed: string[] }

/**
 * Reads the Master Availability Sheet's rate tabs: "Reference" (one row per brand / version /
 * period / tier) and "Version" (which version applies from when). Versions that don't appear in
 * the Version tab (e.g. 2025 rates, one-off campaigns) come in switched off.
 */
export async function readRatesWorkbook(buf: ArrayBuffer, appBrands: string[] = []): Promise<RatesImport> {
  // Store rates under the app's own brand names ("Shiseido Professional" -> "Shiseido") so streams match.
  const { matchBrand } = await import('./preplannedFile');
  const brandList = appBrands.map(name => ({ name }));
  const renamed = new Set<string>();
  const appName = (x: string) => {
    const name = matchBrand(x, brandList).brand?.name ?? x;
    if (name !== x) renamed.add(`${x} \u2192 ${name}`);
    return name;
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const refWs = wb.worksheets.find(w => w.name.trim().toLowerCase() === 'reference');
  if (!refWs) throw new Error('No "Reference" tab found. Download the whole Master Availability Sheet as Excel (.xlsx) and upload that.');
  const verWs = wb.worksheets.find(w => w.name.trim().toLowerCase() === 'version');

  const dates = new Map<string, { from: string | null; to: string | null }>();
  if (verWs) {
    for (const v of sheetRows(verWs)) {
      const brand = str(v['brand']), label = str(v['version']);
      if (!brand || !label) continue;
      const k = brand.toLowerCase() + '|' + label;
      const from = v['start date'] instanceof Date ? (v['start date'] as Date).toISOString().slice(0, 10) : null;
      const to = v['end date'] instanceof Date ? (v['end date'] as Date).toISOString().slice(0, 10) : null;
      const cur = dates.get(k);
      dates.set(k, cur
        ? { from: cur.from && from ? (from < cur.from ? from : cur.from) : null, to: cur.to && to ? (to > cur.to ? to : cur.to) : null }
        : { from, to });
    }
  }

  const rates: NewRate[] = [], skipped: string[] = [], inactive = new Set<string>();
  for (const r of sheetRows(refWs)) {
    const brand = str(r['brand']), label = str(r['version']);
    if (!brand || !label) continue;
    const total = num(r['total comms']), agency = num(r['agency comms']), base = num(r['talent base']);
    const platform = str(r['platform']).toLowerCase();
    const split = platform === 'exception';
    const tt = num(r['tiktok comms']), sp = num(r['shopee comms']);
    if ((split ? tt == null && sp == null : total == null && base == null) || agency == null) {
      skipped.push(`${brand} ${label}: no usable numbers (${str(r['total comms']) || 'blank'})`);
      continue;
    }
    const periodRaw = str(r['period']).toLowerCase();
    const tier = str(r['tier']);
    const d = dates.get(brand.toLowerCase() + '|' + label);
    if (!d) inactive.add(`${appName(brand)} ${label}`);
    rates.push({
      brand: appName(brand), label,
      account: str(r['account']) || 'Brand',
      period: periodRaw === 'bau' ? 'BAU' : periodRaw === 'mega' ? 'Mega' : 'All',
      stream_type: platform === 'dual' ? 'dual' : platform === 'single' ? 'single' : 'any',
      method: split ? 'split' : 'base_comms',
      tier: tier && tier.toUpperCase() !== 'NA' ? tier : '',
      gmv_min: num(r['lower gmv / hour']),
      gmv_max: num(r['upper gmv / hour']),
      base_per_hour: base ?? 0,
      total_comms: total ?? 0,
      tiktok_comms: tt ?? 0,
      shopee_comms: sp ?? 0,
      agency_comms: agency,
      valid_from: d?.from ?? null,
      valid_to: d?.to ?? null,
      active: !!d,
      notes: '',
    });
  }
  return { rates, skipped, inactive: [...inactive], renamed: [...renamed] };
}

export async function insertRates(rates: NewRate[], replace: boolean) {
  const { tx } = await import('./db');
  await tx(async c => {
    if (replace) await c.query('DELETE FROM rate_cards');
    for (const r of rates) {
      await c.query(`INSERT INTO rate_cards (brand, label, account, period, stream_type, method, tier, gmv_min, gmv_max, base_per_hour,
          total_comms, tiktok_comms, shopee_comms, agency_comms, valid_from, valid_to, active, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [r.brand, r.label, r.account, r.period, r.stream_type, r.method, r.tier, r.gmv_min, r.gmv_max, r.base_per_hour,
          r.total_comms, r.tiktok_comms, r.shopee_comms, r.agency_comms, r.valid_from, r.valid_to, r.active, r.notes]);
    }
  });
}
