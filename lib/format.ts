import { DAYS_SHORT, MONTH_NAMES, SLOTS, formatTime } from './scheduler';

export { SLOTS, formatTime, MONTH_NAMES };

/** 'YYYY-MM-DD' -> 'Tue 1 Dec' */
export function fmtDate(iso: string, withYear = false) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAYS_SHORT[dow] + ' ' + d + ' ' + MONTH_NAMES[m - 1].slice(0, 3) + (withYear ? ' ' + y : '');
}

/** Server-side timestamp formatting in the team's timezone (APP_TIMEZONE, default Asia/Singapore). */
export function fmtDateTime(d: Date | string) {
  return new Date(d).toLocaleString('en-SG', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Singapore',
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function dayOfWeek(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function fmtRange(start: number, end: number) {
  return formatTime(start) + '–' + formatTime(end);
}

export function pct(v: number | null | undefined) {
  return v == null ? '' : Math.round(v * 1000) / 10 + '%';
}

/** Parses "40", "40%" or "0.4" into a fraction. */
export function parsePctInput(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (s.includes('%') || n > 1) n /= 100;
  return n >= 0 && n <= 1 ? n : null;
}

/** Parses "20:00", "8pm", "20" into minutes. */
export function parseTimeInput(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().toUpperCase();
  let m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (m) {
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (m[3] === 'PM' ? 12 : 0);
    return h * 60 + Number(m[2]);
  }
  m = s.match(/^(\d{1,2})\s*(AM|PM)?$/);
  if (m) return ((Number(m[1]) % (m[2] ? 12 : 24)) + (m[2] === 'PM' ? 12 : 0)) * 60;
  return null;
}
