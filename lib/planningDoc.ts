import type { PlanningRules } from './scheduler';

/**
 * Default text of "How the scheduler plans a month", written from the current rules.
 * Ops can replace it with their own text (stored in settings 'planning_doc'); Reset brings this back.
 *
 * Format (kept deliberately small): "## Heading", "- bullet", blank line between paragraphs,
 * **bold** and *italic*.
 */
export function generatePlanningDoc(rules: PlanningRules, rooms: { name: string; status: string }[]): string {
  const usable = rooms.filter(r => r.status !== 'unavailable');
  const perDay = rules.maxStreamsPerHostPerDay;
  const L: string[] = [];
  L.push('## 1. Fixed bookings go in first');
  L.push('- Confirmed streams from the published version, then the month’s pre-planned streams, are locked in exactly as entered, even if they break a rule below (the schedule flags it).');
  L.push('- Pre-planned streams without a host get the best eligible, available host who still has room under their caps. If nobody qualifies they stay “No host” and still hold a room.');
  L.push('- Each locked stream counts toward a matching commitment (same brand, BAU/Mega, platform and sale); extras are kept but don’t count.');
  L.push('');
  L.push('## 2. Hard rules (never broken by the scheduler)');
  L.push('- **Brand:** the host has the brand as Preferred or Regular. Excluded or blank means never.');
  L.push('- **Platform:** the host is set up for the stream’s platform; “TikTok & Shopee” is one stream on both, so the host needs both.');
  L.push('- **Availability:** the host ticked both hours of the 2-hour block.');
  L.push(`- **Caps:** the host’s monthly maximum, their maximum share of any one brand’s sessions (max % per brand), and at most **${perDay}** stream${perDay === 1 ? '' : 's'} a day.`);
  L.push('- **No double-booking:** a host and a room each do one stream at a time.');
  L.push('- **Brand clashes:** ' + (rules.sameBrandDifferentPlatformOk
    ? 'the same brand can’t stream twice at the same time on the same platform (different platforms are fine)'
    : 'the same brand can’t stream twice at the same time, on any platform')
    + (rules.brandsApart.length ? '; and ' + rules.brandsApart.map(([a, b]) => `${a} with ${b}`).join(', ') + ' never overlap' : '') + '.');
  L.push(`- **Rooms:** one stream per room at a time. Rooms in use: ${usable.map(r => r.name + (r.status === 'last resort' ? ' (last resort)' : '')).join(', ') || 'none'}, so up to ${usable.length} streams at once. Hosts limited to certain rooms (set on their page) only use those.`);
  if (rules.fridayBau === 'never') L.push('- **Fridays:** no BAU streams.');
  if (rules.lateFemale === 'never') L.push('- **Late slots:** no female hosts 10PM–12MN.');
  L.push('- **Days:** BAU commitments only on BAU days; Mega commitments only on the sale days they list (from the month’s sale days).');
  L.push('');
  L.push('## 3. Order of work');
  L.push('- Commitments with the fewest possible host/time options go first; Mega before BAU on ties, then by priority (1 = highest).');
  L.push('- Up to 16 passes with different tie-breaks, plus a repair step that moves one stream to make room for a stuck commitment. The pass that fills the most commitments wins; among equals, the one that best follows the preferences below.');
  L.push('');
  L.push('## 4. Preferences (soft: followed when possible)');
  L.push('- Preferred hosts over Regular ones; spread work across hosts and spread each host across brands.');
  L.push('- One stream per host per day; if two, back-to-back rather than with a gap; avoid giving the same host many double days.');
  L.push('- Spread each commitment across the month: avoid the same week and neighbouring days.');
  L.push('- Time of day: 8PM–10PM is favoured most, then 6PM–8PM, 12PM–2PM, 4PM–6PM, 2PM–4PM, 10AM–12PM; 10PM–12MN least.');
  L.push('- Daytime limits per month (Rules & sale days tab): once a commitment has used its weekday/weekend daytime share (before 8PM), later sessions lean to evenings.');
  L.push('- “Last resort” rooms only when others are taken; quieter days preferred over busy ones.');
  if (rules.fridayBau === 'avoid') L.push('- Avoid BAU streams on Fridays.');
  if (rules.lateFemale === 'avoid-alone') L.push('- Avoid a female host being the only stream in a slot from 6PM.');
  L.push('');
  L.push('## Not built in yet (from your notes)');
  L.push('- Hosts who shouldn’t do double-digit sale days two months running.');
  L.push('- Host-pair rules such as “if Zul and Ler stream together, nothing else at the same time”.');
  L.push('- Per-host brand limits like “Clarice: no Oatside twice in one week”.');
  L.push('- Off-site streams that block the host but not a studio room.');
  L.push('');
  L.push('*Add requests like these to the planner notes below so they can be built into the scheduler.*');
  return L.join('\n');
}

export type DocBlock =
  | { kind: 'h'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] };

/** Split the doc text into headings, paragraphs and bullet lists. */
export function parseDoc(src: string): DocBlock[] {
  const out: DocBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ') }); para = []; } };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    const b = line.match(/^[-*•]\s+(.*)$/);
    if (h) { flush(); out.push({ kind: 'h', text: h[1] }); }
    else if (b) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === 'ul') last.items.push(b[1]); else out.push({ kind: 'ul', items: [b[1]] });
    } else {
      // A plain line straight after a bullet continues that bullet.
      const last = out[out.length - 1];
      if (!para.length && last?.kind === 'ul' && /^\s/.test(raw)) last.items[last.items.length - 1] += ' ' + line;
      else para.push(line);
    }
  }
  flush();
  return out;
}

/** **bold** and *italic* spans, as plain segments (rendered as React text, so nothing is injected). */
export function inlineSpans(text: string): { t: string; b?: boolean; i?: boolean }[] {
  const out: { t: string; b?: boolean; i?: boolean }[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ t: text.slice(at, m.index) });
    out.push(m[1] != null ? { t: m[1], b: true } : { t: m[2], i: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}
