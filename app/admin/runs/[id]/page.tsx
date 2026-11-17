import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange } from '@/lib/data';
import { fmtDate, fmtDateTime, fmtRange, formatTime, SLOTS } from '@/lib/format';
import { START_MINS, type SummarySection } from '@/lib/scheduler';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import SortHeader, { readSort, sortRows } from '@/components/SortHeader';
import MonthCalendar, { type CalStream } from '@/components/MonthCalendar';
import FlagLegend, { FLAG_HELP } from '@/components/FlagLegend';
import { publishRun, unpublishMonth, deleteRun, renameRun, duplicateRun, updateStream, deleteStream, addStream } from '../../actions';

type SP = { view?: string; host?: string; show?: string; edit?: string; sort?: string; dir?: string; ok?: string; bad?: string; t?: string };
const PLATFORMS = ['TikTok', 'Shopee', 'TikTok & Shopee'];
const VIEWS = [['list', 'List'], ['calendar', 'Calendar'], ['grid', 'Room calendar'], ['summary', 'Summary & diagnostics']] as const;

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const run = await one('SELECT * FROM schedule_runs WHERE id = $1', [Number(id)]);
  if (!run) notFound();
  const m = (await one('SELECT * FROM months WHERE id = $1', [run.month_id]))!;
  const { start, end, days } = monthRange(m.year, m.month);
  const [streams, hosts, rooms, brands, avail, sales] = await Promise.all([
    query('SELECT * FROM scheduled_streams WHERE run_id = $1 ORDER BY date, start_min, room', [run.id]),
    query('SELECT id, name, active FROM hosts ORDER BY active DESC, name'),
    query('SELECT name FROM rooms ORDER BY sort_order, id'),
    query('SELECT name FROM brands ORDER BY sort_order, name'),
    query('SELECT host_id, date, slot FROM availability WHERE date BETWEEN $1 AND $2', [start, end]),
    query('SELECT name, day FROM sale_days WHERE month_id = $1', [m.id]),
  ]);
  const published = m.published_run_id === run.id;
  const view = VIEWS.some(v => v[0] === sp.view) ? sp.view! : 'list';
  const hostFilter = sp.host ? Number(sp.host) : null;
  const show = ['flagged', 'nohost', 'edited'].includes(sp.show || '') ? sp.show! : '';
  const { sort, dir } = readSort(sp, ['date', 'host', 'brand', 'platform', 'room', 'period'], 'date');

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
    if (s.host_id) {
      const covered = START_MINS.map((m0, i) => ({ i, m0 })).filter(x => x.m0 < s.end_min && s.start_min < x.m0 + 120);
      if (!covered.every(x => availSet.has(s.host_id + '|' + s.date + '|' + x.i))) list.push('Host not marked available');
    }
    if (list.length || !s.host_name || !s.room) conflicts.set(s.id, [...new Set(list)]);
  }

  let shown = streams;
  if (hostFilter) shown = shown.filter(s => s.host_id === hostFilter);
  if (show === 'flagged') shown = shown.filter(s => conflicts.has(s.id));
  if (show === 'nohost') shown = shown.filter(s => !s.host_name);
  if (show === 'edited') shown = shown.filter(s => s.edited);
  const sortKey: Record<string, (s: any) => string | number> = {
    date: s => s.date + String(s.start_min).padStart(4, '0'),
    host: s => s.host_name, brand: s => s.brand, platform: s => s.platform, room: s => s.room, period: s => s.period,
  };
  shown = sortRows(shown, sortKey[sort], dir);

  const base = `/admin/runs/${run.id}`;
  const qs = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { view, host: sp.host, show: sp.show, sort: sp.sort, dir: sp.dir, ...over };
    Object.entries(merged).forEach(([k, v]) => { if (v && !(k === 'view' && v === 'list')) q.set(k, v); });
    const s = q.toString();
    return s ? base + '?' + s : base;
  };
  const sortParams = { view: view === 'list' ? undefined : view, host: sp.host, show: sp.show };
  const noHost = streams.filter(s => !s.host_name).length;

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
        <Link className="stat" href={`${base}?view=summary`}>
          <div className="n" style={{ color: run.stats.unfulfilled ? 'var(--bad)' : undefined }}>{run.stats.unfulfilled}</div>
          <div className="l">Unfulfilled &middot; see why</div>
        </Link>
        <Link className="stat" href={qs({ show: undefined })}><div className="n">{streams.length}</div><div className="l">Streams in this version</div></Link>
        <Link className="stat" href={qs({ show: 'nohost', view: view === 'summary' || view === 'grid' ? 'list' : view })}>
          <div className="n" style={{ color: noHost ? 'var(--bad)' : undefined }}>{noHost}</div><div className="l">Streams without a host</div>
        </Link>
        <Link className="stat" href={qs({ show: 'flagged', view: view === 'summary' || view === 'grid' ? 'list' : view })}>
          <div className="n" style={{ color: conflicts.size ? 'var(--warn)' : undefined }}>{conflicts.size}</div><div className="l">Streams with warnings</div>
        </Link>
      </div>

      <div className="tabs">
        {VIEWS.map(([k, label]) => <Link key={k} href={qs({ view: k, edit: undefined })} className={view === k ? 'on' : ''}>{label}</Link>)}
      </div>

      {(view === 'list' || view === 'calendar') && (
        <form className="inline toolbar">
          {view !== 'list' && <input type="hidden" name="view" value={view} />}
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
          <select name="host" defaultValue={hostFilter ?? ''} aria-label="Filter by host">
            <option value="">All hosts</option>
            {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select name="show" defaultValue={show} aria-label="Show">
            <option value="">All streams</option>
            <option value="flagged">Only streams with warnings</option>
            <option value="nohost">Only streams without a host</option>
            <option value="edited">Only edited streams</option>
          </select>
          <button type="submit">Apply</button>
          {(hostFilter || show) && <Link href={qs({ host: undefined, show: undefined })}>Clear</Link>}
          <span className="muted small">{shown.length} of {streams.length} streams</span>
        </form>
      )}

      {view === 'list' && (
        <>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <SortHeader label="Date" k="date" sort={sort} dir={dir} params={sortParams} />
                  <th>Time</th>
                  <SortHeader label="Host" k="host" sort={sort} dir={dir} params={sortParams} />
                  <SortHeader label="Brand" k="brand" sort={sort} dir={dir} params={sortParams} />
                  <SortHeader label="Period" k="period" sort={sort} dir={dir} params={sortParams} />
                  <SortHeader label="Platform" k="platform" sort={sort} dir={dir} params={sortParams} />
                  <SortHeader label="Room" k="room" sort={sort} dir={dir} params={sortParams} />
                  <th>Tags</th>
                  <th />
                </tr>
              </thead>
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
                        <div className="inline"><button className="primary" type="submit">Save</button><Link href={qs({}) + `#s${s.id}`}>Cancel</Link></div>
                      </form>
                      <p className="small muted">{s.brand} on {s.platform}. Warnings are re-checked after saving.</p>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} id={'s' + s.id}>
                    <td className="nw">{fmtDate(s.date)}</td>
                    <td className="nw">{fmtRange(s.start_min, s.end_min)}</td>
                    <td className="nw">{s.host_name || <span className="badge bad" title={FLAG_HELP['No host']}>No host</span>}</td>
                    <td className="nw"><strong>{s.brand}</strong></td>
                    <td className="nw">
                      <span className={'badge ' + (s.period === 'MEGA' ? 'mega' : '')}>{s.period}</span>
                      {s.period === 'MEGA' && <span className="small muted"> {s.sale}</span>}
                    </td>
                    <td className="nw">{s.platform}</td>
                    <td className="nw">{s.room || <span className="badge bad" title={FLAG_HELP['No room']}>No room</span>}</td>
                    <td className="tags">
                      {s.fixed && !s.edited && <span className="badge" title={FLAG_HELP['Pre-planned']}>Pre-planned</span>}
                      {s.auto_assigned_host && <span className="badge accent" title={FLAG_HELP['Auto host']}>Auto host</span>}
                      {s.edited && <span className="badge" title={FLAG_HELP['Edited']}>Edited</span>}
                      {(conflicts.get(s.id) || []).map(c => <span key={c} className="badge warn" title={FLAG_HELP[c]}>{c}</span>)}
                    </td>
                    <td className="nw">
                      <span className="row-actions">
                        <Link href={qs({ edit: String(s.id) }) + `#s${s.id}`}>Edit</Link>
                        <form action={deleteStream}>
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                          <ConfirmButton className="link danger" message="Remove this stream from this version?">Remove</ConfirmButton>
                        </form>
                      </span>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={9} className="muted">No streams match.</td></tr>}
              </tbody>
            </table>
          </div>
          <FlagLegend />
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

      {view === 'calendar' && (
        <>
          <p className="small muted">
            Click a stream to edit it. <span className="badge mega">Purple</span> edge = Mega sale day stream,{' '}
            <span className="badge warn">amber</span> edge = has a warning. TT = TikTok, SP = Shopee, TT+SP = both at once.
          </p>
          <MonthCalendar year={m.year} month={m.month} streams={shown as CalStream[]}
            saleDays={Object.fromEntries(sales.map(s => [s.day, s.name]))}
            flagged={new Set(conflicts.keys())}
            hrefFor={sid => qs({ view: 'list', show: undefined, host: undefined, sort: undefined, dir: undefined, edit: String(sid) }) + '#s' + sid} />
          <FlagLegend />
        </>
      )}

      {view === 'grid' && <RoomGrid streams={streams} rooms={rooms.map(r => r.name)} start={start} days={days} />}

      {view === 'summary' && (
        <>
          <p className="muted small">{run.message} These figures are from when the scheduler ran; manual edits since then are not reflected.</p>
          {(run.sections as SummarySection[]).map(sec => (
            <div key={sec.title}>
              <h2>{sec.title}</h2>
              <div className="table-wrap">
                <table className="compact">
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
  const inCell = (date: string, slot: number, room: string) => streams
    .filter(s => s.date === date && s.room === room && s.start_min < START_MINS[slot] + 120 && START_MINS[slot] < s.end_min);
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead><tr><th>Date</th><th>Time</th>{rooms.map(r => <th key={r}>{r}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: days }, (_, i) => prefix + String(i + 1).padStart(2, '0')).map(date => SLOTS.map((slot, si) => (
            <tr key={date + si} className={si === 0 ? 'day-start' : undefined}>
              {si === 0 && <td rowSpan={SLOTS.length} className="nw" style={{ fontWeight: 600 }}>{fmtDate(date)}</td>}
              <td className="small muted nw">{slot}</td>
              {rooms.map(r => (
                <td key={r} className="small">
                  {inCell(date, si, r).map(s => (
                    <div key={s.id}>
                      <strong>{s.brand}</strong> &times; {s.platform}{' '}
                      <span className="muted">{s.host_name || 'No host'}{s.start_min !== START_MINS[si] ? ' (' + fmtRange(s.start_min, s.end_min) + ')' : ''}</span>
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
