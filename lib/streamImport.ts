import ExcelJS from 'exceljs';
import { parseDateCell, parseTimeCell } from './workbook';
import { matchBrand, matchHost } from './preplannedFile';
import { PAY_STATUSES, splitHosts } from './earnings';

/**
 * Reads the 2026 stream log: the Revenue Sheet's "Internal Agency & Total Fees" tab or the Master
 * Availability Sheet's "NEW Availability 2026" tab (same columns). One row per stream, with sales,
 * rate version, tier and the talent fee the sheet worked out.
 */

export interface SheetStream {
  row: number;
  date: string;
  start_min: number;
  end_min: number;
  hostText: string;
  host_id: number | null;
  host_name: string;
  brandText: string;
  brand: string;
  period: 'BAU' | 'MEGA' | 'All';
  platform: string;
  room: string;
  approved: boolean;
  pay_status: string;
  tiktok_gmv: number | null;
  shopee_gmv: number | null;
  rate_label: string;
  tier: string;
  fee: number | null;
  notes: string;
}

export interface StreamFile {
  sheet: string;
  streams: SheetStream[];
  skipped: { row: number; reason: string }[];
  unknownHosts: string[];
  unknownBrands: string[];
}

const PREFERRED = ['internal agency & total fees', 'new availability 2026', 'availability 2025'];
const STREAM_LOG = /availability|internal agency|total fees/i;

/**
 * Google Sheets' Excel export writes IMPORTRANGE / array cells as
 * IFERROR(__xludf.DUMMYFUNCTION("..."), <value>) and sometimes leaves the cached result empty:
 * the value is then the formula's last argument.
 */
function dummyFallback(formula: unknown): string | number | null {
  if (typeof formula !== 'string' || !formula.includes('__xludf.DUMMYFUNCTION')) return null;
  const m = formula.match(/,\s*("((?:[^"]|"")*)"|-?\d+(?:\.\d+)?)\s*\)\s*$/);
  if (!m) return null;
  return m[2] != null ? m[2].replace(/""/g, '"') : Number(m[1]);
}

const noResult = (r: unknown) => r == null || (r instanceof Date && isNaN(r.getTime())); // empty cache reads as Invalid Date

function text(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o && noResult(o.result) && 'formula' in o) { const f = dummyFallback(o.formula); return f == null ? '' : String(f).trim(); }
    if ('result' in o) return text(o.result as ExcelJS.CellValue);
    if ('richText' in o) return (o.richText as { text: string }[]).map(t => t.text).join('');
    if ('text' in o) return String(o.text);
    return '';
  }
  return String(v).trim();
}
function money(v: ExcelJS.CellValue): number | null {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in (v as object)) {
    const o = v as { result: ExcelJS.CellValue; formula?: string };
    if (noResult(o.result) && o.formula) { const f = dummyFallback(o.formula); return f == null ? null : money(f as ExcelJS.CellValue); }
    return money(o.result);
  }
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
  const t = text(v).replace(/[$,\s]/g, '');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

/** Finds the header row (within the first 40 rows) and maps column names to numbers. */
function headerOf(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const cols: Record<string, number> = {};
    ws.getRow(r).eachCell((c, i) => { const h = text(c.value).toLowerCase(); if (h && !(h in cols)) cols[h] = i; });
    const brand = cols['brand name'] ?? cols['brand'];
    const host = cols['talent'] ?? cols['host'];
    if (cols['dates'] && brand && host && cols['start time'] && cols['end time']) return { row: r, cols, brand, host };
  }
  return null;
}

/** One year from the file (the tab with the most streams for that year). */
export async function readStreamFile(buf: ArrayBuffer, year: number, ref: {
  hosts: { id: number; name: string }[];
  brands: { name: string }[];
}): Promise<StreamFile> {
  return (await readStreamFileYears(buf, [year], ref)).find(r => r.year === year)!.file;
}

/**
 * Every year in the file (years = 'all') or the listed years. Several tabs can hold the same year
 * (2026, archives, per-host copies): for each year the tab with the most streams wins, ties going
 * to the preferred tab names.
 */
export async function readStreamFileYears(buf: ArrayBuffer, years: number[] | 'all', ref: {
  hosts: { id: number; name: string }[];
  brands: { name: string }[];
}): Promise<{ year: number; file: StreamFile }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const candidates = [...wb.worksheets].sort((a, b) => {
    const pa = PREFERRED.indexOf(a.name.trim().toLowerCase()), pb = PREFERRED.indexOf(b.name.trim().toLowerCase());
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  })
    // Only the stream logs: "NEW Availability 2026", "Availability 2025", "Internal Agency & Total Fees".
    // Planning tabs (MOOM slots), per-host copies and spare tabs look similar but would double up or mislead.
    .filter(w => STREAM_LOG.test(w.name) && !/archive|old\b|affiliate/i.test(w.name))
    .map(w => ({ w, head: headerOf(w) })).filter(x => x.head) as { w: ExcelJS.Worksheet; head: NonNullable<ReturnType<typeof headerOf>> }[];
  if (!candidates.length) throw new Error('Couldn\u2019t find the stream list. Upload the Master Availability Sheet (or Revenue Sheet) as .xlsx: it needs Dates, Start Time, End Time, Talent/Host and Brand columns.');

  let list: number[];
  if (years === 'all') {
    const found = new Set<number>();
    for (const { w, head } of candidates) {
      for (let r = head.row + 1; r <= w.rowCount; r++) {
        const row = w.getRow(r);
        if (!text(row.getCell(head.brand).value)) continue;
        const d = parseDateCell(head.cols['dates'] ? row.getCell(head.cols['dates']).value : null);
        if (d) found.add(Number(d.slice(0, 4)));
      }
    }
    list = [...found].sort();
  } else list = years;

  const out: { year: number; file: StreamFile }[] = [];
  for (const y of list) {
    let best: StreamFile | null = null;
    for (const { w, head } of candidates) {
      const res = readSheet(w, head, y, ref);
      if (!best || res.streams.length > best.streams.length) best = res;
    }
    if (best) out.push({ year: y, file: best });
  }
  return out;
}

function readSheet(ws: ExcelJS.Worksheet, head: NonNullable<ReturnType<typeof headerOf>>, year: number, ref: {
  hosts: { id: number; name: string }[];
  brands: { name: string }[];
}): StreamFile {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const c = head.cols;
  // A merged block (one stream typed over two rows) belongs to its first row only.
  const col = (row: ExcelJS.Row, name: string) => {
    if (!c[name]) return null;
    const cell = row.getCell(c[name]);
    return cell.isMerged && cell.master && cell.master.address !== cell.address ? null : cell.value;
  };
  // The 2025 tab has no Period column: an unlabelled first column marks Mega streams ("MEGA").
  const markerCol = !c['period'] && !Object.values(c).includes(1);
  const streams: SheetStream[] = [], skipped: StreamFile['skipped'] = [];
  const unknownHosts = new Set<string>(), unknownBrands = new Set<string>();
  const hostCache = new Map<string, { id: number | null; name: string }>();

  for (let r = head.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // 2025 tab writes "OATSIDE | Brand" / "Lays | Creator": the part after | is the account type.
    const brandText = text(row.getCell(head.brand).value).replace(/\s*\|\s*(brand|creator)\s*$/i, '');
    const date = parseDateCell(col(row, 'dates'));
    if (!brandText || !date) continue;                       // empty day rows
    if (!date.startsWith(String(year))) continue;
    const approval = text(col(row, 'amirul approval')).toLowerCase(), status = text(col(row, 'status'));
    if (approval === 'cancelled' || status.toLowerCase() === 'cancelled') { skipped.push({ row: r, reason: 'Cancelled' }); continue; }
    const start = parseTimeCell(col(row, 'start time')), endRaw = parseTimeCell(col(row, 'end time'));
    if (start == null || endRaw == null) { skipped.push({ row: r, reason: `${brandText} on ${date}: no start/end time` }); continue; }
    const end = endRaw <= start ? endRaw + 1440 : endRaw;    // 22:00-00:00 ends at midnight

    const hostText = text(row.getCell(head.host).value);
    let h = hostCache.get(hostText);
    if (!h) {
      const parts = splitHosts(hostText);
      if (parts.length > 1) {
        // "Esther, Naomi": one stream, two hosts. Each name is matched to the app's spelling; the fee
        // is shared equally in per-host views. Not linked to a single host login.
        const names = parts.map(p => { const m = matchHost(p, ref.hosts).host; if (!m) unknownHosts.add(p); return m?.name ?? p; });
        h = { id: null, name: names.join(', ') };
      } else {
        const m = hostText ? matchHost(hostText, ref.hosts).host : undefined;
        h = m ? { id: m.id, name: m.name } : { id: null, name: hostText };
        if (!m && hostText) unknownHosts.add(hostText);
      }
      hostCache.set(hostText, h);
    }
    const b = matchBrand(brandText, ref.brands).brand;
    if (!b) unknownBrands.add(brandText);

    const tiktokGmv = money(col(row, 'tiktok gmv')), shopeeGmv = money(col(row, 'shopee gmv'));
    const pText = text(col(row, 'platform')) || text(col(row, 'stream'));   // 2025 tab calls it "Stream"
    const p = pText.toLowerCase();
    let tt = p.includes('tiktok'), sp = p.includes('shopee');
    if (!tt && !sp) { tt = tiktokGmv != null; sp = shopeeGmv != null; }    // platform left blank: go by which GMV is filled in
    const statusNote = status && !PAY_STATUSES.some(x => x && x.toLowerCase() === status.toLowerCase()) ? `Sheet status: ${status}` : '';
    let fee = money(col(row, 'talent fee'));
    if (fee == null && (tiktokGmv != null || shopeeGmv != null) && (tiktokGmv ?? 0) + (shopeeGmv ?? 0) === 0) fee = 0; // $0 sales: $0 fee (export drops a 0 result)
    const marker = markerCol ? text(row.getCell(1).value) : '';
    const periodRaw = markerCol ? (marker.toUpperCase() === 'MEGA' ? 'mega' : 'bau') : text(col(row, 'period')).toLowerCase();
    const pay = PAY_STATUSES.find(s => s && s.toLowerCase() === status.toLowerCase()) || '';
    const tier = text(col(row, 'tier'));
    streams.push({
      row: r, date, start_min: start, end_min: end,
      hostText, host_id: h.id, host_name: h.name,
      brandText, brand: b?.name ?? brandText,
      period: periodRaw === 'mega' ? 'MEGA' : periodRaw === 'bau' ? 'BAU' : 'All',
      platform: tt && sp ? 'TikTok & Shopee' : tt ? 'TikTok' : sp ? 'Shopee' : pText || 'TikTok',
      room: text(col(row, 'room')) || text(col(row, 'location')),
      // Tabs without an approval column (2025) are a record of streams that happened.
      approved: approval === 'approved' || (!c['amirul approval'] && date <= today),
      pay_status: pay,
      tiktok_gmv: tiktokGmv,
      shopee_gmv: shopeeGmv,
      rate_label: text(col(row, 'version')),
      tier: tier.toUpperCase() === 'NA' ? '' : tier,
      fee,
      notes: [text(col(row, 'notes')), statusNote, marker && marker.toUpperCase() !== 'MEGA' ? marker : ''].filter(Boolean).join(' \u00b7 ').slice(0, 500),
    });
  }
  return { sheet: ws.name, streams, skipped, unknownHosts: [...unknownHosts].sort(), unknownBrands: [...unknownBrands].sort() };
}
