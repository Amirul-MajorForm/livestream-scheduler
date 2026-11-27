import 'server-only';
import ExcelJS from 'exceljs';
import { parsePlatforms, MONTH_NAMES } from './scheduler';
import { isoDate, parseDateCell, parseTimeCell } from './workbook';
import { fmtDate, fmtRange } from './format';

/**
 * Reads a pre-planned streams file (.csv or .xlsx) for one month and checks every row against the
 * app's hosts, brands, rooms and sale days. Columns are matched by name (any order, any case), using
 * the same headings as the Google Sheet's Pre_Planned_Streams tab.
 */

export interface PlannedRow {
  line: number; // row number in the file (header = 1)
  date: string | null;
  start: number | null;
  end: number | null;
  hostId: number | null;
  hostName: string;
  brandId: number | null;
  brandName: string;
  period: string; // '', 'bau', 'mega'
  sale: string;
  platform: string;
  room: string;
  errors: string[]; // row will be skipped
  warnings: string[]; // row is imported, but check it
  duplicate: boolean; // same date/time/brand/platform as an existing pre-planned stream
  summary: string;
}

type Cell = unknown;

const HEADERS: Record<string, string[]> = {
  date: ['date', 'dates', 'day of month', 'stream date'],
  start: ['start time', 'start', 'from', 'start_time'],
  end: ['end time', 'end', 'to', 'end_time'],
  time: ['time', 'timeslot', 'time slot', 'slot'],
  host: ['talent', 'host', 'host name', 'talent name', 'presenter', 'streamer'],
  brand: ['brand', 'client'],
  period: ['period', 'bau / mega', 'bau/mega', 'type'],
  sale: ['sale', 'sale campaign', 'campaign'],
  platform: ['platform', 'platforms', 'channel'],
  room: ['room', 'studio', 'location'],
  approval: ['amirul approval', 'approval', 'approved'],
  status: ['status', 'stream status'],
};

const norm = (v: Cell) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Minimal CSV parser: commas or semicolons, quoted fields, "" escapes, CRLF. */
function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readRows(name: string, buffer: Buffer): Promise<Cell[][]> {
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) return parseCsv(buffer.toString('utf8'));
  if (!/\.xlsx$/i.test(name)) throw new Error('Upload a .csv or .xlsx file (in Excel or Google Sheets: File → Download → .xlsx or .csv).');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  // Prefer a tab named like the sheet's Pre_Planned_Streams; otherwise the first tab with data.
  const ws = wb.worksheets.find(w => /pre.?planned/i.test(w.name)) || wb.worksheets.find(w => w.rowCount > 1) || wb.worksheets[0];
  if (!ws) return [];
  const out: Cell[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals: Cell[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      let v = row.getCell(c).value as any;
      if (v && typeof v === 'object' && !(v instanceof Date)) v = 'result' in v ? v.result : 'richText' in v ? v.richText.map((x: any) => x.text).join('') : 'text' in v ? v.text : null;
      vals.push(v);
    }
    out.push(vals);
  }
  return out;
}

function findHeader(rows: Cell[][]) {
  // The header is the first of the top 60 rows that names at least date, brand and platform
  // (planning sheets often start with a block of notes).
  for (let i = 0; i < Math.min(60, rows.length); i++) {
    const cols: Record<string, number> = {};
    rows[i].forEach((v, j) => {
      const h = norm(v);
      for (const [key, names] of Object.entries(HEADERS)) if (names.includes(h) && cols[key] === undefined) cols[key] = j;
    });
    if (cols.date !== undefined && cols.brand !== undefined && cols.platform !== undefined) return { index: i, cols };
  }
  return null;
}

/** Accepts "Dec 11", "11 Dec", "11/12", "11" (day of this month) in addition to the full date formats. */
function parseDateLoose(v: Cell, year: number, month: number): string | null {
  const full = parseDateCell(v as any);
  if (full) return full;
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})$/);
  if (m) return isoDate(year, month, Number(m[1]));
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return isoDate(year, Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?$/) || s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (m) {
    const [d, name] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const mi = MONTH_NAMES.findIndex(n => n.slice(0, 3).toLowerCase() === name.slice(0, 3).toLowerCase());
    if (mi >= 0) return isoDate(year, mi, Number(d));
  }
  return null;
}

/** "TT", "Both", "TikTok + Shopee" etc. -> "TikTok" / "Shopee" / "TikTok & Shopee". */
function normalizePlatform(v: Cell): string | null {
  const s = norm(v).replace(/\bboth\b/, 'tiktok & shopee').replace(/\btt\b/g, 'tiktok').replace(/\bsp\b/g, 'shopee').replace(/\+|\//g, '&');
  const p = parsePlatforms(s);
  if (!p) return null;
  return p.has('tiktok') && p.has('shopee') ? 'TikTok & Shopee' : p.has('tiktok') ? 'TikTok' : 'Shopee';
}

const words = (s: string) => s.toLowerCase().replace(/[()\[\].,&]/g, ' ').split(/\s+/).filter(Boolean);
const FILLER = new Set(['professional', 'pro', 'official', 'store', 'sg', 'singapore']);

/** Brand by exact name (any case), else ignoring filler words ("Shiseido Professional" -> Shiseido). */
export function matchBrand<B extends { name: string }>(text: string, brands: B[]): { brand?: B; fuzzy: boolean } {
  const t = text.trim().toLowerCase();
  const exact = brands.find(b => b.name.toLowerCase() === t);
  if (exact) return { brand: exact, fuzzy: false };
  const core = (x: string) => words(x).filter(w => !FILLER.has(w)).join(' ');
  const c = core(text);
  const hits = brands.filter(b => core(b.name) === c || (c.length >= 4 && (core(b.name).startsWith(c) || c.startsWith(core(b.name)))));
  return hits.length === 1 ? { brand: hits[0], fuzzy: true } : { fuzzy: false };
}

/** Host by exact name, else same words in any order ("Xin Hui (Felicia)" -> "Felicia Xin Hui"), else a unique short name ("Cassandra" -> "Cass"). */
function matchHost<H extends { name: string }>(text: string, hosts: H[]): { host?: H; fuzzy: boolean } {
  const t = text.trim().toLowerCase();
  const exact = hosts.find(h => h.name.toLowerCase() === t);
  if (exact) return { host: exact, fuzzy: false };
  const key = (x: string) => words(x).sort().join(' ');
  const same = hosts.filter(h => key(h.name) === key(text));
  if (same.length === 1) return { host: same[0], fuzzy: true };
  const first = words(text)[0] || '';
  const pre = hosts.filter(h => { const n = h.name.toLowerCase(); return n.length >= 3 && (first.startsWith(n) || n.startsWith(first)) && first.length >= 3; });
  return pre.length === 1 ? { host: pre[0], fuzzy: true } : { fuzzy: false };
}

export async function readPreplannedFile(args: {
  fileName: string;
  buffer: Buffer;
  year: number;
  month: number; // 0-based
  hosts: { id: number; name: string; active: boolean }[];
  brands: { id: number; name: string }[];
  rooms: string[];
  saleDays: { name: string; day: number }[];
  existing: { date: string; start_min: number; brand: string; platform: string }[];
}): Promise<{ rows: PlannedRow[]; error?: string; otherMonths?: number; cancelled?: number }> {
  const { year, month } = args;
  let raw: Cell[][];
  try {
    raw = await readRows(args.fileName, args.buffer);
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
  const head = findHeader(raw);
  if (!head) return { rows: [], error: 'Could not find a header row with at least Date, Brand and Platform columns. Download the template to see the expected columns.' };
  const { cols } = head;
  const get = (r: Cell[], k: string) => (cols[k] === undefined ? '' : r[cols[k]]);
  const roomBy = new Map(args.rooms.map(r => [r.toLowerCase(), r]));
  const saleBy = new Map(args.saleDays.map(s => [s.name.toLowerCase(), s]));
  const existing = new Set(args.existing.map(e => [e.date, e.start_min, e.brand.toLowerCase(), e.platform.toLowerCase()].join('|')));
  const seen = new Set<string>();
  const prefix = isoDate(year, month, 1).slice(0, 8);
  const rows: PlannedRow[] = [];
  let otherMonths = 0;
  const many = raw.length - head.index - 1 > 200; // a whole-year sheet: quietly ignore other months

  raw.slice(head.index + 1).forEach((r, i) => {
    if (!r.some(v => String(v ?? '').trim())) return; // blank line
    // Placeholder rows (a date with no brand and no times) are just calendar filler.
    // Also rows with only a time and nothing about the stream (no brand, host or platform).
    const blank = (k: string) => !String(get(r, k) ?? '').trim();
    if (blank('brand') && ((blank('start') && blank('time')) || (blank('host') && blank('platform')))) return;
    const errors: string[] = [], warnings: string[] = [];
    const date = parseDateLoose(get(r, 'date'), year, month);
    if (date && !date.startsWith(prefix) && many) { otherMonths++; return; }
    if (!date) errors.push(`Can't read the date "${String(get(r, 'date') ?? '')}"`);
    else if (!date.startsWith(prefix)) errors.push(`${fmtDate(date, true)} isn't in ${MONTH_NAMES[month]} ${year}`);
    if ([get(r, 'approval'), get(r, 'status')].some(v => norm(v) === 'cancelled' || norm(v) === 'canceled')) errors.push('Cancelled in the sheet');

    let start = parseTimeCell(get(r, 'start') as any), end = parseTimeCell(get(r, 'end') as any);
    if ((start == null || end == null) && cols.time !== undefined) {
      const parts = String(get(r, 'time') ?? '').split(/\s*(?:-|–|to)\s*/i);
      if (parts.length === 2) {
        start = parseTimeCell(parts[0].replace(/(\d)(am|pm)/i, '$1 $2') as any);
        end = parseTimeCell(parts[1].replace(/MN$/i, 'AM').replace(/(\d)(am|pm)/i, '$1 $2') as any);
        if (/^12\s*mn$/i.test(parts[1].trim())) end = 1440;
      }
    }
    if (end === 0) end = 1440;
    if (start == null || end == null) errors.push('Missing or unreadable start/end time');
    else if (end <= start) errors.push('End time must be after start time');
    else if (start < 10 * 60 || end > 24 * 60) warnings.push('Outside the 10AM–12MN streaming day');

    const brandText = String(get(r, 'brand') ?? '').trim();
    const { brand, fuzzy: brandFuzzy } = brandText ? matchBrand(brandText, args.brands) : { brand: undefined, fuzzy: false };
    if (!brandText) errors.push('No brand');
    else if (!brand) errors.push(`Unknown brand "${brandText}" (add it under Brands, rooms & team first)`);
    else if (brandFuzzy) warnings.push(`"${brandText}" read as ${brand.name}`);

    const platform = normalizePlatform(get(r, 'platform'));
    if (!platform) errors.push(`Platform "${String(get(r, 'platform') ?? '')}" must be TikTok, Shopee or TikTok & Shopee`);

    const hostText = String(get(r, 'host') ?? '').trim();
    const { host, fuzzy: hostFuzzy } = hostText ? matchHost(hostText, args.hosts) : { host: undefined, fuzzy: false };
    if (hostText && !host) errors.push(`Unknown host "${hostText}" (check the spelling, or leave it blank to auto-assign)`);
    else if (host && hostFuzzy) warnings.push(`"${hostText}" read as ${host.name}`);
    if (host && !host.active) warnings.push(`${host.name} is inactive`);

    const pRaw = norm(get(r, 'period'));
    const period = pRaw.startsWith('mega') ? 'mega' : pRaw.startsWith('bau') ? 'bau' : '';
    // "All" (or "BAU & Mega") means the sale calendar decides.
    if (pRaw && !period && !['all', 'both', 'bau & mega', 'bau/mega'].includes(pRaw)) warnings.push(`Period "${pRaw}" not recognised; using the calendar`);

    const saleText = String(get(r, 'sale') ?? '').trim().replace(/^-$/, '');
    const sale = saleText ? (saleBy.get(saleText.toLowerCase())?.name ?? saleText) : '';
    if (saleText && !saleBy.has(saleText.toLowerCase())) warnings.push(`Sale "${saleText}" isn't one of this month's sale days`);

    const roomText = String(get(r, 'room') ?? '').trim();
    const room = roomText ? roomBy.get(roomText.toLowerCase()) ?? '' : '';
    // "MajorStudio..." means any studio room: let the scheduler pick, no warning.
    if (roomText && !room && !/^majorstudio|^studio|^any$/i.test(roomText.replace(/\s+/g, ''))) warnings.push(`Room "${roomText}" isn't one of the app's rooms (the scheduler picks one)`);

    const key = [date, start, (brand?.name || brandText).toLowerCase(), (platform || '').toLowerCase()].join('|');
    const duplicate = existing.has(key);
    if (seen.has(key) && !errors.length) errors.push('Same as an earlier row in this file');
    seen.add(key);

    rows.push({
      line: head.index + 2 + i, date, start, end,
      hostId: host?.id ?? null, hostName: host?.name ?? '',
      brandId: brand?.id ?? null, brandName: brand?.name ?? brandText,
      period, sale, platform: platform ?? '', room, errors, warnings, duplicate,
      summary: `${date ? fmtDate(date) : '?'} ${start != null && end != null ? fmtRange(start, end) : '?'} ${brand?.name ?? brandText} · ${platform ?? '?'} · ${host?.name ?? 'auto-assign'}`,
    });
  });
  return { rows, otherMonths, cancelled: rows.filter(r => r.errors.includes('Cancelled in the sheet')).length };
}

export const TEMPLATE_CSV =
  'date,start time,end time,talent,brand,period,sale,platform,room\n' +
  '11 Dec 2026,20:00,22:00,Carolyn,The Ordinary,Mega,Double digit D-1,Shopee,\n' +
  '1 Dec 2026,20:00,22:00,,Oatside,BAU,,TikTok & Shopee,\n' +
  '3 Dec 2026,16:00,18:00,Naomi,The Ordinary,BAU,,TikTok,Yellow Room\n';
