import ExcelJS from 'exceljs';
import { MONTH_NAMES, SLOTS, type PrefLevel, type RoomStatus } from './scheduler';

/** Normalized data read from the original Google Sheet export (.xlsx). */
export interface Dataset {
  year: number;
  month: number; // 0-based
  pct: { bauWeekday: number; bauWeekend: number; megaWeekday: number; megaWeekend: number };
  saleDays: { name: string; day: number }[];
  rooms: { name: string; status: RoomStatus }[];
  brands: string[];
  hosts: {
    name: string;
    gender: string;
    maxStreamsMonth: number | null;
    maxBrandPct: number | null;
    platforms: string;
    allowedRooms: string[] | null;
    prefs: Record<string, PrefLevel>;
  }[];
  /** ISO date YYYY-MM-DD */
  availability: { host: string; date: string; slot: number }[];
  commitments: { brand: string; period: 'bau' | 'mega'; sale: string; platform: string; qty: number; priority: number | null }[];
  preplanned: { date: string; start: number; end: number; host: string; brand: string; period: string; sale: string; platform: string; room: string }[];
  warnings: string[];
}

type Cell = ExcelJS.CellValue;

function unwrap(v: Cell): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return unwrap(o.result as Cell);
    if ('richText' in o) return (o.richText as { text: string }[]).map(t => t.text).join('');
    if ('text' in o) return o.text;
    if ('formula' in o || 'sharedFormula' in o) return null;
    if ('error' in o) return null;
  }
  return v;
}
const str = (v: Cell) => { const u = unwrap(v); return u == null ? '' : u instanceof Date ? u.toISOString() : String(u).trim(); };
const norm = (v: Cell) => str(v).toLowerCase();

export function titleCaseRoom(name: string) {
  return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export function isoDate(y: number, m0: number, d: number) {
  return y + '-' + String(m0 + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Parses a date cell into YYYY-MM-DD. Excel dates come through as UTC midnight. */
export function parseDateCell(v: Cell): string | null {
  const u = unwrap(v);
  if (u instanceof Date && !isNaN(u.getTime())) {
    // A date stored as UTC midnight, or as local midnight in a UTC+ zone (e.g. 23:00Z the previous day).
    const shifted = new Date(u.getTime() + 12 * 3600 * 1000);
    return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  }
  const s = str(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
  if (m) {
    const mi = MONTH_NAMES.findIndex(n => n.slice(0, 3).toLowerCase() === m![2].slice(0, 3).toLowerCase());
    return mi >= 0 ? isoDate(Number(m[3]), mi, Number(m[1])) : null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Parses a time cell into minutes from midnight. */
export function parseTimeCell(v: Cell): number | null {
  const u = unwrap(v);
  if (u instanceof Date && !isNaN(u.getTime())) return u.getUTCHours() * 60 + u.getUTCMinutes();
  if (typeof u === 'number') return u >= 0 && u < 1 ? Math.round(u * 1440) : u < 24 ? u * 60 : u;
  const s = str(v).toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (m) {
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (m[3] === 'PM' ? 12 : 0);
    return h * 60 + Number(m[2]);
  }
  if (/^\d{1,2}$/.test(s)) return Number(s) * 60;
  m = s.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (m) return ((Number(m[1]) % 12) + (m[2] === 'PM' ? 12 : 0)) * 60;
  return null;
}

export function parsePct(v: Cell, fallback: number): number {
  const u = unwrap(v);
  if (u === '' || u == null) return fallback;
  let n = parseFloat(String(u));
  if (String(u).includes('%') || n > 1) n /= 100;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function rows(ws: ExcelJS.Worksheet | undefined): Cell[][] {
  if (!ws) return [];
  const out: Cell[][] = [];
  const cols = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals: Cell[] = [];
    for (let c = 1; c <= cols; c++) vals.push(row.getCell(c).value);
    out.push(vals);
  }
  return out;
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<Dataset> {
  const wb = new ExcelJS.Workbook();
  // exceljs' type for load() is narrower than what it accepts at runtime.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const warnings: string[] = [];
  const required = ['Rules', 'Capacity', 'Commitment', 'Host_Availability', 'Host_Preferences', 'Pre_Planned_Streams'];
  const missing = required.filter(n => !wb.getWorksheet(n));
  if (missing.length) throw new Error('Missing required tabs: ' + missing.join(', '));

  // Rules
  const ruleRows = rows(wb.getWorksheet('Rules'));
  const rules: Record<string, Cell> = {};
  ruleRows.forEach(r => { if (str(r[0])) rules[norm(r[0])] = r[1]; });
  let year: number, month: number;
  const mv = unwrap(rules['month']);
  if (mv instanceof Date) {
    const d = parseDateCell(mv)!;
    year = Number(d.slice(0, 4)); month = Number(d.slice(5, 7)) - 1;
  } else {
    const parts = str(rules['month']).split(/\s+/);
    month = MONTH_NAMES.findIndex(n => n.toLowerCase() === (parts[0] || '').toLowerCase());
    year = Number(parts[1]);
  }
  if (month < 0 || !Number.isInteger(year)) throw new Error('Invalid Rules > month. Use a date or e.g. "December 2026".');
  const pct = {
    bauWeekday: parsePct(rules['maximum day slots for bau weekday'], 0.2),
    bauWeekend: parsePct(rules['maximum day slots for bau weekend'], 0.5),
    megaWeekday: parsePct(rules['maximum day slots for mega weekday'], 0.2),
    megaWeekend: parsePct(rules['maximum day slots for mega weekend'], 0.5),
  };
  const allowedRooms: Record<string, string[] | null> = {};
  const saleDays: { name: string; day: number }[] = [];
  ruleRows.slice(1).forEach(r => {
    const host = str(r[3]);
    if (host && norm(r[3]) !== 'host name') {
      const raw = norm(r[4]);
      allowedRooms[host] = !raw || raw === 'all' ? null : raw.split(',').map(x => x.trim()).filter(Boolean);
    }
    const sale = str(r[6]), day = Number(unwrap(r[7]));
    if (sale && norm(r[6]) !== 'campaign / sale type' && Number.isInteger(day) && day >= 1 && day <= 31) saleDays.push({ name: sale, day });
  });

  // Capacity: one status per room (last row wins, as in the Apps Script).
  const roomOrder: string[] = [];
  const roomStatus: Record<string, RoomStatus> = {};
  rows(wb.getWorksheet('Capacity')).slice(1).forEach(r => {
    const name = str(r[0]); if (!name) return;
    const n = titleCaseRoom(name);
    if (!roomOrder.includes(n)) roomOrder.push(n);
    const s = norm(r[4]);
    roomStatus[n] = s === 'unavailable' ? 'unavailable' : s === 'last resort' ? 'last resort' : 'available';
  });
  const rooms = roomOrder.map(name => ({ name, status: roomStatus[name] }));

  // Host preferences
  const pref = rows(wb.getWorksheet('Host_Preferences'));
  const prefHosts = (pref[0] || []).slice(1).map(str);
  const hostInfo: Record<string, Dataset['hosts'][number]> = {};
  const brands: string[] = [];
  prefHosts.forEach(h => {
    if (h) hostInfo[h] = { name: h, gender: '', maxStreamsMonth: null, maxBrandPct: null, platforms: '', allowedRooms: null, prefs: {} };
  });
  pref.slice(1).forEach(r => {
    const label = norm(r[0]); if (!label) return;
    const isBrand = !['gender', 'platforms', 'max_streams_month', 'max streams', 'monthly cap', 'max_brand_pct', 'brand cap', 'max brand %'].includes(label);
    if (isBrand && !brands.some(b => b.toLowerCase() === label)) brands.push(str(r[0]));
    prefHosts.forEach((h, j) => {
      if (!h) return;
      const raw = r[j + 1];
      const info = hostInfo[h];
      if (label === 'gender') info.gender = str(raw);
      else if (label === 'platforms') info.platforms = str(raw);
      else if (['max_streams_month', 'max streams', 'monthly cap'].includes(label)) {
        const n = Number(unwrap(raw));
        if (str(raw) !== '' && Number.isInteger(n) && n >= 0) info.maxStreamsMonth = n;
      } else if (['max_brand_pct', 'brand cap', 'max brand %'].includes(label)) {
        if (str(raw) !== '') { const p = parsePct(raw, NaN); info.maxBrandPct = Number.isFinite(p) ? p : null; }
      } else {
        const v = norm(raw);
        info.prefs[str(r[0])] = ['preferred', 'p', '1', 'yes'].includes(v) ? 'preferred' :
          ['regular', 'r', 'eligible', 'allowed'].includes(v) ? 'regular' : 'excluded';
      }
    });
  });

  // Host availability (host order = availability header order, as in the Apps Script)
  const av = rows(wb.getWorksheet('Host_Availability'));
  const avHosts = (av[0] || []).slice(4).map(str);
  const hostOrder = avHosts.filter(Boolean);
  prefHosts.filter(h => h && !hostOrder.includes(h)).forEach(h => {
    hostOrder.push(h);
    warnings.push('Host "' + h + '" is in Host_Preferences but not in Host_Availability.');
  });
  const availability: Dataset['availability'] = [];
  av.slice(1).forEach(r => {
    const date = parseDateCell(r[0]);
    const slot = (SLOTS as readonly string[]).indexOf(str(r[3]));
    if (!date || slot < 0) return;
    avHosts.forEach((h, j) => {
      if (!h) return;
      const v = unwrap(r[j + 4]);
      if (v === true || v === 1 || ['true', 'y', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase())) availability.push({ host: h, date, slot });
    });
  });
  const hosts = hostOrder.map(h => {
    const info = hostInfo[h] || { name: h, gender: '', maxStreamsMonth: null, maxBrandPct: null, platforms: '', allowedRooms: null, prefs: {} };
    if (!hostInfo[h]) warnings.push('Host "' + h + '" has availability but no column in Host_Preferences.');
    return { ...info, allowedRooms: allowedRooms[h] ?? null };
  });

  // Commitments
  const commitments: Dataset['commitments'] = [];
  rows(wb.getWorksheet('Commitment')).slice(1).forEach((r, i) => {
    if (!str(r[0]) && !str(r[4])) return;
    const brand = str(r[0]), period = norm(r[1]), qty = Number(unwrap(r[4])), pr = Number(unwrap(r[5]));
    if (!brand || !['bau', 'mega'].includes(period) || !Number.isInteger(qty) || qty < 0 || !str(r[3])) {
      warnings.push('Skipped invalid Commitment row ' + (i + 2) + '.'); return;
    }
    if (!brands.some(b => b.toLowerCase() === brand.toLowerCase())) brands.push(brand);
    commitments.push({ brand, period: period as 'bau' | 'mega', sale: str(r[2]) || '-', platform: str(r[3]), qty, priority: Number.isFinite(pr) && pr > 0 ? pr : null });
  });

  // Pre-planned streams
  const preplanned: Dataset['preplanned'] = [];
  rows(wb.getWorksheet('Pre_Planned_Streams')).slice(1).forEach((r, i) => {
    if (!r.some(x => str(x))) return;
    const date = parseDateCell(r[0]), start = parseTimeCell(r[2]), end = parseTimeCell(r[3]);
    if (!date || start == null || end == null || !str(r[5]) || !str(r[8])) {
      warnings.push('Skipped invalid Pre_Planned_Streams row ' + (i + 2) + '.'); return;
    }
    preplanned.push({ date, start, end, host: str(r[4]), brand: str(r[5]), period: norm(r[6]), sale: str(r[7]), platform: str(r[8]), room: str(r[9]) ? titleCaseRoom(str(r[9])) : '' });
  });

  return { year, month, pct, saleDays, rooms, brands, hosts, availability, commitments, preplanned, warnings };
}

/** Restricts a dataset to the scheduler input for its month (used by tests and the importer preview). */
export function datasetToSchedulerInput(ds: Dataset) {
  const prefix = isoDate(ds.year, ds.month, 1).slice(0, 8);
  return {
    year: ds.year,
    month: ds.month,
    pct: ds.pct,
    saleDays: ds.saleDays,
    rooms: ds.rooms,
    hosts: ds.hosts,
    availability: ds.availability.filter(a => a.date.startsWith(prefix)).map(a => ({ host: a.host, day: Number(a.date.slice(8)), slot: a.slot })),
    commitments: ds.commitments.map((c, i) => ({ id: i, ...c })),
    preplanned: ds.preplanned.map((p, i) => ({
      day: p.date.startsWith(prefix) ? Number(p.date.slice(8)) : 0,
      start: p.start, end: p.end, host: p.host, brand: p.brand, period: p.period, sale: p.sale, platform: p.platform, room: p.room,
      source: 'Pre-planned #' + (i + 1),
    })),
  };
}
