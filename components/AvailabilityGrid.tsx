'use client';

import { useMemo, useState } from 'react';
import { HOURS, hourLabel, hourShort, hourRange, mergeHours } from '@/lib/hours';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Streams run in 2-hour blocks starting at these hours; the grid groups hours into them.
const BLOCK_STARTS = [10, 12, 14, 16, 18, 20, 22];

interface Props {
  hostId: number;
  monthId: number;
  year: number;
  month: number; // 0-based
  initial: string[]; // "YYYY-MM-DD|hour"
  saleDays: Record<number, string>;
  editable: boolean;
  submittedAt: string | null;
  /** Ops only: show the "paste a message" box for this host's name. */
  pasteFor?: string;
  /** Open with the cursor in the paste box. */
  focusPaste?: boolean;
}

interface Parsed {
  mode: 'replace' | 'add' | 'remove';
  replace_dates: string[];
  hours: { date: string; hours: number[] }[];
  summary: string;
  unclear: string[];
}

export default function AvailabilityGrid({ hostId, monthId, year, month, initial, saleDays, editable, submittedAt, pasteFor, focusPaste }: Props) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const [saved, setSaved] = useState(() => new Set(initial));
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSubmitted, setLastSubmitted] = useState(submittedAt);
  // Paste-a-message preview: the grid before applying it (for highlight + undo) and what was understood.
  const [pasteText, setPasteText] = useState('');
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [before, setBefore] = useState<Set<string> | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const days = useMemo(() => {
    const n = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => {
      const d = i + 1;
      const iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dow = new Date(Date.UTC(year, month, d)).getUTCDay();
      return { d, iso, dow, weekend: dow === 0 || dow === 6, sale: saleDays[d] };
    });
  }, [year, month, saleDays]);

  const dirty = selected.size !== saved.size || [...selected].some(x => !saved.has(x));
  const k = (iso: string, h: number) => iso + '|' + h;

  function update(fn: (next: Set<string>) => void) {
    if (!editable) return;
    setSelected(prev => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
    setStatus(null);
  }
  const setHour = (n: Set<string>, key: string, on: boolean) => {
    if (on) n.add(key);
    else n.delete(key);
  };
  const toggle = (iso: string, h: number) => update(n => setHour(n, k(iso, h), !n.has(k(iso, h))));
  const toggleRow = (iso: string) => update(n => {
    const all = HOURS.every(h => n.has(k(iso, h)));
    HOURS.forEach(h => setHour(n, k(iso, h), !all));
  });
  /** Ticks/unticks a set of hours (one hour, or a 2-hour block) on every day. */
  const toggleCols = (hours: number[]) => update(n => {
    const all = days.every(d => hours.every(h => n.has(k(d.iso, h))));
    days.forEach(d => hours.forEach(h => setHour(n, k(d.iso, h), !all)));
  });
  /** Copies the hour pattern of the first <weekday> of the month to every <weekday>. */
  const copyWeekday = (dow: number) => update(n => {
    const first = days.find(d => d.dow === dow)!;
    const pattern = HOURS.map(h => n.has(k(first.iso, h)));
    days.filter(d => d.dow === dow).forEach(d => HOURS.forEach((h, i) => setHour(n, k(d.iso, h), pattern[i])));
  });

  async function readMessage() {
    setReading(true);
    setPasteError(null);
    try {
      const res = await fetch('/api/availability/parse', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostId, monthId, text: pasteText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not read the message');
      const r = body as Parsed;
      const base = before ?? selected; // re-reading replaces the previous preview
      const next = new Set(base);
      const keys = r.hours.flatMap(x => x.hours.map(h => k(x.date, h)));
      if (r.mode === 'replace') {
        const clear = new Set(r.replace_dates.length ? [...r.replace_dates, ...r.hours.map(x => x.date)] : days.map(d => d.iso));
        [...next].forEach(key => { if (clear.has(key.split('|')[0])) next.delete(key); });
        keys.forEach(key => next.add(key));
      } else if (r.mode === 'add') keys.forEach(key => next.add(key));
      else keys.forEach(key => next.delete(key));
      setBefore(new Set(base));
      setSelected(next);
      setParsed(r);
      setStatus(null);
    } catch (e) {
      setPasteError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  function undoPaste() {
    if (before) setSelected(new Set(before));
    setBefore(null);
    setParsed(null);
  }
  const added = before ? [...selected].filter(x => !before.has(x)).length : 0;
  const removed = before ? [...before].filter(x => !selected.has(x)).length : 0;

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hostId,
          monthId,
          hours: [...selected].map(x => {
            const [date, hour] = x.split('|');
            return { date, hour: Number(hour) };
          }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setSaved(new Set(selected));
      setLastSubmitted(body.submittedAt);
      setBefore(null);
      setParsed(null);
      setPasteText('');
      setStatus({ kind: 'ok', text: `Saved: ${selected.size} hours available` });
    } catch (e) {
      setStatus({ kind: 'bad', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // Hours ticked without their block partner can't be used for a 2-hour stream; flag them softly.
  const lonely = (iso: string, h: number) => {
    const partner = h % 2 === 0 ? h + 1 : h - 1;
    return selected.has(k(iso, h)) && !selected.has(k(iso, partner));
  };

  return (
    <div className="card">
      {pasteFor && editable && (
        <div className="paste-box" data-tour="paste-box">
          <label className="field" style={{ color: 'var(--ink)' }}>
            <strong>Paste {pasteFor}&rsquo;s message</strong>
            <span className="small muted">
              e.g. a WhatsApp reply like &ldquo;free every weekday after 6pm, weekends anytime, except 12 and 24 Dec&rdquo;.
              The hours are filled in below as a preview; check them, then press Save availability.
            </span>
            <textarea rows={4} value={pasteText} autoFocus={focusPaste} onChange={e => setPasteText(e.target.value)}
              placeholder={`Paste ${pasteFor}'s availability message here`} />
          </label>
          <div className="inline" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="primary" onClick={readMessage} disabled={reading || !pasteText.trim()}>
              {reading ? 'Reading message…' : before ? 'Read again' : 'Fill in from message'}
            </button>
            {before && <button type="button" onClick={undoPaste}>Undo</button>}
            {pasteError && <span className="badge bad">{pasteError}</span>}
          </div>
          {parsed && (
            <div className="notice info" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>Understood:</strong> {parsed.summary}{' '}
              <span className="small">({added} hour{added === 1 ? '' : 's'} added, {removed} removed, shown with a blue outline. Not saved yet.)</span>
              {parsed.unclear.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <strong>Please check:</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{parsed.unclear.map((u, i) => <li key={i}>{u}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {editable && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Tap each hour you can stream. Streams are 2 hours long (10&ndash;12, 12&ndash;2, &hellip;), so tick <strong>both hours of a block</strong> to be booked in it;
          a single hour on its own shows faded. Tap a date for the whole day, or a time at the top for that time every day.
        </p>
      )}
      <div className="avail-scroll" data-tour="avail-grid">
        <table className="avail hourly">
          <thead>
            <tr className="blocks">
              <th className="date" rowSpan={2}>Date</th>
              {BLOCK_STARTS.map(b => (
                <th key={b} colSpan={2} className="block">
                  {editable
                    ? <button type="button" className="link" onClick={() => toggleCols([b, b + 1])} title={`Tick or untick ${hourLabel(b)}–${hourLabel(b + 2)} on every day`}>{hourLabel(b)}<span className="to">&ndash;{hourLabel(b + 2)}</span></button>
                    : <>{hourLabel(b)}<span className="to">&ndash;{hourLabel(b + 2)}</span></>}
                </th>
              ))}
              {editable && <th rowSpan={2} className="copy-col" />}
            </tr>
            <tr className="hours">
              {HOURS.map(h => (
                <th key={h} className={h % 2 === 0 ? 'bs' : ''} title={hourRange(h)}>
                  {editable
                    ? <button type="button" className="link" onClick={() => toggleCols([h])} title={`Tick or untick ${hourRange(h)} on every day`}>{hourShort(h)}</button>
                    : hourShort(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map(d => {
              const dayHours = HOURS.filter(h => selected.has(k(d.iso, h)));
              return (
                <tr key={d.iso} className={(d.weekend ? 'weekend ' : '') + (d.sale ? 'mega' : '')}
                  title={dayHours.length ? `${DOW[d.dow]} ${d.d}: ${mergeHours(dayHours)}` : undefined}>
                  <td className="date" title={d.sale ? d.sale : undefined}>
                    {editable
                      ? <button type="button" className="link" style={{ color: 'inherit' }} onClick={() => toggleRow(d.iso)}>{DOW[d.dow]} {d.d}</button>
                      : <span>{DOW[d.dow]} {d.d}</span>}
                    {d.sale && <span className="sale" title={d.sale}>{d.sale}</span>}
                  </td>
                  {HOURS.map(h => {
                    const on = selected.has(k(d.iso, h));
                    const changed = before ? before.has(k(d.iso, h)) !== on : false;
                    return (
                      <td key={h} className={h % 2 === 0 ? 'bs' : ''}>
                        <button type="button"
                          className={'slotbtn' + (on ? ' on' : '') + (on && lonely(d.iso, h) ? ' lonely' : '') + (changed ? (on ? ' added' : ' removed') : '')}
                          disabled={!editable} aria-pressed={on} aria-label={`${DOW[d.dow]} ${d.d} ${hourRange(h)}`}
                          onClick={() => toggle(d.iso, h)} />
                      </td>
                    );
                  })}
                  {editable && (
                    <td className="copy-col">
                      {d.d <= 7 && (
                        <button type="button" className="link small" onClick={() => copyWeekday(d.dow)} title={`Copy this day's hours to every ${DOW[d.dow]} in the month`}>
                          Copy to all {DOW[d.dow]}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sticky-bar">
        <span className="muted small">
          {selected.size} hours selected
          {/* Server and browser may be in different timezones; the browser's value wins. */}
          {lastSubmitted && <> &middot; last saved <span suppressHydrationWarning>{new Date(lastSubmitted).toLocaleString()}</span></>}
          {!editable && <> &middot; availability is locked for this month</>}
        </span>
        <span className="inline">
          {status && <span className={'badge ' + (status.kind === 'ok' ? 'ok' : 'bad')}>{status.text}</span>}
          {editable && dirty && <span className="badge warn">Unsaved changes</span>}
          {editable && (
            <button data-tour="avail-save" className="primary" type="button" disabled={saving || (!dirty && !!lastSubmitted)} onClick={save}>
              {saving ? 'Saving…' : 'Save availability'}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
