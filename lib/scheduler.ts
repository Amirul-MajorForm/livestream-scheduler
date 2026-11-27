/**
 * MajorForm livestream scheduler.
 *
 * A faithful port of the Google Apps Script "MAJORFORM LIVESTREAM SCHEDULER V7"
 * into a pure function: no spreadsheet I/O, all inputs are passed in and the
 * schedule + summary are returned. Rules carried over unchanged:
 *  - All automatically allocated streams MUST have an eligible, available host.
 *  - Pre-planned bookings are preserved even when they exceed commitments.
 *    Blank-host bookings get an eligible host where possible.
 *  - Odd-hour bookings reserve overlapping hosts/rooms; unhosted bookings still reserve rooms.
 *  - Host brand AND platform eligibility are hard constraints; blank eligibility is denied.
 */

export const SLOTS = ['10AM-12PM', '12PM-2PM', '2PM-4PM', '4PM-6PM', '6PM-8PM', '8PM-10PM', '10PM-12MN'] as const;
export const START_MINS = [600, 720, 840, 960, 1080, 1200, 1320];
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type Period = 'bau' | 'mega';
export type PrefLevel = 'preferred' | 'regular' | 'excluded';
export type RoomStatus = 'available' | 'unavailable' | 'last resort';

export interface SchedulerHost {
  name: string;
  gender: string;
  maxStreamsMonth: number | null;
  /** fraction 0..1 */
  maxBrandPct: number | null;
  /** raw, e.g. "TikTok, Shopee" */
  platforms: string;
  /** lowercase room names; null = all rooms */
  allowedRooms: string[] | null;
  /** keyed by brand name (any case) */
  prefs: Record<string, PrefLevel>;
}

export interface SchedulerCommitment {
  id: number;
  brand: string;
  period: string;
  /** comma separated sale names, "-" for BAU, or "all" */
  sale: string;
  platform: string;
  qty: number;
  priority: number | null;
}

export interface SchedulerPreplanned {
  /** day of month */
  day: number;
  /** minutes from midnight */
  start: number;
  end: number;
  host: string;
  brand: string;
  period: string;
  sale: string;
  platform: string;
  room: string;
  source: string;
}

/**
 * Adjustable planning rules (edited on the admin "Planning rules" page).
 * ORIGINAL_RULES reproduces the Apps Script V7 behaviour exactly.
 */
export interface PlanningRules {
  /** Same brand at the same time is fine when the platforms don't overlap (TikTok vs Shopee). */
  sameBrandDifferentPlatformOk: boolean;
  /** Most streams one host can do in a day. */
  maxStreamsPerHostPerDay: number;
  /** BAU streams on Fridays: 'avoid' (soft), 'never' (hard), 'allow'. */
  fridayBau: 'avoid' | 'never' | 'allow';
  /** Female hosts late: 'avoid-alone' (soft: avoid being the only stream from 6PM), 'never' (hard: no 10PM-12MN), 'allow'. */
  lateFemale: 'avoid-alone' | 'never' | 'allow';
  /** Pairs of brands that must not stream at the same time (e.g. space or product clashes). */
  brandsApart: [string, string][];
}

export const ORIGINAL_RULES: PlanningRules = {
  sameBrandDifferentPlatformOk: false,
  maxStreamsPerHostPerDay: 2,
  fridayBau: 'avoid',
  lateFemale: 'avoid-alone',
  brandsApart: [],
};

export interface SchedulerInput {
  year: number;
  /** 0-based month */
  month: number;
  pct: { bauWeekday: number; bauWeekend: number; megaWeekday: number; megaWeekend: number };
  saleDays: { name: string; day: number }[];
  /** order matters: it is the room preference order */
  rooms: { name: string; status: RoomStatus }[];
  /** order matters: it is the host column order of the sheet */
  hosts: SchedulerHost[];
  availability: { host: string; day: number; slot: number }[];
  commitments: SchedulerCommitment[];
  preplanned: SchedulerPreplanned[];
  trials?: number;
  /** Defaults to ORIGINAL_RULES. */
  rules?: Partial<PlanningRules>;
}

export interface ScheduledStream {
  day: number;
  start: number;
  end: number;
  host: string;
  brand: string;
  period: 'BAU' | 'MEGA';
  sale: string;
  platform: string;
  room: string;
  fixed: boolean;
  autoAssignedHost: boolean;
  commitmentId: number | null;
  source: string | null;
}

export interface SummarySection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface SchedulerResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  streams: ScheduledStream[];
  sections: SummarySection[];
  stats: { committed: number; fulfilled: number; unfulfilled: number; extraPreplanned: number; unhostedPreplanned: number };
  message: string;
}

interface Placement {
  day: number;
  slot: number;
  start?: number;
  end?: number;
  host: string;
  room: string;
  brand: string;
  platform: string;
  commitmentId?: number | null;
  fixed: boolean;
  // preplanned only
  requestedRoom?: string;
  period?: Period;
  sale?: string;
  source?: string;
  autoAssignedHost?: boolean;
}

interface State {
  items: Placement[];
  byHost: Map<string, number>;
  byHostBrand: Map<string, number>;
  byHostDay: Map<string, Placement[]>;
  byCommit: Map<number, number>;
  // Indexes (performance only; they never change results)
  byDay: Map<number, Placement[]>;
  byCommitItems: Map<number, Placement[]>;
  doubleDays: Map<string, number>;
}

const normCache = new Map<string, string>();
const norm = (x: unknown) => {
  if (typeof x === 'string') {
    let v = normCache.get(x);
    if (v === undefined) { v = x.trim().toLowerCase(); if (normCache.size < 50000) normCache.set(x, v); }
    return v;
  }
  return String(x == null ? '' : x).trim().toLowerCase();
};
const str = (x: unknown) => String(x == null ? '' : x).trim();
const key = (a: string | number, b: string | number) => a + '||' + b;

const platformCache = new Map<string, Set<string> | null>();
/** Parses "TikTok, Shopee" / "TikTok & Shopee". The returned Set is shared: do not mutate it. */
export function parsePlatforms(value: unknown): Set<string> | null {
  const k = String(value == null ? '' : value);
  if (platformCache.has(k)) return platformCache.get(k)!;
  const r = parsePlatformsUncached(value);
  if (platformCache.size < 1000) platformCache.set(k, r);
  return r;
}
function parsePlatformsUncached(value: unknown): Set<string> | null {
  const raw = norm(value).replace(/\band\b/g, ',').replace(/&/g, ',');
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
  const valid = parts.length > 0 && parts.every(x => x === 'tiktok' || x === 'shopee');
  return valid ? new Set(parts) : null;
}

export function formatTime(m: number) {
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}

export function runScheduler(input: SchedulerInput): SchedulerResult {
  const { year, month } = input;
  const slots = SLOTS;
  const startMins = START_MINS;
  const rooms = input.rooms.map(r => r.name);
  const rules: PlanningRules = { ...ORIGINAL_RULES, ...(input.rules || {}) };
  const maxPerDay = Math.max(1, rules.maxStreamsPerHostPerDay);
  const apart = new Set(rules.brandsApart.flatMap(([a, b]) => [norm(a) + '|' + norm(b), norm(b) + '|' + norm(a)]));
  /** Do two streams of these brands/platforms clash if they overlap in time? */
  const brandConflict = (xBrand: string, xPlatform: string, pBrand: string, pPlatform: string) => {
    if (norm(xBrand) === norm(pBrand)) {
      if (!rules.sameBrandDifferentPlatformOk) return true;
      const a = parsePlatforms(xPlatform), b = parsePlatforms(pPlatform);
      return !a || !b || [...a].some(x => b.has(x));
    }
    return apart.size > 0 && apart.has(norm(xBrand) + '|' + norm(pBrand));
  };
  const warnings: string[] = [];
  const errors: string[] = [];

  const fail = (message: string): SchedulerResult => ({
    ok: false, errors, warnings, streams: [], sections: [],
    stats: { committed: 0, fulfilled: 0, unfulfilled: 0, extraPreplanned: 0, unhostedPreplanned: 0 },
    message,
  });

  const platformMatch = (hostPlatforms: Set<string> | null, required: string) => {
    const needed = parsePlatforms(required);
    return !!needed && !!hostPlatforms && [...needed].every(p => hostPlatforms.has(p));
  };

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dateLabel = (d: number) => d + ' ' + MONTH_NAMES[month].slice(0, 3) + ' ' + year;
  const pctLimits: Record<Period, [number, number]> = {
    bau: [input.pct.bauWeekday, input.pct.bauWeekend],
    mega: [input.pct.megaWeekday, input.pct.megaWeekend],
  };

  const roomStatus: Record<string, string> = {};
  input.rooms.forEach(r => { roomStatus[norm(r.name)] = norm(r.status) || 'available'; });
  const roomAllowed = (room: string) => (roomStatus[norm(room)] || 'available') !== 'unavailable';

  const permissions: Record<string, string[] | null> = {};
  input.hosts.forEach(h => {
    permissions[h.name] = h.allowedRooms && h.allowedRooms.length ? h.allowedRooms.map(norm) : null;
  });
  const canUseRoom = (host: string, room: string) => !permissions[host] || permissions[host]!.includes(norm(room));

  const megaDates: Record<number, string> = {};
  const saleDisplay: Record<string, string> = {};
  input.saleDays.forEach(s => {
    const sale = norm(s.name), day = Number(s.day);
    if (sale && Number.isInteger(day) && day >= 1 && day <= daysInMonth) {
      megaDates[day] = sale;
      saleDisplay[sale] = str(s.name);
    }
  });

  const hosts = input.hosts.map(h => h.name);
  if (new Set(hosts).size !== hosts.length) errors.push('Duplicate host names.');
  const available: Record<string, Set<string>> = {};
  // Insert in host order so iteration order matches the sheet's column order.
  const availByHost = new Map<string, Set<string>>();
  input.availability.forEach(a => {
    if (!availByHost.has(a.host)) availByHost.set(a.host, new Set());
    availByHost.get(a.host)!.add(key(a.day, a.slot));
  });
  for (let d = 1; d <= daysInMonth; d++) {
    for (let s = 0; s < slots.length; s++) {
      const k = key(d, s);
      const set = new Set<string>();
      hosts.forEach(h => { if (availByHost.get(h)?.has(k)) set.add(h); });
      available[k] = set;
    }
  }

  const preferences: Record<string, PrefLevel> = {};
  const caps: Record<string, number> = {};
  const brandCaps: Record<string, number> = {};
  const gender: Record<string, string> = {};
  const platforms: Record<string, Set<string> | null> = {};
  input.hosts.forEach(h => {
    gender[h.name] = norm(h.gender);
    platforms[h.name] = parsePlatforms(h.platforms);
    if (h.maxStreamsMonth != null && Number.isInteger(h.maxStreamsMonth) && h.maxStreamsMonth >= 0) caps[h.name] = h.maxStreamsMonth;
    if (h.maxBrandPct != null) brandCaps[h.name] = h.maxBrandPct;
    Object.entries(h.prefs).forEach(([brand, level]) => { preferences[key(norm(brand), h.name)] = level; });
  });
  hosts.forEach(h => {
    if (!(h in caps)) errors.push('Host "' + h + '" has no valid max streams per month.');
    if (!(h in brandCaps) || !Number.isFinite(brandCaps[h]) || brandCaps[h] <= 0)
      errors.push('Host "' + h + '" has no valid positive max brand %.');
    if (!platforms[h] || !platforms[h]!.size) errors.push('Host "' + h + '" has no platforms configured (TikTok, Shopee, or both).');
  });

  const commitments: { id: number; brand: string; period: Period; sale: string; platform: string; qty: number; priority: number }[] = [];
  input.commitments.forEach((r, i) => {
    if (!str(r.brand) && !str(r.qty)) return;
    const brand = str(r.brand), period = norm(r.period), sale = norm(r.sale) || '-', platform = str(r.platform);
    const qty = Number(r.qty), priority = Number(r.priority);
    if (!brand || !['bau', 'mega'].includes(period) || !Number.isInteger(qty) || qty < 0 || !platform) {
      errors.push('Invalid commitment #' + (i + 1) + ' (brand, BAU/Mega, platform, nonnegative integer sessions required).'); return;
    }
    if (!parsePlatforms(platform)) { errors.push('Unsupported platform in commitment #' + (i + 1) + ': ' + platform); return; }
    commitments.push({ id: r.id, brand, period: period as Period, sale, platform, qty, priority: Number.isFinite(priority) && priority > 0 ? priority : 3 });
  });
  const brandTotals: Record<string, number> = {};
  commitments.forEach(c => { brandTotals[norm(c.brand)] = (brandTotals[norm(c.brand)] || 0) + c.qty; });
  const brandCapCount = (host: string, brand: string) => Math.ceil((brandTotals[norm(brand)] || 0) * brandCaps[host]);
  const eligibleCache = new Map<string, Map<string, Map<string, boolean>>>();
  const eligible = (host: string, brand: string, platform: string) => {
    let byPlatform = eligibleCache.get(brand);
    if (!byPlatform) { byPlatform = new Map(); eligibleCache.set(brand, byPlatform); }
    let byHost = byPlatform.get(platform);
    if (!byHost) { byHost = new Map(); byPlatform.set(platform, byHost); }
    let v = byHost.get(host);
    if (v === undefined) {
      v = ['regular', 'preferred'].includes(preferences[key(norm(brand), host)]) && platformMatch(platforms[host], platform);
      byHost.set(host, v);
    }
    return v;
  };

  interface GridCell { day: number; slot: number; period: Period; sale: string; weekend: boolean; friday: boolean }
  const grid: GridCell[] = [];
  let bauDay = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d), weekend = [0, 6].includes(date.getDay());
    const period: Period = megaDates[d] ? 'mega' : 'bau';
    const sale = megaDates[d] || ('day ' + (++bauDay));
    for (let s = 0; s < slots.length; s++) grid.push({ day: d, slot: s, period, sale, weekend, friday: date.getDay() === 5 });
  }
  const cell = (day: number, slot: number) => (day - 1) * slots.length + slot;
  // Odd-hour fixed bookings have slot -1; look them up by the grid slot their start falls in.
  const gridAt = (day: number, slot: number) => grid[cell(day, Math.max(0, slot))];
  const matches = (c: { period: Period; sale: string }, g: GridCell) => {
    if (c.period !== g.period) return false;
    if (c.sale === 'all' || (c.period === 'bau' && c.sale === '-')) return true;
    return c.sale.split(',').map(x => x.trim()).includes(norm(g.sale));
  };

  // Fixed bookings are authoritative input, not validated against availability/eligibility/caps.
  const preplanned: Placement[] = [];
  input.preplanned.forEach(r => {
    const source = r.source;
    const { day, start, end } = r;
    const host = str(r.host), brand = str(r.brand), platform = str(r.platform), requestedRoom = str(r.room);
    if (!day || day < 1 || day > daysInMonth || start == null || end == null ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1440 || end <= start ||
      !brand || !platform) {
      errors.push(source + ': missing/invalid date, start/end time, brand or platform.'); return;
    }
    if (!parsePlatforms(platform)) warnings.push(source + ': unrecognized platform ' + platform + '; retained as confirmed.');
    if (requestedRoom && !rooms.includes(requestedRoom))
      warnings.push(source + ': unknown suggested room "' + requestedRoom + '"; another room will be tried.');
    const calPeriod: Period = megaDates[day] ? 'mega' : 'bau';
    const declaredPeriod = norm(r.period);
    const period: Period = (['bau', 'mega'].includes(declaredPeriod) ? declaredPeriod : calPeriod) as Period;
    preplanned.push({
      day, start, end, slot: startMins.indexOf(start), host, brand, platform,
      requestedRoom, period, sale: str(r.sale) || (megaDates[day] ? saleDisplay[megaDates[day]] : ' - '), source, fixed: true, room: '',
    });
  });

  const newState = (): State => ({ items: [], byHost: new Map(), byHostBrand: new Map(), byHostDay: new Map(), byCommit: new Map(), byDay: new Map(), byCommitItems: new Map(), doubleDays: new Map() });
  const pushTo = <K,>(m: Map<K, Placement[]>, k: K, p: Placement) => { const a = m.get(k); if (a) a.push(p); else m.set(k, [p]); };
  const dropFrom = <K,>(m: Map<K, Placement[]>, k: K, p: Placement) => { const a = m.get(k); if (a) { const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); } };
  const get = <K,>(map: Map<K, number>, k: K) => map.get(k) || 0;
  const hostDayKey = (h: string, d: number) => key(h, d);
  const interval = (p: { start?: number; end?: number; slot: number }) => ({
    start: p.start != null ? p.start : startMins[p.slot],
    end: p.end != null ? p.end : startMins[p.slot] + 120,
  });
  const overlap = (a: { day: number; start?: number; end?: number; slot: number }, b: { day: number; start?: number; end?: number; slot: number }) => {
    if (a.day !== b.day) return false;
    const x = interval(a), y = interval(b);
    return x.start < y.end && y.start < x.end;
  };
  const place = (st: State, p: Placement) => {
    st.items.push(p);
    if (p.host) st.byHost.set(p.host, get(st.byHost, p.host) + 1);
    if (p.host) st.byHostBrand.set(key(p.host, norm(p.brand)), get(st.byHostBrand, key(p.host, norm(p.brand))) + 1);
    const hd = hostDayKey(p.host, p.day);
    if (p.host) {
      const next = (st.byHostDay.get(hd) || []).concat([p]);
      st.byHostDay.set(hd, next);
      if (next.length === 2) st.doubleDays.set(p.host, get(st.doubleDays, p.host) + 1);
    }
    if (p.commitmentId != null) st.byCommit.set(p.commitmentId, get(st.byCommit, p.commitmentId) + 1);
    pushTo(st.byDay, p.day, p);
    if (p.commitmentId != null) pushTo(st.byCommitItems, p.commitmentId, p);
  };
  const remove = (st: State, p: Placement) => {
    const ix = st.items.indexOf(p); if (ix >= 0) st.items.splice(ix, 1);
    if (p.host) st.byHost.set(p.host, get(st.byHost, p.host) - 1);
    if (p.host) st.byHostBrand.set(key(p.host, norm(p.brand)), get(st.byHostBrand, key(p.host, norm(p.brand))) - 1);
    const hd = hostDayKey(p.host, p.day), arr = st.byHostDay.get(hd) || [];
    if (p.host) {
      const next = arr.filter(x => x !== p);
      if (arr.length >= 2 && next.length < 2) st.doubleDays.set(p.host, get(st.doubleDays, p.host) - 1);
      st.byHostDay.set(hd, next);
    }
    if (p.commitmentId != null) st.byCommit.set(p.commitmentId, get(st.byCommit, p.commitmentId) - 1);
    if (ix >= 0) {
      dropFrom(st.byDay, p.day, p);
      if (p.commitmentId != null) dropFrom(st.byCommitItems, p.commitmentId, p);
    }
  };
  const sameDay = (st: State, day: number) => st.byDay.get(day) || [];
  const validate = (st: State, p: Placement) => {
    if (!hosts.includes(p.host) || !eligible(p.host, p.brand, p.platform)) return false;
    if (!roomAllowed(p.room) || !canUseRoom(p.host, p.room)) return false;
    if (!(available[key(p.day, p.slot)] || new Set()).has(p.host)) return false;
    if (get(st.byHost, p.host) >= caps[p.host]) return false;
    if (get(st.byHostBrand, key(p.host, norm(p.brand))) >= brandCapCount(p.host, p.brand)) return false;
    if ((st.byHostDay.get(hostDayKey(p.host, p.day)) || []).length >= maxPerDay) return false;
    if (rules.fridayBau === 'never' && grid[cell(p.day, Math.max(0, p.slot))].friday && grid[cell(p.day, Math.max(0, p.slot))].period === 'bau') return false;
    if (rules.lateFemale === 'never' && p.slot === 6 && gender[p.host] === 'female') return false;
    if (sameDay(st, p.day).some(x => overlap(x, p) &&
      (x.host === p.host || (x.room && x.room === p.room) || brandConflict(x.brand, x.platform, p.brand, p.platform)))) return false;
    return true;
  };

  const lockedState = newState();
  const roomFreeFor = (st: State, p: Placement, r: string) => !st.items.some(x => x.room === r && overlap(x, p));
  const roomOptions = (st: State, p: Placement, host: string) => rooms.filter(r => roomAllowed(r) && canUseRoom(host, r) && roomFreeFor(st, p, r))
    .sort((a, b) => Number(b === p.requestedRoom) - Number(a === p.requestedRoom) ||
      Number(roomStatus[norm(a)] === 'last resort') - Number(roomStatus[norm(b)] === 'last resort'));
  const availableForInterval = (h: string, p: Placement) => {
    const covered = slots.map((_, i) => i).filter(i => startMins[i] < p.end! && p.start! < startMins[i] + 120);
    return covered.length > 0 && covered.every(i => (available[key(p.day, i)] || new Set()).has(h));
  };
  const fixedHostBookings = preplanned.filter(p => p.host);
  const blankHostBookings = preplanned.filter(p => !p.host);
  fixedHostBookings.sort((a, b) => rooms.filter(r => roomAllowed(r) && canUseRoom(a.host, r)).length -
    rooms.filter(r => roomAllowed(r) && canUseRoom(b.host, r)).length);
  fixedHostBookings.forEach(p => {
    p.room = roomOptions(lockedState, p, p.host)[0] || '';
    if (!p.room) warnings.push(p.source + ': NO ROOM AVAILABLE for fixed booking; retained with blank room. Resolve manually.');
    else if (p.requestedRoom && p.room !== p.requestedRoom)
      warnings.push(p.source + ': requested room ' + p.requestedRoom + ' changed to ' + p.room + '.');
    if (!hosts.includes(p.host)) warnings.push(p.source + ': fixed host "' + p.host + '" is not an active host; retained.');
    else if (!eligible(p.host, p.brand, p.platform)) warnings.push(p.source + ': fixed host does not match brand/platform eligibility; retained.');
    if (!hosts.includes(p.host) || !availableForInterval(p.host, p))
      warnings.push(p.source + ': fixed host is not marked available for the full booking interval; retained.');
    if (lockedState.items.some(x => x.host === p.host && overlap(x, p)))
      warnings.push(p.source + ': fixed host has overlapping preplanned bookings; both retained.');
    place(lockedState, p);
    if (hosts.includes(p.host) && get(lockedState.byHost, p.host) > caps[p.host])
      warnings.push(p.source + ': fixed bookings exceed this host’s monthly cap; retained.');
  });
  const hostChoices = (p: Placement) => {
    const choices: { host: string; room: string; score: number }[] = [];
    hosts.forEach(h => {
      if (!eligible(h, p.brand, p.platform) || !availableForInterval(h, p)) return;
      if (get(lockedState.byHost, h) >= caps[h]) return;
      const brandCap = Math.max(brandCapCount(h, p.brand),
        preplanned.filter(x => norm(x.brand) === norm(p.brand)).length);
      if (get(lockedState.byHostBrand, key(h, norm(p.brand))) >= brandCap) return;
      const daily = lockedState.byHostDay.get(hostDayKey(h, p.day)) || [];
      if (daily.length >= maxPerDay || lockedState.items.some(x => x.host === h && overlap(x, p))) return;
      const opts = roomOptions(lockedState, p, h);
      if (!opts.length) return;
      const adjacent = daily.some(x => interval(x).end === p.start || interval(x).start === p.end);
      const preferred = preferences[key(norm(p.brand), h)] === 'preferred';
      const score = (daily.length === 0 ? 300 : adjacent ? 30 : -180) + (preferred ? 80 : 0)
        - get(lockedState.byHost, h) * 18 - get(lockedState.byHostBrand, key(h, norm(p.brand))) * 35;
      choices.push({ host: h, room: opts[0], score });
    });
    return choices.sort((a, b) => b.score - a.score || a.host.localeCompare(b.host));
  };
  blankHostBookings.sort((a, b) => {
    const scarcity = (p: Placement) => hosts.filter(h => eligible(h, p.brand, p.platform) && availableForInterval(h, p) &&
      rooms.some(r => roomAllowed(r) && canUseRoom(h, r))).length;
    return scarcity(a) - scarcity(b) || a.day - b.day || a.start! - b.start!;
  });
  blankHostBookings.forEach(p => {
    const choice = hostChoices(p)[0];
    if (choice) {
      p.host = choice.host; p.room = choice.room; p.autoAssignedHost = true;
    } else {
      p.host = ''; p.room = roomOptions(lockedState, p, '')[0] || '';
      warnings.push(p.source + ': UNASSIGNED HOST: no eligible, available host with sufficient capacity and a compatible free room. Booking retained.');
      if (!p.room) warnings.push(p.source + ': NO ROOM AVAILABLE for unhosted fixed booking; retained for manual resolution.');
    }
    if (p.requestedRoom && p.room && p.requestedRoom !== p.room)
      warnings.push(p.source + ': requested room ' + p.requestedRoom + ' changed to ' + p.room + '.');
    place(lockedState, p);
  });
  const platformKey = (v: string) => [...(parsePlatforms(v) || [])].sort().join(',');
  const matched: Record<number, number> = Object.fromEntries(commitments.map(c => [c.id, 0]));
  preplanned.forEach(p => {
    if (!p.host) return;
    const g = grid[cell(p.day, 0)];
    const found = commitments.filter(c => norm(c.brand) === norm(p.brand) &&
      parsePlatforms(c.platform) && parsePlatforms(p.platform) &&
      platformKey(c.platform) === platformKey(p.platform) &&
      c.period === p.period && matches(c, g) && matched[c.id] < c.qty)
      .sort((a, b) => a.priority - b.priority)[0];
    if (found) { p.commitmentId = found.id; matched[found.id]++; }
  });
  lockedState.byCommit.clear();
  preplanned.forEach(p => {
    if (p.commitmentId != null)
      lockedState.byCommit.set(p.commitmentId, get(lockedState.byCommit, p.commitmentId) + 1);
  });
  const extraPreplanned = preplanned.filter(p => p.host && p.commitmentId == null);
  const unhostedPreplanned = preplanned.filter(p => !p.host);
  extraPreplanned.forEach(p => warnings.push(p.source + ': EXTRA CONFIRMED STREAM beyond matched commitments; retained in schedule.'));

  if (errors.length) {
    return fail('Cannot run: ' + errors.length + ' input problem(s) need fixing first. No schedule was created.');
  }

  const score = (st: State, p: Placement, c: { id: number; period: Period; qty: number }, run: number) => {
    const g = grid[cell(p.day, p.slot)], daily = st.byHostDay.get(hostDayKey(p.host, p.day)) || [];
    const existingBrand = st.byCommitItems.get(c.id) || [];
    const hostTotal = get(st.byHost, p.host), brandTotal = get(st.byHostBrand, key(p.host, norm(p.brand)));
    const dayLoads = sameDay(st, p.day).length;
    const week = Math.floor((p.day - 1) / 7), weekly = existingBrand.filter(x => Math.floor((x.day - 1) / 7) === week).length;
    const dateGap = existingBrand.length ? Math.min(...existingBrand.map(x => Math.abs(x.day - p.day))) : 7;
    const slotPoints = [10, 40, 20, 30, 60, 80, 5][p.slot];
    let v = slotPoints;
    if (preferences[key(norm(p.brand), p.host)] === 'preferred') v += 35;
    v -= hostTotal * 22 + brandTotal * 65;
    if (daily.length) {
      v -= 350;
      if (Math.abs(interval(daily[0]).start - interval(p).start) === 120) v += 90;
      else v -= 180 + 40 * Math.max(0, Math.abs(interval(daily[0]).start - interval(p).start) / 120 - 2);
      const otherDoubleDays = get(st.doubleDays, p.host);
      v -= otherDoubleDays * 90;
    }
    v -= weekly * 55;
    if (dateGap === 0) v -= 90;
    else if (dateGap === 1) v -= 50;
    else if (dateGap === 2) v -= 20;
    v -= dayLoads * 8;
    if (rules.fridayBau === 'avoid' && g.friday && g.period === 'bau') v -= 130;
    if (roomStatus[norm(p.room)] === 'last resort') v -= 95;
    const dayLimit = pctLimits[c.period][g.weekend ? 1 : 0];
    const dayCount = existingBrand.filter(x => x.slot < 5 && gridAt(x.day, x.slot).weekend === g.weekend).length;
    if (p.slot < 5 && dayCount + 1 > Math.ceil(c.qty * dayLimit)) v -= 80;
    if (rules.lateFemale === 'avoid-alone' && ['6PM-8PM', '8PM-10PM', '10PM-12MN'].includes(slots[p.slot]) && gender[p.host] === 'female' &&
      !sameDay(st, p.day).some(x => x.slot === p.slot)) v -= 90;
    // Deterministic seeded tie-breaker varies by run.
    const z = (p.day * 1013 + p.slot * 131 + p.room.length * 47 + p.host.length * 29 + c.id * 37 + run * 8191) >>> 0;
    v += ((Math.imul(z ^ (z >>> 16), 2246822519) >>> 0) % 997) / 997 * 45;
    return v;
  };
  type C = typeof commitments[number];
  const candidateList = (st: State, c: C, run: number, limit?: number) => {
    const list: { p: Placement; score: number }[] = [];
    for (const g of grid) {
      if (!matches(c, g)) continue;
      const hs = available[key(g.day, g.slot)]; if (!hs) continue;
      const todays = sameDay(st, g.day);
      const probe = { day: g.day, slot: g.slot };
      const brandNorm = norm(c.brand);
      // Items overlapping this grid cell; room-independent checks are hoisted out of the
      // room loop. Same checks as validate(), so the candidate list is unchanged.
      const overlapping = todays.filter(x => overlap(x, probe));
      const brandClash = overlapping.some(x => brandConflict(x.brand, x.platform, c.brand, c.platform));
      if (brandClash) continue;
      if (rules.fridayBau === 'never' && g.friday && g.period === 'bau') continue;
      for (const host of hs) {
        if (!eligible(host, c.brand, c.platform)) continue;
        if (!hosts.includes(host)) continue;
        if (get(st.byHost, host) >= caps[host]) continue;
        if (get(st.byHostBrand, key(host, brandNorm)) >= brandCapCount(host, c.brand)) continue;
        if ((st.byHostDay.get(hostDayKey(host, g.day)) || []).length >= maxPerDay) continue;
        if (rules.lateFemale === 'never' && g.slot === 6 && gender[host] === 'female') continue;
        if (overlapping.some(x => x.host === host)) continue;
        for (const room of rooms) {
          if (!roomAllowed(room) || !canUseRoom(host, room)) continue;
          if (overlapping.some(x => x.room && x.room === room)) continue;
          const p: Placement = { day: g.day, slot: g.slot, host, room, brand: c.brand, platform: c.platform, commitmentId: c.id, fixed: false };
          list.push({ p, score: score(st, p, c, run) });
        }
      }
    }
    list.sort((a, b) => b.score - a.score);
    return limit ? list.slice(0, limit) : list;
  };
  const copyLocked = () => { const st = newState(); lockedState.items.forEach(p => place(st, Object.assign({}, p))); return st; };
  const remaining = commitments.map(c => Object.assign({}, c, { remaining: c.qty - get(lockedState.byCommit, c.id) }));
  const difficulty = (c: C & { remaining: number }) => {
    let possibilities = 0;
    grid.forEach(g => {
      if (!matches(c, g)) return;
      const hs = available[key(g.day, g.slot)] || new Set<string>();
      hs.forEach(h => { if (eligible(h, c.brand, c.platform) && rooms.some(r => roomAllowed(r) && canUseRoom(h, r))) possibilities++; });
    });
    return possibilities / Math.max(1, c.remaining);
  };
  const diffCache = new Map<number, number>();
  remaining.forEach(c => diffCache.set(c.id, difficulty(c)));
  const diff = (c: C) => diffCache.get(c.id)!;
  const order = remaining.filter(c => c.remaining > 0).sort((a, b) => diff(a) - diff(b) || (a.period === 'mega' ? -1 : 1) - (b.period === 'mega' ? -1 : 1) || a.priority - b.priority);
  const totalCommitted = commitments.reduce((n, c) => n + c.qty, 0);
  const TRIALS = input.trials ?? 16;
  let best: State | null = null, bestQuality = -Infinity;
  for (let run = 0; run < TRIALS; run++) {
    const st = copyLocked();
    const plan = order.slice();
    if (run > 0) plan.sort((a, b) => diff(a) - diff(b) || (((a.id * 19 + run * 11) % 13) - ((b.id * 19 + run * 11) % 13)));
    plan.forEach(c => {
      while (get(st.byCommit, c.id) < c.qty) {
        const choices = candidateList(st, c, run, run % 4 === 0 ? 1 : Math.min(4, 1 + run % 4));
        if (!choices.length) break;
        place(st, choices[run % 4 === 0 ? 0 : Math.min(choices.length - 1, run % 4)].p);
      }
    });
    // One-move repair: relocate an existing generated stream to release a host/room.
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const c of order) {
        if (get(st.byCommit, c.id) >= c.qty) continue;
        const direct = candidateList(st, c, run, 1);
        if (direct.length) { place(st, direct[0].p); changed = true; continue; }
        const movable = st.items.filter(x => !x.fixed);
        for (const old of movable) {
          const oldC = commitments.find(x => x.id === old.commitmentId)!;
          remove(st, old);
          const newForOld = candidateList(st, oldC, run + 3, 12).filter(x => !(x.p.day === old.day && x.p.slot === old.slot && x.p.room === old.room));
          let repaired = false;
          for (const alt of newForOld) {
            place(st, alt.p);
            const target = candidateList(st, c, run, 1);
            if (target.length) { place(st, target[0].p); repaired = true; changed = true; break; }
            remove(st, alt.p);
          }
          if (!repaired) place(st, old);
          if (repaired) break;
        }
      }
      if (!changed) break;
    }
    const filled = st.items.filter(x => x.commitmentId != null).length;
    const quality = filled * 100000 + st.items.filter(x => !x.fixed).reduce((sum, p) => {
      const c = commitments.find(x => x.id === p.commitmentId)!;
      return sum + score(st, p, c, run);
    }, 0);
    if (quality > bestQuality) { bestQuality = quality; best = st; }
    if (filled === totalCommitted && run >= 7) break;
  }
  if (!best) best = copyLocked();
  const finalState = best;

  // Final independent checks.
  const checked = newState();
  finalState.items.forEach(p => {
    if (!p.fixed && !validate(checked, p)) errors.push('Final schedule conflict: ' + p.brand + ' / ' + dateLabel(p.day) + ' / ' + slots[p.slot] + ' / ' + p.host);
    place(checked, p);
  });
  commitments.forEach(c => { if (get(checked.byCommit, c.id) > c.qty) errors.push('Over-allocation for ' + c.brand + ' / ' + c.period); });
  if (errors.length) return fail('Internal validation failed; no schedule was created.');

  const displaySale = (s: string) => saleDisplay[s] || s;
  const streams: ScheduledStream[] = finalState.items.slice()
    .sort((a, b) => a.day - b.day || interval(a).start - interval(b).start || a.room.localeCompare(b.room))
    .map(p => {
      const g = grid[cell(p.day, p.fixed ? 0 : p.slot)];
      const iv = interval(p);
      return {
        day: p.day, start: iv.start, end: iv.end, host: p.host, brand: p.brand,
        period: (p.fixed ? p.period! : g.period).toUpperCase() as 'BAU' | 'MEGA',
        sale: p.fixed ? p.sale! : displaySale(g.sale),
        platform: p.platform, room: p.room, fixed: p.fixed, autoAssignedHost: !!p.autoAssignedHost,
        commitmentId: p.commitmentId ?? null, source: p.source ?? null,
      };
    });

  // ---------------- Summary ----------------
  const sections: SummarySection[] = [];
  const aggregate = (period: Period | null) => {
    const cs = commitments.filter(c => !period || c.period === period);
    const committed = cs.reduce((n, c) => n + c.qty, 0), fulfilled = cs.reduce((n, c) => n + get(finalState.byCommit, c.id), 0);
    return [period ? period.toUpperCase() : 'TOTAL', committed, fulfilled, committed - fulfilled, pctStr(committed ? fulfilled / committed : 1)];
  };
  sections.push({ title: 'Monthly commitment fulfilment', headers: ['Period', 'Committed', 'Fulfilled', 'Unfulfilled', 'Fulfilment %'], rows: [aggregate('bau'), aggregate('mega'), aggregate(null)] });

  const commitRows: (string | number)[][] = [];
  commitments.forEach(c => {
    const fulfilled = get(finalState.byCommit, c.id), left = c.qty - fulfilled;
    const locked = finalState.items.filter(p => p.fixed && p.commitmentId === c.id).length;
    const extra = extraPreplanned.filter(p => norm(p.brand) === norm(c.brand) && p.period === c.period &&
      parsePlatforms(p.platform) && platformKey(p.platform) === platformKey(c.platform)).length;
    const unhosted = unhostedPreplanned.filter(p => norm(p.brand) === norm(c.brand) && p.period === c.period &&
      parsePlatforms(p.platform) && platformKey(p.platform) === platformKey(c.platform)).length;
    commitRows.push([c.brand, c.period.toUpperCase(), c.sale, c.platform, c.qty, locked, fulfilled - locked, fulfilled, left, extra, unhosted, left ? 'UNFULFILLED' : 'Fully Allocated']);
  });
  sections.push({ title: 'Brand / campaign commitments', headers: ['Brand', 'Period', 'Sale Campaign', 'Platform', 'Committed', 'Pre-planned Hosted (Counted)', 'Auto-allocated', 'Fulfilled', 'Unfulfilled', 'Extra Pre-planned Hosted', 'Pre-planned Unhosted', 'Status'], rows: commitRows });

  const diagnose = (c: C) => {
    const matchingGrid = grid.filter(g => matches(c, g));
    if (!matchingGrid.length) return 'No permitted calendar dates for this campaign';
    const qualified = hosts.filter(h => eligible(h, c.brand, c.platform));
    if (!qualified.length) return 'No host eligible for required platform(s) and this brand';
    const availablePairs: { g: GridCell; h: string }[] = [];
    matchingGrid.forEach(g => (available[key(g.day, g.slot)] || new Set<string>()).forEach(h => {
      if (qualified.includes(h)) availablePairs.push({ g, h });
    }));
    if (!availablePairs.length) return 'No eligible host marked available on permitted dates/times';
    const counts: Record<string, number> = { monthly: 0, brand: 0, daily: 0, hostOverlap: 0, room: 0, brandOverlap: 0, feasible: 0 };
    for (const { g, h } of availablePairs) {
      if (get(finalState.byHost, h) >= caps[h]) { counts.monthly++; continue; }
      if (get(finalState.byHostBrand, key(h, norm(c.brand))) >= brandCapCount(h, c.brand)) { counts.brand++; continue; }
      if ((finalState.byHostDay.get(hostDayKey(h, g.day)) || []).length >= maxPerDay) { counts.daily++; continue; }
      const p = { day: g.day, slot: g.slot };
      if (finalState.items.some(x => x.host === h && overlap(x, p))) { counts.hostOverlap++; continue; }
      if (finalState.items.some(x => brandConflict(x.brand, x.platform, c.brand, c.platform) && overlap(x, p))) { counts.brandOverlap++; continue; }
      const freeRooms = rooms.filter(r => roomAllowed(r) && canUseRoom(h, r) && !finalState.items.some(x => x.room === r && overlap(x, p)));
      if (!freeRooms.length) { counts.room++; continue; }
      counts.feasible++;
    }
    if (counts.feasible) return 'ALLOCATION OPPORTUNITY: ' + counts.feasible + ' feasible host/time combinations remain; optimizer did not fill';
    const names: Record<string, string> = { monthly: 'monthly host caps', brand: 'host brand-share caps', daily: 'daily stream caps', hostOverlap: 'host time conflicts', room: 'room capacity/permissions', brandOverlap: 'brand time conflicts' };
    const ranked = Object.keys(names).filter(k => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
    return 'Blocked in current schedule: ' + ranked.slice(0, 3).map(k => names[k] + ' (' + counts[k] + ')').join('; ') + '. Reassignment may help';
  };
  let deficits = 0;
  const deficitRows: (string | number)[][] = [];
  commitments.forEach(c => {
    const fulfilled = get(finalState.byCommit, c.id), left = c.qty - fulfilled;
    if (left > 0) { deficitRows.push([c.brand, c.period.toUpperCase(), c.sale, c.platform, c.qty, fulfilled, left, diagnose(c)]); deficits += left; }
  });
  sections.push({ title: 'Unfulfilled commitments: action required', headers: ['Brand', 'Period', 'Sale Campaign', 'Platform', 'Committed', 'Fulfilled', 'Remaining', 'Diagnostic reason'], rows: deficitRows.length ? deficitRows : [['None: all commitments fulfilled']] });

  const preRows: (string | number)[][] = preplanned.slice().sort((a, b) => a.day - b.day || a.start! - b.start!).map(p => [
    p.source!, p.brand, dateLabel(p.day), formatTime(p.start!) + '–' + formatTime(p.end!), p.platform, p.host || '', p.room || '',
    !p.host ? 'UNASSIGNED: ACTION REQUIRED' : p.autoAssignedHost ? 'AUTO-ASSIGNED' : 'CONFIRMED HOST',
    !p.host ? 'Not fulfilled' : p.commitmentId == null ? 'Extra agreed stream' : 'Counts toward commitment',
  ]);
  sections.push({ title: 'Pre-planned host assignments', headers: ['Source', 'Brand', 'Date', 'Time', 'Platform', 'Host', 'Room', 'Status', 'Commitment treatment'], rows: preRows.length ? preRows : [['None']] });

  const hostRows: (string | number)[][] = hosts.map(h => {
    const allocations = finalState.items.filter(p => p.host === h);
    const byBrand: Record<string, number> = {}; allocations.forEach(p => { byBrand[p.brand] = (byBrand[p.brand] || 0) + 1; });
    const daily: Record<number, Placement[]> = {}; allocations.forEach(p => { (daily[p.day] || (daily[p.day] = [])).push(p); });
    const doubles = Object.values(daily).filter(x => x.length >= 2).length;
    const gaps = Object.values(daily).filter(x => {
      const ordered = x.slice().sort((a, b) => interval(a).start - interval(b).start);
      return ordered.some((p, i) => i > 0 && interval(p).start > interval(ordered[i - 1]).end);
    }).length;
    return [h, Object.entries(byBrand).map(([b, n]) => b + ' (' + n + ')').join(', ') || 'None', allocations.length, caps[h], pctStr(caps[h] ? allocations.length / caps[h] : 0), doubles, gaps];
  });
  sections.push({ title: 'Host capacity report', headers: ['Host', 'Brand breakdown', 'Allocated streams', 'Max monthly cap', 'Cap utilization', 'Double-stream days', 'Days with idle gaps'], rows: hostRows });

  const roomRows: (string | number)[][] = [];
  (['BAU', 'MEGA'] as const).forEach(period => slots.forEach((slot, s) => {
    const cells = grid.filter(g => g.period === norm(period) && g.slot === s);
    const used = rooms.map(r => cells.filter(g => finalState.items.some(p => p.room === r && overlap(p, { day: g.day, slot: s }))).length);
    const availableRooms = rooms.map(r => roomAllowed(r) ? cells.length : 0);
    const u = used.reduce((a, b) => a + b, 0), a = availableRooms.reduce((a, b) => a + b, 0);
    roomRows.push([period + ' | ' + slot, ...used.map((n, i) => n + ' / ' + availableRooms[i]), u, a, pctStr(a ? u / a : 0)]);
  }));
  sections.push({ title: 'Room capacity & utilization', headers: ['Period | Slot', ...rooms, 'Total allocated', 'Total capacity', 'Utilization %'], rows: roomRows });

  const weekRows: (string | number)[][] = [];
  [...new Set(commitments.map(c => key(c.brand, c.period)))].forEach(k => {
    const [brand, period] = k.split('||');
    const counts = [0, 0, 0, 0, 0];
    finalState.items.filter(p => norm(p.brand) === norm(brand) && (p.fixed ? p.period : grid[cell(p.day, p.slot)].period) === period)
      .forEach(p => counts[Math.floor((p.day - 1) / 7)]++);
    weekRows.push([brand, period.toUpperCase(), ...counts]);
  });
  sections.push({ title: 'Brand distribution by week', headers: ['Brand', 'Period', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'], rows: weekRows });

  const noteRows: (string | number)[][] = warnings.length ? warnings.map(w => ['WARNING', w]) : [['OK', 'No pre-planned availability warnings.']];
  noteRows.push(
    ['INFO', 'Pre-planned streams are locked regardless of host availability, eligibility, or caps. They block overlapping hosts and rooms.'],
    ['INFO', 'All pre-planned streams remain in the schedule, including those beyond commitments. Extra hosted streams are reported separately.'],
    ['INFO', 'Unhosted pre-planned streams reserve a room but count as fulfilled only after a host is assigned.'],
    ['INFO', 'Daytime percentages are soft preferences; brand eligibility, platform eligibility and host caps are hard restrictions.'],
    ['INFO', 'TikTok & Shopee means ONE simultaneous stream and requires a host eligible for BOTH platforms.'],
    ['INFO', 'Deficit diagnostics describe the current schedule, not mathematical proof that a deficit is unavoidable.'],
    ['INFO', 'Optimization uses ' + TRIALS + ' maximum deterministic attempts plus one-move repair; it cannot prove every remaining deficit is impossible.'],
  );
  sections.push({ title: 'Validation notes', headers: ['Type', 'Details'], rows: noteRows });

  const stats = {
    committed: totalCommitted, fulfilled: totalCommitted - deficits, unfulfilled: deficits,
    extraPreplanned: extraPreplanned.length, unhostedPreplanned: unhostedPreplanned.length,
  };
  return {
    ok: true, errors, warnings, streams, sections, stats,
    message: stats.fulfilled + ' / ' + totalCommitted + ' committed streams fulfilled; ' + deficits + ' unfulfilled; ' +
      stats.extraPreplanned + ' extra hosted pre-planned; ' + stats.unhostedPreplanned + ' pre-planned without host.',
  };
}

function pctStr(v: number) {
  return (v * 100).toFixed(1) + '%';
}
