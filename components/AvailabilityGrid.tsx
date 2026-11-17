'use client';

import { useMemo, useState } from 'react';

const SLOTS = ['10AM-12PM', '12PM-2PM', '2PM-4PM', '4PM-6PM', '6PM-8PM', '8PM-10PM', '10PM-12MN'];
// Header labels: start on the first line, end on the second, so all 7 columns still fit on a phone.
const SLOT_LABEL = [['10AM', '12PM'], ['12PM', '2PM'], ['2PM', '4PM'], ['4PM', '6PM'], ['6PM', '8PM'], ['8PM', '10PM'], ['10PM', '12MN']];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  hostId: number;
  monthId: number;
  year: number;
  month: number; // 0-based
  initial: string[]; // "YYYY-MM-DD|slot"
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
  slots: { date: string; slots: number[] }[];
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
  const k = (iso: string, s: number) => iso + '|' + s;

  function update(fn: (next: Set<string>) => void) {
    if (!editable) return;
    setSelected(prev => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
    setStatus(null);
  }
  const setSlot = (n: Set<string>, key: string, on: boolean) => {
    if (on) n.add(key);
    else n.delete(key);
  };
  const toggle = (iso: string, s: number) => update(n => setSlot(n, k(iso, s), !n.has(k(iso, s))));
  const toggleRow = (iso: string) => update(n => {
    const all = SLOTS.every((_, s) => n.has(k(iso, s)));
    SLOTS.forEach((_, s) => setSlot(n, k(iso, s), !all));
  });
  const toggleCol = (s: number) => update(n => {
    const all = days.every(d => n.has(k(d.iso, s)));
    days.forEach(d => setSlot(n, k(d.iso, s), !all));
  });
  /** Copies the slot pattern of the first <weekday> of the month to every <weekday>. */
  const copyWeekday = (dow: number) => update(n => {
    const first = days.find(d => d.dow === dow)!;
    const pattern = SLOTS.map((_, s) => n.has(k(first.iso, s)));
    days.filter(d => d.dow === dow).forEach(d => SLOTS.forEach((_, s) => setSlot(n, k(d.iso, s), pattern[s])));
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
      const keys = r.slots.flatMap(x => x.slots.map(sl => k(x.date, sl)));
      if (r.mode === 'replace') {
        const clear = new Set(r.replace_dates.length ? [...r.replace_dates, ...r.slots.map(x => x.date)] : days.map(d => d.iso));
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
          slots: [...selected].map(x => {
            const [date, slot] = x.split('|');
            return { date, slot: Number(slot) };
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
      setStatus({ kind: 'ok', text: 'Saved: ' + selected.size + ' slots available' });
    } catch (e) {
      setStatus({ kind: 'bad', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      {pasteFor && editable && (
        <div className="paste-box" data-tour="paste-box">
          <label className="field" style={{ color: 'var(--ink)' }}>
            <strong>Paste {pasteFor}&rsquo;s message</strong>
            <span className="small muted">
              e.g. a WhatsApp reply like &ldquo;free every weekday after 6pm, weekends anytime, except 12 and 24 Dec&rdquo;.
              The slots are filled in below as a preview; check them, then press Save availability.
            </span>
            <textarea rows={4} value={pasteText} autoFocus={focusPaste} onChange={e => setPasteText(e.target.value)}
              placeholder={`Paste ${pasteFor}'s availability message here`} />
          </label>
          <div className="inline" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="primary" onClick={readMessage} disabled={reading || !pasteText.trim()}>
              {reading ? 'Reading message\u2026' : before ? 'Read again' : 'Fill in from message'}
            </button>
            {before && <button type="button" onClick={undoPaste}>Undo</button>}
            {pasteError && <span className="badge bad">{pasteError}</span>}
          </div>
          {parsed && (
            <div className="notice info" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>Understood:</strong> {parsed.summary}{' '}
              <span className="small">({added} slot{added === 1 ? '' : 's'} added, {removed} removed, shown with a blue outline. Not saved yet.)</span>
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
        <p className="muted small">
          Tap a slot to mark yourself available. Tap a date to toggle the whole day, or a time heading to toggle that time on every day.
          Set up the first week, then use &ldquo;Copy to all&rdquo; to repeat a weekday pattern across the month.
        </p>
      )}
      <div style={{ overflowX: 'auto' }} data-tour="avail-grid">
        <table className="avail">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Date</th>
              {SLOTS.map((s, i) => (
                <th key={s} title={s}>
                  {editable
                    ? <button className="link slot-label" onClick={() => toggleCol(i)} type="button" title={`Tick or untick ${s} on every day`}>{SLOT_LABEL[i][0]}<span><i className="dash">{'\u2013'}</i>{SLOT_LABEL[i][1]}</span></button>
                    : <span className="slot-label">{SLOT_LABEL[i][0]}<span><i className="dash">{'\u2013'}</i>{SLOT_LABEL[i][1]}</span></span>}
                </th>
              ))}
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.iso} className={(d.weekend ? 'weekend ' : '') + (d.sale ? 'mega' : '')}>
                <td className="date">
                  {editable
                    ? <button type="button" className="link" style={{ color: 'inherit' }} onClick={() => toggleRow(d.iso)}>{DOW[d.dow]} {d.d}</button>
                    : <span>{DOW[d.dow]} {d.d}</span>}
                  {d.sale && <span className="badge mega" style={{ marginLeft: 6 }}>{d.sale}</span>}
                </td>
                {SLOTS.map((s, i) => {
                  const on = selected.has(k(d.iso, i));
                  const changed = before ? before.has(k(d.iso, i)) !== on : false;
                  return (
                    <td key={s}>
                      <button type="button" className={'slotbtn' + (on ? ' on' : '') + (changed ? (on ? ' added' : ' removed') : '')} disabled={!editable}
                        aria-pressed={on} aria-label={`${DOW[d.dow]} ${d.d} ${s}`} onClick={() => toggle(d.iso, i)}>
                        {on ? '✓' : ''}
                      </button>
                    </td>
                  );
                })}
                {editable && (
                  <td>
                    {d.d <= 7 && (
                      <button type="button" className="link small" onClick={() => copyWeekday(d.dow)}>
                        Copy to all {DOW[d.dow]}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sticky-bar">
        <span className="muted small">
          {selected.size} slots selected
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
