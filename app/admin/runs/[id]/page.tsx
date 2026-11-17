import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange } from '@/lib/data';
import { fmtDate, fmtDateTime, fmtRange, formatTime, SLOTS } from '@/lib/format';
import { START_MINS, type SummarySection } from '@/lib/scheduler';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import { publishRun, unpublishMonth, deleteRun, renameRun, duplicateRun, updateStream, deleteStream, addStream } from '../../actions';

type SP = { view?: string; host?: string; edit?: string; ok?: string; bad?: string; t?: string };
const PLATFORMS = ['TikTok', 'Shopee', 'TikTok & Shopee'];

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const run = await one('SELECT * FROM schedule_runs WHERE id = $1', [Number(id)]);
  if (!run) notFound();
  const m = (await one('SELECT * FROM months WHERE id = $1', [run.month_id]))!;
  const { start, end } = monthRange(m.year, m.month);
  const [streams, hosts, rooms, brands, avail] = await Promise.all([
    query('SELECT * FROM scheduled_streams WHERE run_id = $1 ORDER BY date, start_min, room', [run.id]),
    query('SELECT id, name, active FROM hosts ORDER BY active DESC, sort_order, name'),
    query('SELECT name FROM rooms ORDER BY sort_order, id'),
    query('SELECT name FROM brands ORDER BY sort_order, name'),
    query('SELECT host_id, date, slot FROM availability WHERE date BETWEEN $1 AND $2', [start, end]),
  ]);
  const published = m.published_run_id === run.id;
  const view = ['grid', 'summary'].includes(sp.view || '') ? sp.view! : 'list';
  const hostFilter = sp.host ? Number(sp.host) : null;

  // Conflict checks (useful after manual edits).
  const availSet = new Set(avail.map(a => a.host_id + '|' + a.date + '|' + a.slot));
  const conflicts = new Map<number, string[]>();
  for (const s of streams) {
    const list: string[] = [];
    for (const o of streams) {
      if (o.id === s.id || o.date !== s.date || !(o.start_min < s.end_min && s.start_min < o.end_min)) continue;
      if (s.host_id && o.host_id === s.host_id) list.push('Host double-booked');
      if (s.room && o.room === s.room) list.push('Room clash');
      if (o.brand.toLowerCase() === s.brand.toLowerCase()) list.push('Same brand at the same time');
    }
    if (!s.host_name) list.push('No host');
    if (s.host_id) {
      const covered = START_MINS.map((m0, i) => ({ i, m0 })).filter(x => x.m0 < s.end_min && s.start_min < x.m0 + 120);
      if (!covered.every(x => availSet.has(s.host_id + '|' + s.date + '|' + x.i))) list.push('Host not marked available');
    }
    if (list.length) conflicts.set(s.id, [...new Set(list)]);
  }
  const shown = hostFilter ? streams.filter(s => s.host_id === hostFilter) : streams;
  const base = `/admin/runs/${run.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link href="/admin">Months</Link> / <Link href={`/admin/months/${m.id}?tab=schedule`}>{monthLabel(m.year, m.month)}</Link> /
          </div>
          <h1>{run.label || 'Version #' + run.id} {published && <span className="badge accent">Published</span>}</h1>
          <p className="muted small">Generated {fmtDateTime(run.created_at)}</p>
        </div>
        <div className="row-actions">
          {published ? (
            <form action={unpublishMonth}>
              <input type="hidden" name="monthId" value={m.id} /><input type="hidden" name="returnTo" value={base} />
              <ConfirmButton message="Hide this schedule from hosts?">Unpublish</ConfirmButton>
            </form>
          ) : (
            <form action={publishRun}>
              <input type="hidden" name="runId" value={run.id} />
              <ConfirmButton className="primary" message={m.published_run_id ? 'Replace the currently published version with this one?' : 'Publish this schedule to hosts?'}>
                Publish to hosts
              </ConfirmButton>
            </form>
          )}
          <a className="btn" href={`${base}/export`}>Export CSV</a>
          <form action={duplicateRun}><input type="hidden" name="runId" value={run.id} /><button type="submit">Duplicate</button></form>
          <form action={deleteRun}>
            <input type="hidden" name="runId" value={run.id} />
            <ConfirmButton className="danger" message="Delete this version?">Delete</ConfirmButton>
          </form>
        </div>
      </div>
      <Flash sp={sp} />
      {published && <div className="notice info">This version is live: edits here are visible to hosts straight away. Use Duplicate to work on a draft copy.</div>}

      <div className="stats">
        <div className="stat"><div className="n">{run.stats.fulfilled} / {run.stats.committed}</div><div className="l">Commitments fulfilled</div></div>
        <div className="stat"><div className="n" style={{ color: run.stats.unfulfilled ? 'var(--bad)' : undefined }}>{run.stats.unfulfilled}</div><div className="l">Unfulfilled</div></div>
        <div className="stat"><div className="n">{streams.length}</div><div className="l">Streams in this version</div></div>
        <div className="stat"><div className="n">{run.stats.unhostedPreplanned}</div><div className="l">Pre-planned without host</div></div>
        <div className="stat"><div className="n" style={{ color: conflicts.size ? 'var(--warn)' : undefined }}>{conflicts.size}</div><div className="l">Streams with flags</div></div>
      </div>

      <div className="tabs">
        <Link href={base} className={view === 'list' ? 'on' : ''}>List</Link>
        <Link href={`${base}?view=grid`} className={view === 'grid' ? 'on' : ''}>Room calendar</Link>
        <Link href={`${base}?view=summary`} className={view === 'summary' ? 'on' : ''}>Summary &amp; diagnostics</Link>
      </div>

      {view === 'list' && (
        <>
          <form className="inline" style={{ marginBottom: 12 }}>
            <select name="host" defaultValue={hostFilter ?? ''} aria-label="Filter by host">
              <option value="">All hosts</option>
              {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <button type="submit">Filter</button>
            {hostFilter && <Link href={base}>Clear</Link>}
          </form>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Time</th><th>Host</th><th>Brand</th><th>Period</th><th>Platform</th><th>Room</th><th>Flags</th><th /></tr></thead>
              <tbody>
                {shown.map(s => sp.edit === String(s.id) ? (
                  <tr key={s.id} id={'s' + s.id} style={{ background: 'var(--accent-soft)' }}>
                    <td colSpan={9}>
                      <form action={updateStream} className="form-row">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                        <label className="field">Date<input type="date" name="date" min={start} max={end} defaultValue={s.date} /></label>
                        <label className="field">Start<input type="time" name="start" step={900} defaultValue={formatTime(s.start_min)} /></label>
                        <label className="field">End<input type="time" name="end" step={900} defaultValue={formatTime(s.end_min % 1440)} /></label>
                        <label className="field">Host
                          <select name="hostId" defaultValue={s.host_id ?? ''}>
                            <option value="">No host</option>
                            {hosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.active ? '' : ' (inactive)'}</option>)}
                          </select>
                        </label>
                        <label className="field">Room
                          <select name="room" defaultValue={s.room}>
                            <option value="">None</option>
                            {rooms.map(r => <option key={r.name}>{r.name}</option>)}
                          </select>
                        </label>
                        <div className="inline"><button className="primary" type="submit">Save</button><Link href={`${base}#s${s.id}`}>Cancel</Link></div>
                      </form>
                      <p className="small muted">{s.brand} on {s.platform}. Flags are re-checked after saving.</p>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} id={'s' + s.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtRange(s.start_min, s.end_min)}</td>
                    <td>{s.host_name || <span className="badge bad">No host</span>}</td>
                    <td><strong>{s.brand}</strong></td>
                    <td>
                      <span className={'badge ' + (s.period === 'MEGA' ? 'mega' : '')}>{s.period}</span>
                      {s.period === 'MEGA' && <span className="small muted"> {s.sale}</span>}
                    </td>
                    <td>{s.platform}</td>
                    <td>{s.room || <span className="badge bad">No room</span>}</td>
                    <td className="small">
                      {s.fixed && !s.edited && <span className="badge" title="Pre-planned booking">Pre-planned</span>}{' '}
                      {s.auto_assigned_host && <span className="badge accent" title="Host chosen by the scheduler for a pre-planned booking">Auto host</span>}{' '}
                      {s.edited && <span className="badge">Edited</span>}{' '}
                      {(conflicts.get(s.id) || []).map(c => <span key={c} className="badge warn">{c}</span>)}
                    </td>
                    <td className="row-actions">
                      <Link href={`${base}?edit=${s.id}${hostFilter ? '&host=' + hostFilter : ''}#s${s.id}`}>Edit</Link>
                      <form action={deleteStream}>
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                        <ConfirmButton className="link danger" message="Remove this stream from this version?">Remove</ConfirmButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="card" key={sp.t || ''}>
            <summary>Add a stream manually</summary>
            <form action={addStream} className="form-row" style={{ marginTop: 12 }}>
              <input type="hidden" name="runId" value={run.id} />
              <label className="field">Date<input type="date" name="date" min={start} max={end} defaultValue={start} required /></label>
              <label className="field">Start<input type="time" name="start" step={900} defaultValue="20:00" required /></label>
              <label className="field">End<input type="time" name="end" step={900} defaultValue="22:00" required /></label>
              <label className="field">Brand<select name="brand" required>{brands.map(b => <option key={b.name}>{b.name}</option>)}</select></label>
              <label className="field">Platform<select name="platform">{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></label>
              <label className="field">Period<select name="period"><option>BAU</option><option>MEGA</option></select></label>
              <label className="field">Sale<input name="sale" placeholder="optional" /></label>
              <label className="field">Host
                <select name="hostId" defaultValue=""><option value="">No host</option>{hosts.filter(h => h.active).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              </label>
              <label className="field">Room<select name="room" defaultValue=""><option value="">None</option>{rooms.map(r => <option key={r.name}>{r.name}</option>)}</select></label>
              <div><button className="primary" type="submit">Add stream</button></div>
            </form>
          </details>
          <details className="card">
            <summary>Rename this version</summary>
            <form action={renameRun} className="inline" style={{ marginTop: 12 }}>
              <input type="hidden" name="runId" value={run.id} />
              <input name="label" defaultValue={run.label} placeholder="Version name" />
              <button type="submit">Save</button>
            </form>
          </details>
        </>
      )}

      {view === 'grid' && <RoomGrid streams={streams} rooms={rooms.map(r => r.name)} start={start} days={monthRange(m.year, m.month).days} />}

      {view === 'summary' && (
        <>
          <p className="muted small">{run.message} These figures are from when the scheduler ran; manual edits since then are not reflected.</p>
          {(run.sections as SummarySection[]).map(sec => (
            <div key={sec.title}>
              <h2>{sec.title}</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr>{sec.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {sec.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => {
                          const text = String(c);
                          const cls = text === 'UNFULFILLED' || text.startsWith('UNASSIGNED') ? 'badge bad'
                            : text === 'Fully Allocated' ? 'badge ok' : text === 'WARNING' ? 'badge warn' : '';
                          return <td key={j} colSpan={r.length === 1 ? sec.headers.length : undefined}>{cls ? <span className={cls}>{text}</span> : text}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function RoomGrid({ streams, rooms, start, days }: { streams: any[]; rooms: string[]; start: string; days: number }) {
  const prefix = start.slice(0, 8);
  const cellText = (date: string, slot: number, room: string) => streams
    .filter(s => s.date === date && s.room === room && s.start_min < START_MINS[slot] + 120 && START_MINS[slot] < s.end_min)
    .map(s => s);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Time</th>{rooms.map(r => <th key={r}>{r}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: days }, (_, i) => prefix + String(i + 1).padStart(2, '0')).map(date => SLOTS.map((slot, si) => (
            <tr key={date + si} style={si === 0 ? { borderTop: '2px solid var(--line)' } : undefined}>
              {si === 0 && <td rowSpan={SLOTS.length} style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(date)}</td>}
              <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{slot}</td>
              {rooms.map(r => (
                <td key={r} className="small">
                  {cellText(date, si, r).map(s => (
                    <div key={s.id}>
                      <strong>{s.brand}</strong> &times; {s.platform}
                      <div className="muted">{s.host_name || 'No host'}{s.start_min !== START_MINS[si] ? ' (' + fmtRange(s.start_min, s.end_min) + ')' : ''}</div>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
