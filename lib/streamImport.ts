import ExcelJS from 'exceljs';
import { parseDateCell, parseTimeCell } from './workbook';
import { matchBrand, matchHost } from './preplannedFile';
import { PAY_STATUSES } from './earnings';

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

const PREFERRED = ['internal agency & total fees', 'new availability 2026'];

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

export async function readStreamFile(buf: ArrayBuffer, year: number, ref: {
  hosts: { id: number; name: string }[];
  brands: { name: string }[];
}): Promise<StreamFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const candidates = [...wb.worksheets].sort((a, b) => {
    const pa = PREFERRED.indexOf(a.name.trim().toLowerCase()), pb = PREFERRED.indexOf(b.name.trim().toLowerCase());
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
  let ws: ExcelJS.Worksheet | undefined, head: ReturnType<typeof headerOf> = null;
  for (const w of candidates) { head = headerOf(w); if (head) { ws = w; break; } }
  if (!ws || !head) throw new Error('Couldn’t find the stream list. Upload the Revenue Sheet or Master Availability Sheet as .xlsx (it needs Dates, Start Time, End Time, Talent/Host and Brand columns).');

  const c = head.cols;
  const col = (row: ExcelJS.Row, name: string) => (c[name] ? row.getCell(c[name]).value : null);
  const streams: SheetStream[] = [], skipped: StreamFile['skipped'] = [];
  const unknownHosts = new Set<string>(), unknownBrands = new Set<string>();
  const hostCache = new Map<string, { id: number | null; name: string }>();

  for (let r = head.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const brandText = text(row.getCell(head.brand).value);
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
      // "Esther, Naomi" is one stream with two hosts: kept as written, not linked to one host.
      const m = hostText && !/[,&/]/.test(hostText) ? matchHost(hostText, ref.hosts).host : undefined;
      h = m ? { id: m.id, name: m.name } : { id: null, name: hostText };
      if (!m && hostText) unknownHosts.add(hostText);
      hostCache.set(hostText, h);
    }
    const b = matchBrand(brandText, ref.brands).brand;
    if (!b) unknownBrands.add(brandText);

    const p = text(col(row, 'platform')).toLowerCase();
    const tt = p.includes('tiktok'), sp = p.includes('shopee');
    const periodRaw = text(col(row, 'period')).toLowerCase();
    const pay = PAY_STATUSES.find(s => s && s.toLowerCase() === status.toLowerCase()) || '';
    const tier = text(col(row, 'tier'));
    streams.push({
      row: r, date, start_min: start, end_min: end,
      hostText, host_id: h.id, host_name: h.name,
      brandText, brand: b?.name ?? brandText,
      period: periodRaw === 'mega' ? 'MEGA' : periodRaw === 'bau' ? 'BAU' : 'All',
      platform: tt && sp ? 'TikTok & Shopee' : tt ? 'TikTok' : sp ? 'Shopee' : text(col(row, 'platform')) || 'TikTok',
      room: text(col(row, 'room')),
      approved: approval === 'approved',
      pay_status: pay,
      tiktok_gmv: money(col(row, 'tiktok gmv')),
      shopee_gmv: money(col(row, 'shopee gmv')),
      rate_label: text(col(row, 'version')),
      tier: tier.toUpperCase() === 'NA' ? '' : tier,
      fee: money(col(row, 'talent fee')),
      notes: text(col(row, 'notes')).slice(0, 500),
    });
  }
  return { sheet: ws.name, streams, skipped, unknownHosts: [...unknownHosts].sort(), unknownBrands: [...unknownBrands].sort() };
}
