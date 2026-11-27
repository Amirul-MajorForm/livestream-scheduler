/**
 * Availability is stored per hour: 10 = 10-11AM ... 23 = 11PM-12MN.
 * Streams are still 2-hour blocks starting at 10AM, 12PM, 2PM ... 10PM; a host is available for a
 * block only when both of its hours are ticked.
 */
export const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

/** 10 -> "10AM", 12 -> "12PM", 24 -> "12MN" */
export function hourLabel(h: number) {
  if (h === 24 || h === 0) return '12MN';
  if (h === 12) return '12PM';
  return h > 12 ? h - 12 + 'PM' : h + 'AM';
}

/** Short label for a column heading: 10 -> "10", 13 -> "1" */
export function hourShort(h: number) {
  return String(h > 12 ? h - 12 : h);
}

/** 14 -> "2PM-3PM" */
export function hourRange(h: number) {
  return hourLabel(h) + '–' + hourLabel(h + 1);
}

/** Merges hours into readable ranges: [12,13,14,20,21] -> "12PM–3PM, 8PM–10PM" */
export function mergeHours(hours: number[]) {
  const hs = [...new Set(hours)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < hs.length; i++) {
    let j = i;
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
    out.push(hourLabel(hs[i]) + '–' + hourLabel(hs[j] + 1));
    i = j;
  }
  return out.join(', ');
}

/** The two hours that make up 2-hour slot s (0 = 10AM-12PM). */
export const slotHours = (s: number) => [10 + 2 * s, 11 + 2 * s];

/** Hours a stream covers, e.g. 21:00-23:00 -> [21, 22]. */
export function hoursCovered(startMin: number, endMin: number) {
  return HOURS.filter(h => h * 60 < endMin && startMin < (h + 1) * 60);
}
