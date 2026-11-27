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
  date: ['date', 'day of month', 'stream date'],
  start: ['start time', 'start', 'from', 'start_time'],
  end: ['end time', 'end', 'to', 'end_time'],
  time: ['time', 'timeslot', 'time slot', 'slot'],
  host: ['talent', 'host', 'host name', 'presenter'],
  brand: ['brand', 'client'],
  period: ['period', 'bau / mega', 'bau/mega', 'type'],
  sale: ['sale', 'sale campaign', 'campaign'],
  platform: ['platform', 'platforms', 'channel'],
  room: ['room', 'studio'],
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
  // The header is the first of the top 10 rows that names at least date, brand and platform.
  for (let i = 0; i < Math.min(10, rows.length); i++) {
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
}): Promise<{ rows: PlannedRow[]; error?: string }> {
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
  const hostBy = new Map(args.hosts.map(h => [h.name.toLowerCase(), h]));
  const brandBy = new Map(args.brands.map(b => [b.name.toLowerCase(), b]));
  const roomBy = new Map(args.rooms.map(r => [r.toLowerCase(), r]));
  const saleBy = new Map(args.saleDays.map(s => [s.name.toLowerCase(), s]));
  const existing = new Set(args.existing.map(e => [e.date, e.start_min, e.brand.toLowerCase(), e.platform.toLowerCase()].join('|')));
  const seen = new Set<string>();
  const prefix = isoDate(year, month, 1).slice(0, 8);
  const rows: PlannedRow[] = [];

  raw.slice(head.index + 1).forEach((r, i) => {
    if (!r.some(v => String(v ?? '').trim())) return; // blank line
    const errors: string[] = [], warnings: string[] = [];
    const date = parseDateLoose(get(r, 'date'), year, month);
    if (!date) errors.push(`Can't read the date "${String(get(r, 'date') ?? '')}"`);
    else if (!date.startsWith(prefix)) errors.push(`${fmtDate(date, true)} isn't in ${MONTH_NAMES[month]} ${year}`);

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
    const brand = brandBy.get(brandText.toLowerCase());
    if (!brandText) errors.push('No brand');
    else if (!brand) errors.push(`Unknown brand "${brandText}" (add it under Brands, rooms & team first)`);

    const platform = normalizePlatform(get(r, 'platform'));
    if (!platform) errors.push(`Platform "${String(get(r, 'platform') ?? '')}" must be TikTok, Shopee or TikTok & Shopee`);

    const hostText = String(get(r, 'host') ?? '').trim();
    const host = hostText ? hostBy.get(hostText.toLowerCase()) : null;
    if (hostText && !host) errors.push(`Unknown host "${hostText}" (check the spelling, or leave it blank to auto-assign)`);
    else if (host && !host.active) warnings.push(`${host.name} is inactive`);

    const pRaw = norm(get(r, 'period'));
    const period = pRaw.startsWith('mega') ? 'mega' : pRaw.startsWith('bau') ? 'bau' : '';
    if (pRaw && !period) warnings.push(`Period "${pRaw}" not recognised; using the calendar`);

    const saleText = String(get(r, 'sale') ?? '').trim().replace(/^-$/, '');
    const sale = saleText ? (saleBy.get(saleText.toLowerCase())?.name ?? saleText) : '';
    if (saleText && !saleBy.has(saleText.toLowerCase())) warnings.push(`Sale "${saleText}" isn't one of this month's sale days`);

    const roomText = String(get(r, 'room') ?? '').trim();
    const room = roomText ? roomBy.get(roomText.toLowerCase()) ?? '' : '';
    if (roomText && !room) warnings.push(`Unknown room "${roomText}" (ignored; the scheduler picks one)`);

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
  return { rows };
}

export const TEMPLATE_CSV =
  'date,start time,end time,talent,brand,period,sale,platform,room\n' +
  '11 Dec 2026,20:00,22:00,Carolyn,The Ordinary,Mega,Double digit D-1,Shopee,\n' +
  '1 Dec 2026,20:00,22:00,,Oatside,BAU,,TikTok & Shopee,\n' +
  '3 Dec 2026,16:00,18:00,Naomi,The Ordinary,BAU,,TikTok,Yellow Room\n';
