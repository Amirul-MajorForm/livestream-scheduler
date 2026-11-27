import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange } from '@/lib/data';
import { fmtDate, fmtDateTime, fmtRange, formatTime, SLOTS } from '@/lib/format';
import { START_MINS, type SummarySection } from '@/lib/scheduler';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import AutoSubmitSelect from '@/components/AutoSubmitSelect';
import SortHeader, { readSort, sortRows } from '@/components/SortHeader';
import MonthCalendar, { type CalStream } from '@/components/MonthCalendar';
import FlagLegend, { FLAG_HELP, SHORT_TAG } from '@/components/FlagLegend';
import { findIssues } from '@/lib/issues';
import { brandStats, SESSION_HOURS } from '@/lib/brandStats';
import { publishRun, unpublishMonth, deleteRun, renameRun, duplicateRun, updateStream, deleteStream, addStream, setStreamStatus, setManyStatus } from '../../actions';

type SP = { view?: string; host?: string; brand?: string; show?: string; edit?: string; sort?: string; dir?: string; ok?: string; bad?: string; t?: string };
const PLATFORMS = ['TikTok', 'Shopee', 'TikTok & Shopee'];
const VIEWS = [['list', 'List'], ['calendar', 'Calendar'], ['grid', 'Room calendar'], ['summary', 'Summary & diagnostics']] as const;

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const run = await one('SELECT * FROM schedule_runs WHERE id = $1', [Number(id)]);
  if (!run) notFound();
  const m = (await one('SELECT * FROM months WHERE id = $1', [run.month_id]))!;
  const { start, end, days } = monthRange(m.year, m.month);
  const [streams, hosts, rooms, brands, avail, sales, prefs] = await Promise.all([
    query('SELECT * FROM scheduled_streams WHERE run_id = $1 ORDER BY date, start_min, room', [run.id]),
    query('SELECT id, name, active, max_streams_month, platforms FROM hosts ORDER BY active DESC, name'),
    query('SELECT name FROM rooms ORDER BY sort_order, id'),
    query('SELECT name FROM brands ORDER BY sort_order, name'),
    query('SELECT host_id, date, hour FROM availability WHERE date BETWEEN $1 AND $2', [start, end]),
    query('SELECT name, day FROM sale_days WHERE month_id = $1', [m.id]),
    query('SELECT p.host_id, lower(b.name) AS brand, p.level FROM host_brand_prefs p JOIN brands b ON b.id = p.brand_id'),
  ]);
  const published = m.published_run_id === run.id;
  const view = VIEWS.some(v => v[0] === sp.view) ? sp.view! : 'list';
  const hostFilter = sp.host ? Number(sp.host) : null;
  const show = ['flagged', 'nohost', 'edited', 'confirmed', 'tentative'].includes(sp.show || '') ? sp.show! : '';
  const { sort, dir } = readSort(sp, ['date', 'host', 'brand', 'platform', 'room', 'period'], 'date');

  // Warnings with explanations (re-checked on every page load, so they reflect manual edits).
  const prefsByHost = new Map<number, Record<string, string>>();
  prefs.forEach(p => prefsByHost.set(p.host_id, { ...(prefsByHost.get(p.host_id) || {}), [p.brand]: p.level }));
  const issues = findIssues(streams as any, avail as any, hosts.map(h => ({ ...h, prefs: prefsByHost.get(h.id) || {} })) as any);
  const conflicts = issues;

  // Hours (sessions are 2-hour slots; scheduled hours use each stream's real length).
  const hrs = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-SG');
  const scheduledHours = streams.reduce((a, x) => a + (x.end_min - x.start_min) / 60, 0);
  const shownHours = (list: any[]) => list.reduce((a, x) => a + (x.end_min - x.start_min) / 60, 0);

  let shown = streams;
  if (hostFilter) shown = shown.filter(s => s.host_id === hostFilter);
  if (sp.brand) shown = shown.filter(s => s.brand.toLowerCase() === sp.brand!.toLowerCase());
  if (show === 'flagged') shown = shown.filter(s => conflicts.has(s.id));
  if (show === 'nohost') shown = shown.filter(s => !s.host_name);
  if (show === 'edited') shown = shown.filter(s => s.edited);
  if (show === 'confirmed' || show === 'tentative') shown = shown.filter(s => s.status === show);
  const sortKey: Record<string, (s: any) => string | number> = {
    date: s => s.date + String(s.start_min).padStart(4, '0'),
    host: s => s.host_name, brand: s => s.brand, platform: s => s.platform, room: s => s.room, period: s => s.period,
  };
  shown = sortRows(shown, sortKey[sort], dir);

  const base = `/admin/runs/${run.id}`;
  const qs = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { view, host: sp.host, brand: sp.brand, show: sp.show, sort: sp.sort, dir: sp.dir, ...over };
    Object.entries(merged).forEach(([k, v]) => { if (v && !(k === 'view' && v === 'list')) q.set(k, v); });
    const s = q.toString();
    return s ? base + '?' + s : base;
  };
  // Live per-brand and overall hours (recounted from the streams, so edits are reflected).
  const brands_ = brandStats(run.sections as SummarySection[], streams as any);
  const H = (sessions: number) => sessions * SESSION_HOURS;
  const tot = brands_.reduce((a, b) => ({
    bauC: a.bauC + b.bau.committed, bauF: a.bauF + b.bau.fulfilled, megaC: a.megaC + b.mega.committed, megaF: a.megaF + b.mega.fulfilled,
  }), { bauC: 0, bauF: 0, megaC: 0, megaF: 0 });
  const totC = tot.bauC + tot.megaC, totF = tot.bauF + tot.megaF, totShort = totC - totF;
  const pctOf = (f: number, c: number) => c ? Math.round((f / c) * 100) : 100;
  const saleName = new Map(sales.map(x => [String(x.name).toLowerCase(), String(x.name)]));
  const confirmedCount = streams.filter(x => x.status === 'confirmed').length;
  const confirmedHours = shownHours(streams.filter(x => x.status === 'confirmed'));
  const listView = view === 'summary' || view === 'grid' ? 'list' : view;
  const sortParams = { view: view === 'list' ? undefined : view, host: sp.host, brand: sp.brand, show: sp.show };
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
            <form action={unpublishMonth} data-tour="run-publish">
              <input type="hidden" name="monthId" value={m.id} /><input type="hidden" name="returnTo" value={base} />
              <ConfirmButton message="Hide this schedule from hosts?">Unpublish</ConfirmButton>
            </form>
          ) : (
            <form action={publishRun} data-tour="run-publish">
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
      {published
        ? <div className="notice info slim">This version is live: hosts see it, including any streams you confirm here. Use Duplicate to work on a draft copy.</div>
        : <div className="notice warn slim">
            <strong>Draft: hosts can&rsquo;t see this version.</strong> Confirming streams here won&rsquo;t show on host pages until you click <em>Publish to hosts</em>.
            {m.published_run_id && <> The version hosts see now is <Link href={`/admin/runs/${m.published_run_id}`}>this one</Link>.</>}
          </div>}

      <div className="kpis" data-tour="run-stats">
        <div className="kpi" data-tip={'Committed hours:\nAll sessions on the Commitments tab for this month, at 2 hours each.'}>
          <div className="v">{hrs(H(totC))} h <small>committed</small></div>
          <div className="s">BAU {hrs(H(tot.bauC))} &middot; Mega {hrs(H(tot.megaC))} &middot; {totC} sessions</div>
        </div>
        <div className="kpi" data-tip={'Fulfilled hours:\nCommitted sessions covered by a stream with a host in this version. Updates when you edit streams.'}>
          <div className="v ok">{hrs(H(totF))} h <small>fulfilled &middot; {pctOf(totF, totC)}%</small></div>
          <div className="s">BAU {hrs(H(tot.bauF))}/{hrs(H(tot.bauC))} &middot; Mega {hrs(H(tot.megaF))}/{hrs(H(tot.megaC))}</div>
        </div>
        <Link className="kpi" href={`${base}?view=summary`} data-tip={'Not fulfilled:\nCommitted hours with no stream yet. Click for the scheduler\u2019s reason for each one.'}>
          <div className={'v' + (totShort ? ' bad' : '')}>{hrs(H(totShort))} h <small>short</small></div>
          <div className="s">BAU {hrs(H(tot.bauC - tot.bauF))} &middot; Mega {hrs(H(tot.megaC - tot.megaF))} &middot; see why</div>
        </Link>
        <Link className="kpi" href={qs({ show: 'confirmed', view: listView })} data-tip={'Scheduled and confirmed:\nAll streams in this version (actual lengths), and how many you have confirmed. Click to list the confirmed ones.'}>
          <div className="v">{hrs(scheduledHours)} h <small>scheduled</small></div>
          <div className="s">{streams.length} streams &middot; <span className="okt">{confirmedCount} confirmed ({hrs(confirmedHours)} h)</span></div>
        </Link>
        <Link className="kpi" href={qs({ show: 'nohost', view: listView })} data-tip={'Streams without a host:\n' + FLAG_HELP['No host'] + '\nClick to list them, then hover the red tag for the reason.'}>
          <div className={'v' + (noHost ? ' bad' : '')}>{noHost} <small>no host</small></div>
          <div className="s">{hrs(shownHours(streams.filter(x => !x.host_name)))} h</div>
        </Link>
        <Link className="kpi" href={qs({ show: 'flagged', view: listView })} data-tip={'Streams with warnings:\nStreams with an amber or red tag. Hover any tag to see exactly what is wrong. Warnings never block publishing.'}>
          <div className={'v' + (conflicts.size ? ' warn' : '')}>{conflicts.size} <small>warnings</small></div>
          <div className="s">click to list</div>
        </Link>
      </div>

      <details className="brand-section" open data-tour="brand-tiles">
        <summary>
          <strong>By brand</strong>{' '}
          <span className="small muted">
            {brands_.filter(b => b.committed > b.fulfilled).length} of {brands_.filter(b => b.committed).length} short &middot; hover for detail, click to filter
          </span>
        </summary>
        <div className="brand-grid">
          {brands_.map(b => {
            const short = b.committed - b.fulfilled;
            const tip = b.brand + ':\n' + b.lines.map(l =>
              `${l.period === 'mega' ? 'Mega' : 'BAU'} ${l.platform}${l.period === 'mega' ? ' (' + l.sale.split(',').map(x => saleName.get(x.trim()) || x.trim()).join(', ') + ')' : ''}: ${H(l.fulfilled)}/${H(l.committed)} h`).join('\n') +
              (b.extraStreams ? `\nPlus ${b.extraStreams} stream${b.extraStreams === 1 ? '' : 's'} (${hrs(b.extraHours)} h) beyond the commitments.` : '');
            const active = sp.brand?.toLowerCase() === b.brand.toLowerCase();
            const part = (k: 'bau' | 'mega') => b[k].committed > 0 && (
              <span key={k}>{k === 'bau' ? 'BAU' : 'Mega'} {hrs(H(b[k].fulfilled))}/{hrs(H(b[k].committed))}
                {b[k].committed > b[k].fulfilled && <em> &minus;{hrs(H(b[k].committed - b[k].fulfilled))}</em>}</span>
            );
            return (
              <Link key={b.brand} href={active ? qs({ brand: undefined }) : qs({ brand: b.brand, view: listView })}
                className={'brand-tile' + (active ? ' on' : '') + (short ? ' short' : b.committed ? ' done' : '')} data-tip={tip}>
                <div className="bt-head">
                  <strong>{b.brand}</strong>
                  {b.committed > 0
                    ? <span className={short ? 'bt-short' : 'bt-done'}>{hrs(H(b.fulfilled))}/{hrs(H(b.committed))} h</span>
                    : <span className="muted">extra only</span>}
                </div>
                {b.committed > 0 && <div className="bar"><span style={{ width: pctOf(b.fulfilled, b.committed) + '%' }} /></div>}
                <div className="bt-line">
                  {b.committed > 0 ? <>{part('bau')}{part('mega')}</> : <span>{b.extraStreams} streams &middot; {hrs(b.extraHours)} h</span>}
                  {b.committed > 0 && b.extraStreams > 0 && <span className="muted">+{b.extraStreams} extra</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </details>

      <div className="tabs" data-tour="run-views">
        {VIEWS.map(([k, label]) => <Link key={k} href={qs({ view: k, edit: undefined })} className={view === k ? 'on' : ''}>{label}</Link>)}
      </div>

      {(view === 'list' || view === 'calendar') && (
        <div className="toolbar-row">
        <form className="inline toolbar">
          {view !== 'list' && <input type="hidden" name="view" value={view} />}
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
          <select name="host" defaultValue={hostFilter ?? ''} aria-label="Filter by host">
            <option value="">All hosts</option>
            {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select name="brand" defaultValue={sp.brand ?? ''} aria-label="Filter by brand">
            <option value="">All brands</option>
            {brands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <select name="show" defaultValue={show} aria-label="Show">
            <option value="">All streams</option>
            <option value="flagged">Only streams with warnings</option>
            <option value="nohost">Only streams without a host</option>
            <option value="edited">Only edited streams</option>
            <option value="confirmed">Only confirmed</option>
            <option value="tentative">Only tentative</option>
          </select>
          <button type="submit">Apply</button>
          {(hostFilter || show || sp.brand) && <Link href={qs({ host: undefined, show: undefined, brand: undefined })}>Clear</Link>}
          <span className="muted small">{shown.length} of {streams.length} streams</span>
        </form>
        {shown.some(x => x.status !== 'confirmed' && x.host_name) && (
          <form action={setManyStatus} className="inline">
            <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="status" value="confirmed" />
            <input type="hidden" name="returnTo" value={qs({})} />
            <input type="hidden" name="ids" value={shown.filter(x => x.status !== 'confirmed' && x.host_name).map(x => x.id).join(',')} />
            <ConfirmButton className="primary" message={`Confirm ${shown.filter(x => x.status !== 'confirmed' && x.host_name).length} streams shown? Hosts will see them as confirmed and they will be locked.`}>
              Confirm {hostFilter || sp.brand || show ? 'these' : 'all'} ({shown.filter(x => x.status !== 'confirmed' && x.host_name).length})
            </ConfirmButton>
          </form>
        )}
        {shown.some(x => x.status === 'confirmed') && (
          <form action={setManyStatus} className="inline">
            <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="status" value="tentative" />
            <input type="hidden" name="returnTo" value={qs({})} />
            <input type="hidden" name="ids" value={shown.filter(x => x.status === 'confirmed').map(x => x.id).join(',')} />
            <ConfirmButton className="link" message="Set these confirmed streams back to tentative (unlocks them)?">Unconfirm</ConfirmButton>
          </form>
        )}
        </div>
      )}

      {view === 'list' && (
        <>
          <div className="table-wrap sticky-table" data-tour="run-table">
            <table className="compact one-line">
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
                  <th data-tip={'Status:\nTentative = may still change. Confirmed = locked in: hosts see it as confirmed, it can\u2019t be edited or removed until set back to Tentative, and re-running the scheduler keeps it.'}>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map(s => sp.edit === String(s.id) ? (
                  <tr key={s.id} id={'s' + s.id} className="row-editing">
                    <td><input form={'f' + s.id} type="date" name="date" min={start} max={end} defaultValue={s.date} aria-label="Date" /></td>
                    <td className="nw">
                      <input form={'f' + s.id} name="start" className="hhmm" defaultValue={formatTime(s.start_min)} aria-label="Start (24-hour, e.g. 20:00)" title="Start, 24-hour clock (e.g. 20:00)" pattern="[0-2]?[0-9]:[0-5][0-9]" required />
                      {'\u2013'}
                      <input form={'f' + s.id} name="end" className="hhmm" defaultValue={formatTime(s.end_min % 1440)} aria-label="End (24-hour, e.g. 22:00)" title="End, 24-hour clock (e.g. 22:00; 00:00 = midnight)" pattern="[0-2]?[0-9]:[0-5][0-9]" required />
                    </td>
                    <td>
                      <select form={'f' + s.id} name="hostId" defaultValue={s.host_id ?? ''} aria-label="Host">
                        <option value="">No host</option>
                        {hosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.active ? '' : ' (inactive)'}</option>)}
                      </select>
                    </td>
                    <td>
                      <select form={'f' + s.id} name="brand" defaultValue={s.brand} aria-label="Brand">
                        {[...new Set([s.brand, ...brands.map(b => b.name)])].map(b => <option key={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="nw">
                      <select form={'f' + s.id} name="period" defaultValue={s.period} aria-label="Period">
                        <option value="BAU">BAU</option><option value="MEGA">MEGA</option>
                      </select>
                      <select form={'f' + s.id} name="sale" defaultValue={s.sale} aria-label="Sale (Mega only)">
                        <option value="">(no sale)</option>
                        {[...new Set([s.sale, ...sales.map(x => x.name)].filter(Boolean))].map(x => <option key={x}>{x}</option>)}
                      </select>
                    </td>
                    <td>
                      <select form={'f' + s.id} name="platform" defaultValue={s.platform} aria-label="Platform">
                        {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <select form={'f' + s.id} name="room" defaultValue={s.room} aria-label="Room">
                        <option value="">None</option>
                        {rooms.map(r => <option key={r.name}>{r.name}</option>)}
                      </select>
                    </td>
                    <td colSpan={2} className="nw">
                      <form id={'f' + s.id} action={updateStream} className="row-actions">
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                        <button className="primary" type="submit">Save</button>
                        <Link href={qs({}) + `#s${s.id}`}>Cancel</Link>
                        <span className="small muted">Warnings re-check on save</span>
                      </form>
                    </td>
                    <td />
                  </tr>
                ) : (
                  <tr key={s.id} id={'s' + s.id} className={s.status === 'confirmed' ? 'row-confirmed' : undefined}>
                    <td className="nw">{fmtDate(s.date)}</td>
                    <td className="nw">{fmtRange(s.start_min, s.end_min)}</td>
                    <td className="nw">{s.host_name || <span className="badge bad tip" tabIndex={0} data-tip={'No host:\n' + (issues.get(s.id)?.find(i => i.tag === 'No host')?.detail || FLAG_HELP['No host'])}>No host</span>}</td>
                    <td className="nw"><strong>{s.brand}</strong></td>
                    <td className="nw">
                      <span className={'badge ' + (s.period === 'MEGA' ? 'mega' : '')}>{s.period}</span>
                      {s.period === 'MEGA' && <span className="small muted"> {s.sale}</span>}
                    </td>
                    <td className="nw">{s.platform}</td>
                    <td className="nw">{s.room || <span className="badge bad tip" tabIndex={0} data-tip={'No room:\n' + FLAG_HELP['No room']}>No room</span>}</td>
                    <td className="tags">
                      {s.fixed && !s.edited && <span className="badge tip" tabIndex={0} data-tip={'Pre-planned:\n' + FLAG_HELP['Pre-planned']}>Pre-planned</span>}
                      {s.auto_assigned_host && <span className="badge accent tip" tabIndex={0} data-tip={'Auto host:\n' + FLAG_HELP['Auto host']}>Auto host</span>}
                      {s.edited && <span className="badge tip" tabIndex={0} data-tip={'Edited:\n' + FLAG_HELP['Edited']}>Edited</span>}
                      {(issues.get(s.id) || []).filter(i => i.tag !== 'No host' && i.tag !== 'No room').map(i => (
                        <span key={i.tag} className={'badge tip ' + i.severity} tabIndex={0} data-tip={i.tag + ':\n' + i.detail}>{SHORT_TAG[i.tag] || i.tag}</span>
                      ))}
                    </td>
                    <td className="nw">
                      <form action={setStreamStatus}>
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="returnTo" value={qs({})} />
                        <AutoSubmitSelect name="status" defaultValue={s.status} label={`Status of ${s.brand} ${fmtDate(s.date)}`}
                          className={'status-select ' + s.status}
                          options={[{ value: 'tentative', label: 'Tentative' }, { value: 'confirmed', label: '\u2713 Confirmed' }]} />
                      </form>
                    </td>
                    <td className="nw">
                      {s.status === 'confirmed' ? (
                        <span className="small muted" data-tip={'Locked:\nConfirmed streams can\u2019t be edited or removed. Set the status back to Tentative first.'}>Locked</span>
                      ) : (
                        <span className="row-actions">
                          <Link href={qs({ edit: String(s.id) }) + `#s${s.id}`}>Edit</Link>
                          <form action={deleteStream}>
                            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="runId" value={run.id} />
                            <ConfirmButton className="link danger" message="Remove this stream from this version?">Remove</ConfirmButton>
                          </form>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={10} className="muted">No streams match.</td></tr>}
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
            Hover a stream for details and warnings; click it to edit. <span className="badge mega">Purple</span> edge = Mega sale day,{' '}
            <span className="badge warn">amber</span> = has a warning, <span className="badge bad">red</span> = no host. TT = TikTok, SP = Shopee, TT+SP = both at once.
          </p>
          <MonthCalendar year={m.year} month={m.month} streams={shown as CalStream[]}
            saleDays={Object.fromEntries(sales.map(s => [s.day, s.name]))}
            issues={issues}
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
