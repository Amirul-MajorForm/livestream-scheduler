import { START_MINS, SLOTS, parsePlatforms } from './scheduler';
import { fmtDate, fmtRange } from './format';

export interface IssueStream {
  id: number;
  date: string;
  start_min: number;
  end_min: number;
  host_id: number | null;
  host_name: string;
  brand: string;
  platform: string;
  room: string;
}

export interface IssueHost {
  id: number;
  name: string;
  active: boolean;
  max_streams_month: number | null;
  platforms: string;
  /** lowercase brand name -> level */
  prefs: Record<string, string>;
}

export interface Issue {
  tag: string;
  detail: string;
  severity: 'bad' | 'warn';
}

const covered = (s: { start_min: number; end_min: number }) =>
  START_MINS.map((m, i) => ({ i, m })).filter(x => x.m < s.end_min && s.start_min < x.m + 120).map(x => x.i);
const overlaps = (a: IssueStream, b: IssueStream) => a.date === b.date && a.start_min < b.end_min && b.start_min < a.end_min;
const desc = (o: IssueStream) => `${o.brand} (${o.platform}) ${fmtRange(o.start_min, o.end_min)}`;

/** Works out every warning for every stream in a schedule version, with a human explanation. */
export function findIssues(streams: IssueStream[], availability: { host_id: number; date: string; slot: number }[], hosts: IssueHost[]) {
  const avail = new Set(availability.map(a => a.host_id + '|' + a.date + '|' + a.slot));
  const slotsTicked = (hid: number, date: string) => SLOTS.filter((_, i) => avail.has(hid + '|' + date + '|' + i));
  const countByHost = new Map<number, number>();
  streams.forEach(s => { if (s.host_id) countByHost.set(s.host_id, (countByHost.get(s.host_id) || 0) + 1); });
  const out = new Map<number, Issue[]>();

  for (const s of streams) {
    const list: Issue[] = [];
    const others = streams.filter(o => o.id !== s.id && overlaps(o, s));

    const sameHost = s.host_id ? others.filter(o => o.host_id === s.host_id) : [];
    if (sameHost.length) list.push({ tag: 'Host double-booked', severity: 'warn',
      detail: `${s.host_name} also has ${sameHost.map(o => desc(o) + (o.room ? ' in ' + o.room : '')).join('; ')}. One of them needs another host.` });

    const sameRoom = s.room ? others.filter(o => o.room === s.room) : [];
    if (sameRoom.length) list.push({ tag: 'Room clash', severity: 'warn',
      detail: `${s.room} is also used by ${sameRoom.map(o => desc(o) + ' with ' + (o.host_name || 'no host')).join('; ')}. Move one to another room.` });

    const sameBrand = others.filter(o => o.brand.toLowerCase() === s.brand.toLowerCase());
    if (sameBrand.length) list.push({ tag: 'Same brand at the same time', severity: 'warn',
      detail: `${s.brand} also streams ${sameBrand.map(o => o.platform + ' ' + fmtRange(o.start_min, o.end_min) + ' with ' + (o.host_name || 'no host')).join('; ')}.` });

    if (s.host_id) {
      const need = covered(s);
      const missing = need.filter(i => !avail.has(s.host_id + '|' + s.date + '|' + i));
      if (missing.length) {
        const ticked = slotsTicked(s.host_id, s.date);
        list.push({ tag: 'Host not marked available', severity: 'warn',
          detail: `${s.host_name} did not tick ${missing.map(i => SLOTS[i]).join(', ')} on ${fmtDate(s.date)}. ` +
            (ticked.length ? `They ticked: ${ticked.join(', ')}.` : 'They ticked nothing that day.') + ' Check with the host.' });
      }
    }

    if (!s.host_name) list.push({ tag: 'No host', severity: 'bad', detail: explainNoHost(s, streams, hosts, avail, countByHost) });
    if (!s.room) list.push({ tag: 'No room', severity: 'bad',
      detail: 'Every room this host may use was already taken at this time. Pick a room with Edit, or move another stream.' });

    if (list.length) out.set(s.id, list);
  }
  return out;
}

function explainNoHost(s: IssueStream, streams: IssueStream[], hosts: IssueHost[], avail: Set<string>, countByHost: Map<number, number>) {
  const need = parsePlatforms(s.platform);
  const eligible = hosts.filter(h => h.active && ['preferred', 'regular'].includes(h.prefs[s.brand.toLowerCase()]) &&
    !!need && [...need].every(p => parsePlatforms(h.platforms)?.has(p)));
  if (!eligible.length) return `No active host is set up for ${s.brand} on ${s.platform}. Set a host to Preferred or Regular for ${s.brand} (and both platforms if needed) on the Hosts page.`;
  const slots = covered(s);
  const ticked = eligible.filter(h => slots.every(i => avail.has(h.id + '|' + s.date + '|' + i)));
  const names = (l: IssueHost[]) => l.map(h => h.name).join(', ');
  let text = `${eligible.length} host${eligible.length === 1 ? '' : 's'} can do ${s.brand} on ${s.platform}. `;
  if (!ticked.length) return text + `None of them ticked ${slots.map(i => SLOTS[i]).join(' + ')} on ${fmtDate(s.date)}. Ask one of them (${names(eligible.slice(0, 6))}${eligible.length > 6 ? '…' : ''}) or pick a host with Edit.`;
  const busy = ticked.filter(h => streams.some(o => o.host_id === h.id && overlaps(o, s)));
  const capped = ticked.filter(h => !busy.includes(h) && h.max_streams_month != null && (countByHost.get(h.id) || 0) >= h.max_streams_month);
  const free = ticked.filter(h => !busy.includes(h) && !capped.includes(h));
  text += `Available at this time: ${names(ticked)}.`;
  if (busy.length) text += ` Already streaming then: ${names(busy)}.`;
  if (capped.length) text += ` At their monthly cap: ${names(capped)}.`;
  text += free.length ? ` Free now: ${names(free)} (they may be at a brand or daily limit). Assign with Edit.` : ' Nobody is free: raise a cap or move a stream.';
  return text;
}
