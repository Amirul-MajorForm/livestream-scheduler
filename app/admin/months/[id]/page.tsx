import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, one } from '@/lib/db';
import { getMonth, monthLabel, monthRange, type MonthRow } from '@/lib/data';
import { fmtDate, fmtDateTime, fmtRange, pct, SLOTS } from '@/lib/format';
import { isoDate } from '@/lib/workbook';
import { mergeHours } from '@/lib/hours';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import SubmitButton from '@/components/SubmitButton';
import AvailabilityGrid from '@/components/AvailabilityGrid';
import PreplannedUpload from '@/components/PreplannedUpload';
import { SelectAllBox, BulkButton } from '@/components/BulkSelect';
import SortHeader, { readSort, sortRows } from '@/components/SortHeader';
import {
  updateMonthRules, addSaleDay, deleteSaleDay, addCommitment, updateCommitmentQty, deleteCommitment,
  addPreplanned, deletePreplanned, deletePreplannedMany, updatePreplannedHost, setAvailabilityOpen, runSchedule, deleteMonth, unpublishMonth,
} from '../../actions';

const TABS = [
  ['setup', 'Rules & sale days'],
  ['commitments', 'Commitments'],
  ['preplanned', 'Pre-planned streams'],
  ['availability', 'Host availability'],
  ['schedule', 'Schedule'],
] as const;
const PLATFORMS = ['TikTok', 'Shopee', 'TikTok & Shopee'];

type SP = { tab?: string; host?: string; paste?: string; upload?: string; sort?: string; dir?: string; ok?: string; bad?: string; t?: string };

export default async function MonthPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const m = await getMonth(Number(id));
  if (!m) notFound();
  const tab = TABS.some(t => t[0] === sp.tab) ? sp.tab! : 'setup';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link href="/admin">Months</Link> /</div>
          <h1>{monthLabel(m.year, m.month)}</h1>
        </div>
        <div className="inline">
          <span className={'badge ' + (m.availability_open ? 'ok' : '')}>Availability {m.availability_open ? 'open' : 'locked'}</span>
          {m.published_run_id ? <Link className="badge accent" href={`/admin/runs/${m.published_run_id}`}>Published schedule</Link> : <span className="badge">Not published</span>}
        </div>
      </div>
      <div className="tabs" data-tour="month-tabs">
        {TABS.map(([k, label]) => <Link key={k} href={`/admin/months/${m.id}?tab=${k}`} className={tab === k ? 'on' : ''}>{label}</Link>)}
      </div>
      <Flash sp={sp} />
      <div key={sp.t || ''}>
      {tab === 'setup' && <SetupTab m={m} />}
      {tab === 'commitments' && <CommitmentsTab m={m} />}
      {tab === 'preplanned' && <PreplannedTab m={m} sp={sp} />}
      {tab === 'availability' && <AvailabilityTab m={m} hostId={sp.host ? Number(sp.host) : null} sp={sp} />}
      {tab === 'schedule' && <ScheduleTab m={m} />}
      </div>
    </>
  );
}

async function SetupTab({ m }: { m: MonthRow }) {
  const sales = await query('SELECT * FROM sale_days WHERE month_id = $1 ORDER BY day', [m.id]);
  const { days } = monthRange(m.year, m.month);
  return (
    <div className="grid2">
      <div className="card" data-tour="sale-days">
        <h2 style={{ marginTop: 0 }}>Mega sale days</h2>
        <p className="muted small">Any day listed here is a Mega day; every other day is BAU. Mega commitments name the sales they can be scheduled on.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sale</th><th>Date</th><th /></tr></thead>
            <tbody>
              {sales.map(s => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{fmtDate(isoDate(m.year, m.month, s.day))}</td>
                  <td>
                    <form action={deleteSaleDay}>
                      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="monthId" value={m.id} />
                      <button className="link danger" type="submit">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
              {!sales.length && <tr><td colSpan={3} className="muted">No sale days yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={addSaleDay} className="form-row">
          <input type="hidden" name="monthId" value={m.id} />
          <label className="field">Sale name<input name="name" placeholder="e.g. Double digit D-Day" list="sale-names" required /></label>
          <label className="field" style={{ flex: '0 1 110px' }}>Day of month<input name="day" type="number" min={1} max={days} required /></label>
          <div><button type="submit">Add sale day</button></div>
          <datalist id="sale-names">
            {['Double digit D-1', 'Double digit D-Day', 'Mid-month D-1', 'Mid-month D-Day', 'Payday D-1', 'Payday D-Day'].map(x => <option key={x} value={x} />)}
          </datalist>
        </form>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Daytime slot limits</h2>
        <p className="muted small">
          Soft limits on how many of a commitment&rsquo;s sessions go in daytime slots (before 8PM), as a share of its total.
          The scheduler prefers evening slots once a commitment passes these.
        </p>
        <form action={updateMonthRules} className="form-row">
          <input type="hidden" name="monthId" value={m.id} />
          <label className="field">BAU weekday<input name="bau_weekday_pct" defaultValue={pct(m.bau_weekday_pct)} /></label>
          <label className="field">BAU weekend<input name="bau_weekend_pct" defaultValue={pct(m.bau_weekend_pct)} /></label>
          <label className="field">Mega weekday<input name="mega_weekday_pct" defaultValue={pct(m.mega_weekday_pct)} /></label>
          <label className="field">Mega weekend<input name="mega_weekend_pct" defaultValue={pct(m.mega_weekend_pct)} /></label>
          <div><button type="submit">Save limits</button></div>
        </form>
        <h3>Danger zone</h3>
        <form action={deleteMonth}>
          <input type="hidden" name="monthId" value={m.id} />
          <ConfirmButton className="danger" message={`Delete ${monthLabel(m.year, m.month)} with its commitments, pre-planned streams and schedule versions? Host availability is kept.`}>
            Delete this month
          </ConfirmButton>
        </form>
      </div>
    </div>
  );
}

async function CommitmentsTab({ m }: { m: MonthRow }) {
  const [rows, brands, sales] = await Promise.all([
    query(`SELECT c.*, b.name AS brand FROM commitments c JOIN brands b ON b.id = c.brand_id WHERE month_id = $1 ORDER BY c.sort_order, c.id`, [m.id]),
    query('SELECT * FROM brands ORDER BY sort_order, name'),
    query('SELECT * FROM sale_days WHERE month_id = $1 ORDER BY day', [m.id]),
  ]);
  const total = (p: string) => rows.filter(r => r.period === p).reduce((a, r) => a + r.qty, 0);
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="n">{total('bau')}</div><div className="l">BAU sessions &middot; <strong>{total('bau') * 2} h</strong></div></div>
        <div className="stat"><div className="n">{total('mega')}</div><div className="l">Mega sessions &middot; <strong>{total('mega') * 2} h</strong></div></div>
        <div className="stat"><div className="n">{total('bau') + total('mega')}</div><div className="l">Total sessions &middot; <strong>{(total('bau') + total('mega')) * 2} h</strong> (2 h each)</div></div>
        <div className="stat"><div className="n">{rows.filter(r => r.qty > 0).length}</div><div className="l">Active commitments</div></div>
      </div>
      <div className="table-wrap" data-tour="commitments">
        <table>
          <thead><tr><th>Brand</th><th>Period</th><th>Sales</th><th>Platform</th><th>Sessions &middot; priority</th><th /></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={r.qty === 0 ? { opacity: 0.55 } : undefined}>
                <td><strong>{r.brand}</strong></td>
                <td><span className={'badge ' + (r.period === 'mega' ? 'mega' : '')}>{r.period.toUpperCase()}</span></td>
                <td className="small">{r.period === 'bau' ? <span className="muted">Any BAU day</span> : r.sale.split(',').map((x: string) => x.trim()).join(', ')}</td>
                <td>{r.platform}</td>
                <td>
                  <form action={updateCommitmentQty} className="inline">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="monthId" value={m.id} />
                    <input name="qty" type="number" min={0} defaultValue={r.qty} style={{ width: 70 }} aria-label="Sessions" />
                    <input name="priority" type="number" min={1} defaultValue={r.priority ?? ''} style={{ width: 60 }} aria-label="Priority" placeholder="3" />
                    <button type="submit">Save</button>
                  </form>
                </td>
                <td>
                  <form action={deleteCommitment}>
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="monthId" value={m.id} />
                    <ConfirmButton className="link danger" message={`Remove this ${r.brand} commitment?`}>Remove</ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted">No commitments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a commitment</h2>
        <form action={addCommitment}>
          <input type="hidden" name="monthId" value={m.id} />
          <div className="form-row">
            <label className="field">Brand
              <select name="brandId" required defaultValue="">
                <option value="" disabled>Choose</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="field">Period<select name="period"><option value="bau">BAU</option><option value="mega">Mega</option></select></label>
            <label className="field">Platform<select name="platform">{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="field">Sessions<input name="qty" type="number" min={0} required /></label>
            <label className="field">Priority (1 = highest)<input name="priority" type="number" min={1} placeholder="3" /></label>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>For Mega commitments, tick the sales they can be scheduled on:</p>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
            {sales.map(s => <label key={s.id} className="inline"><input type="checkbox" name="sale" value={s.name} /> {s.name}</label>)}
            {!sales.length && <span className="muted small">Add sale days on the Rules tab first.</span>}
          </div>
          <button className="primary" type="submit">Add commitment</button>
        </form>
        <p className="small muted" style={{ marginTop: 12 }}>
          &ldquo;TikTok &amp; Shopee&rdquo; means one simultaneous stream on both platforms, so the host must be set up for both.
        </p>
      </div>
    </>
  );
}

async function PreplannedTab({ m, sp }: { m: MonthRow; sp: SP }) {
  const [allRows, brands, hosts, rooms, sales] = await Promise.all([
    query(`SELECT p.*, b.name AS brand, h.name AS host, h.active AS host_active FROM preplanned_streams p JOIN brands b ON b.id = p.brand_id
           LEFT JOIN hosts h ON h.id = p.host_id WHERE p.month_id = $1 ORDER BY p.date, p.start_min`, [m.id]),
    query('SELECT * FROM brands ORDER BY sort_order, name'),
    query('SELECT id, name, active FROM hosts ORDER BY active DESC, sort_order, name'),
    query('SELECT name FROM rooms ORDER BY sort_order'),
    query('SELECT * FROM sale_days WHERE month_id = $1 ORDER BY day', [m.id]),
  ]);
  const { start, end } = monthRange(m.year, m.month);
  const { sort, dir } = readSort(sp, ['date', 'host', 'brand', 'platform'], 'date');
  const keyFn: Record<string, (r: any) => string> = {
    date: r => r.date + String(r.start_min).padStart(4, '0'), host: r => r.host || '', brand: r => r.brand, platform: r => r.platform,
  };
  const rows = sortRows(allRows, keyFn[sort], dir);
  const sortParams = { tab: 'preplanned' };
  return (
    <>
      <PreplannedUpload monthId={m.id} existingCount={allRows.length} open={sp.upload === '1'} />
      <p className="muted">
        Confirmed bookings (e.g. The Ordinary, MOOM, Oatside). They are locked into the schedule first, even if they go over a host&rsquo;s caps.
        Leave the host blank to let the scheduler pick an eligible, available host.
      </p>
      {rows.length > 0 && (
        <form id="bulk-pre" action={deletePreplannedMany} className="bulk-bar">
          <input type="hidden" name="monthId" value={m.id} />
          <span className="small muted">Tick streams to remove several at once.</span>
          <BulkButton formId="bulk-pre" label="Remove selected" confirmText="Remove {n} pre-planned streams? This can't be undone." />
        </form>
      )}
      <div className="table-wrap" data-tour="preplanned">
        <table className="compact">
          <thead>
            <tr>
              <th className="cb">{rows.length > 0 && <SelectAllBox formId="bulk-pre" />}</th>
              <SortHeader label="Date" k="date" sort={sort} dir={dir} params={sortParams} />
              <th>Time</th>
              <SortHeader label="Brand" k="brand" sort={sort} dir={dir} params={sortParams} />
              <SortHeader label="Platform" k="platform" sort={sort} dir={dir} params={sortParams} />
              <th>Period</th>
              <SortHeader label="Host" k="host" sort={sort} dir={dir} params={sortParams} />
              <th>Room</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="cb"><input type="checkbox" name="ids" value={r.id} form="bulk-pre" aria-label={`Select ${r.brand} ${fmtDate(r.date)}`} /></td>
                <td className="nw">{fmtDate(r.date)}</td>
                <td className="nw">{fmtRange(r.start_min, r.end_min)}</td>
                <td className="nw"><strong>{r.brand}</strong></td>
                <td className="nw">{r.platform}</td>
                <td className="nw">
                  {r.period ? <span className={'badge ' + (r.period === 'mega' ? 'mega' : '')}>{r.period.toUpperCase()}</span> : <span className="muted small">auto</span>}
                  {r.sale && <span className="small muted"> {r.sale}</span>}
                </td>
                <td>
                  <form action={updatePreplannedHost} className="inline">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="monthId" value={m.id} />
                    <select name="hostId" defaultValue={r.host_id ?? ''} aria-label="Host">
                      <option value="">Auto-assign</option>
                      {hosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.active ? '' : ' (inactive)'}</option>)}
                    </select>
                    <button type="submit">Set</button>
                  </form>
                </td>
                <td>{r.room || <span className="muted small">any</span>}</td>
                <td>
                  <form action={deletePreplanned}>
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="monthId" value={m.id} />
                    <ConfirmButton className="link danger" message="Remove this pre-planned stream?">Remove</ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">No pre-planned streams.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a pre-planned stream</h2>
        <form action={addPreplanned} className="form-row">
          <input type="hidden" name="monthId" value={m.id} />
          <label className="field">Date<input type="date" name="date" min={start} max={end} defaultValue={start} required /></label>
          <label className="field">Start<input type="time" name="start" step={900} defaultValue="20:00" required /></label>
          <label className="field">End<input type="time" name="end" step={900} defaultValue="22:00" required /></label>
          <label className="field">Brand
            <select name="brandId" required defaultValue="">
              <option value="" disabled>Choose</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="field">Platform<select name="platform">{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></label>
          <label className="field">Host
            <select name="hostId" defaultValue="">
              <option value="">Auto-assign</option>
              {hosts.filter(h => h.active).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label className="field">Period
            <select name="period" defaultValue=""><option value="">From calendar</option><option value="bau">BAU</option><option value="mega">Mega</option></select>
          </label>
          <label className="field">Sale
            <select name="sale" defaultValue=""><option value="">From calendar</option>{sales.map(s => <option key={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="field">Room
            <select name="room" defaultValue=""><option value="">Any</option>{rooms.map(r => <option key={r.name}>{r.name}</option>)}</select>
          </label>
          <div><button className="primary" type="submit">Add</button></div>
        </form>
      </div>
    </>
  );
}

async function AvailabilityTab({ m, hostId, sp }: { m: MonthRow; hostId: number | null; sp: SP }) {
  const { start, end, days } = monthRange(m.year, m.month);
  if (hostId) {
    const host = await one('SELECT * FROM hosts WHERE id = $1', [hostId]);
    if (!host) notFound();
    const [slots, sales, sub] = await Promise.all([
      query('SELECT date, hour FROM availability WHERE host_id = $1 AND date BETWEEN $2 AND $3', [hostId, start, end]),
      query('SELECT name, day FROM sale_days WHERE month_id = $1', [m.id]),
      one('SELECT submitted_at FROM availability_submissions WHERE host_id = $1 AND month_id = $2', [hostId, m.id]),
    ]);
    return (
      <>
        <p><Link href={`/admin/months/${m.id}?tab=availability`}>&larr; All hosts</Link></p>
        <h2>Editing availability for {host.name}</h2>
        <AvailabilityGrid hostId={hostId} monthId={m.id} year={m.year} month={m.month}
          initial={slots.map(s => s.date + '|' + s.hour)}
          saleDays={Object.fromEntries(sales.map(s => [s.day, s.name]))}
          editable submittedAt={sub ? new Date(sub.submitted_at).toISOString() : null}
          pasteFor={host.name} focusPaste={sp.paste === '1'} />
      </>
    );
  }
  const [hostRows, counts, subs, users] = await Promise.all([
    query('SELECT id, name FROM hosts WHERE active ORDER BY name'),
    query(`SELECT host_id, date, count(*)::int AS n, array_agg(hour ORDER BY hour) AS hours FROM availability WHERE date BETWEEN $1 AND $2 GROUP BY host_id, date`, [start, end]),
    query('SELECT host_id, submitted_at FROM availability_submissions WHERE month_id = $1', [m.id]),
    query("SELECT host_id FROM users WHERE role = 'host'"),
  ]);
  const cnt = new Map(counts.map(c => [c.host_id + '|' + c.date, c.n]));
  const hoursOf = new Map<string, number[]>(counts.map(c => [c.host_id + '|' + c.date, c.hours]));
  // 2-hour stream blocks a host can actually be booked in (both hours ticked).
  const blocksOf = (hs: number[]) => [10, 12, 14, 16, 18, 20, 22].filter(b => hs.includes(b) && hs.includes(b + 1)).length;
  const sub = new Map(subs.map(s => [s.host_id, s.submitted_at]));
  const hasLogin = new Set(users.map(u => u.host_id));
  const dayList = Array.from({ length: days }, (_, i) => isoDate(m.year, m.month, i + 1));
  const totalOf = (hid: number) => dayList.reduce((a, d) => a + (cnt.get(hid + '|' + d) || 0), 0);
  const statusOf = (hid: number) => sub.has(hid) ? 'a' : totalOf(hid) > 0 ? 'b' : 'c';
  const { sort, dir } = readSort(sp, ['host', 'status', 'slots'], 'host');
  const hosts = sortRows(hostRows, sort === 'host' ? (h: any) => h.name : sort === 'slots' ? (h: any) => totalOf(h.id) : (h: any) => statusOf(h.id), dir);
  const sortParams = { tab: 'availability' };
  // Coverage per 2-hour stream block: host-days with both hours ticked, and how many different hosts.
  const perSlot = await query(`SELECT slot, count(*)::int AS n, count(DISTINCT host_id)::int AS hosts FROM (
      SELECT a.host_id, a.date, (a.hour - 10) / 2 AS slot FROM availability a JOIN hosts h ON h.id = a.host_id
      WHERE h.active AND a.date BETWEEN $1 AND $2 GROUP BY a.host_id, a.date, (a.hour - 10) / 2 HAVING count(*) = 2) b
    GROUP BY slot ORDER BY slot`, [start, end]);

  return (
    <>
      <div className="card inline" style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <div>
          <strong>{hosts.filter(h => sub.has(h.id) || dayList.some(d => cnt.has(h.id + '|' + d))).length} of {hosts.length}</strong> active hosts have availability for this month
          {' '}({hosts.filter(h => sub.has(h.id)).length} submitted it themselves).{' '}
          <div className="muted small" style={{ marginTop: 4 }}>
            {m.availability_open
              ? <><strong>Open:</strong> hosts can still add or change their availability for this month. When everyone has replied, click <em>Lock availability</em> so nothing changes while you build the schedule.</>
              : <><strong>Locked:</strong> hosts can see their availability but can&rsquo;t change it. Ops can still edit anyone&rsquo;s here. Re-open if a host needs to make changes.</>}
          </div>
        </div>
        <form action={setAvailabilityOpen} data-tour="avail-lock">
          <input type="hidden" name="monthId" value={m.id} />
          <input type="hidden" name="open" value={m.availability_open ? 'false' : 'true'} />
          <button type="submit" data-tip={m.availability_open
            ? 'Lock availability:\nStops hosts changing their availability for this month, so it can\u2019t shift while you schedule. Nothing is deleted, and you can re-open any time.'
            : 'Re-open:\nLets hosts change their availability for this month again.'}>{m.availability_open ? 'Lock availability' : 'Re-open for hosts'}</button>
        </form>
      </div>
      <form className="card paste-pick" data-tour="paste-pick" action={`/admin/months/${m.id}`}>
        <input type="hidden" name="tab" value="availability" />
        <input type="hidden" name="paste" value="1" />
        <div>
          <strong>Got availability by WhatsApp?</strong>{' '}
          <span className="small muted">Pick the host, paste their message, and the app fills in their slots for you to check and save.</span>
        </div>
        <div className="inline">
          <select name="host" required defaultValue="" aria-label="Host">
            <option value="" disabled>Choose host</option>
            {[...hostRows].sort((a, b) => a.name.localeCompare(b.name)).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <button type="submit" className="primary">Paste message</button>
        </div>
      </form>
      <div className="table-wrap">
        <table className="matrix" data-tour="avail-matrix">
          <thead>
            <tr>
              <SortHeader label="Host" k="host" sort={sort} dir={dir} params={sortParams} />
              <SortHeader label="Status" k="status" sort={sort} dir={dir} params={sortParams} />
              <SortHeader label="Hours (month)" k="slots" sort={sort} dir={dir} params={sortParams} className="num" />
              {dayList.map(d => {
                const dow = new Date(d + 'T00:00:00Z').getUTCDay();
                return (
                  <th key={d} title={fmtDate(d)} className={'daycol' + (dow === 0 || dow === 6 ? ' wkend' : '')}>
                    <span className="dow">{'SMTWTFS'[dow]}</span>{Number(d.slice(8))}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {hosts.map(h => {
              const total = totalOf(h.id);
              return (
                <tr key={h.id}>
                  <td className="h"><Link href={`/admin/months/${m.id}?tab=availability&host=${h.id}`}>{h.name}</Link></td>
                  <td className="h">
                    {sub.has(h.id) ? <span className="badge ok">Submitted</span>
                      : total > 0 ? <span className="badge" title="Availability exists but the host hasn't saved it themselves (e.g. imported or entered by ops)">Entered by ops</span>
                        : <span className="badge warn">Not yet</span>}
                    {!hasLogin.has(h.id) && <span className="badge" title="No login: ops must enter availability"> No login</span>}
                  </td>
                  <td className="num" data-tip={`${h.name}:\n${total} hours available this month`}>{total}</td>
                  {dayList.map(d => {
                    const v = cnt.get(h.id + '|' + d) || 0;
                    const hs = hoursOf.get(h.id + '|' + d) || [];
                    const tip = h.name + ', ' + fmtDate(d) + ':\n' + (v ? mergeHours(hs) + `\n${v} of 14 hours \u00b7 bookable in ${blocksOf(hs)} of 7 two-hour blocks` : 'Not available');
                    const wk = [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay());
                    return <td key={d} data-tip={tip} className={(v === 0 ? 'heat0' : v <= 4 ? 'heat1' : v <= 9 ? 'heat2' : 'heat3') + (wk && v === 0 ? ' wkend' : '')}>{v || '\u00b7'}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Each number is how many hours (out of 14, 10AM&ndash;12MN) the host ticked that day: 14 = free all day, &middot; = not available.
        <strong> Hover a number</strong> to see exactly which times and how many 2-hour stream blocks they can be booked in. <em>Hours (month)</em> is the month total. Click a name to view or edit the full grid.
      </p>
      <h3>Coverage by 2-hour stream block <span className="small muted" style={{ fontWeight: 400 }}>(host-days with both hours ticked)</span></h3>
      <div className="stats">
        {SLOTS.map((s, i) => {
          const r = perSlot.find(p => p.slot === i);
          return <div key={s} className="stat"><div className="n">{r?.n ?? 0}</div><div className="l">{s} &middot; {r?.hosts ?? 0} hosts</div></div>;
        })}
      </div>
    </>
  );
}

async function ScheduleTab({ m }: { m: MonthRow }) {
  const preCount = (await query('SELECT count(*)::int AS n FROM preplanned_streams WHERE month_id = $1', [m.id]))[0].n;
  const [runs, issues, subs, active] = await Promise.all([
    query(`SELECT r.*, u.email AS by_email, (SELECT count(*)::int FROM scheduled_streams s WHERE s.run_id = r.id) AS streams
           FROM schedule_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.month_id = $1 ORDER BY r.created_at DESC`, [m.id]),
    query(`SELECT name FROM hosts WHERE active AND (max_streams_month IS NULL OR max_brand_pct IS NULL OR max_brand_pct <= 0 OR platforms = '')`),
    query(`SELECT count(*)::int AS n FROM hosts h WHERE h.active AND (
             EXISTS (SELECT 1 FROM availability_submissions s WHERE s.host_id = h.id AND s.month_id = $1)
             OR EXISTS (SELECT 1 FROM availability a WHERE a.host_id = h.id AND a.date BETWEEN $2 AND $3))`,
      [m.id, monthRange(m.year, m.month).start, monthRange(m.year, m.month).end]),
    query('SELECT count(*)::int AS n FROM hosts WHERE active'),
  ]);
  return (
    <>
      <div className="card" data-tour="run-scheduler">
        <h2 style={{ marginTop: 0 }}>Generate a schedule</h2>
        <p className="muted small">
          Runs the scheduler on this month&rsquo;s commitments, pre-planned streams and current host availability. Each run is saved as a new version,
          so earlier versions (and any manual edits to them) are kept. Hosts only see the version you publish.
        </p>
        {issues.length > 0 && (
          <div className="notice bad">
            These active hosts are missing settings and will block the run: {issues.map(i => i.name).join(', ')}.{' '}
            <Link href="/admin/hosts">Fix on the Hosts page</Link> or mark them inactive.
          </div>
        )}
        {subs[0].n < active[0].n && (
          <div className="notice warn">{active[0].n - subs[0].n} active hosts have no availability for this month yet. You can still run; they just won&rsquo;t be scheduled.</div>
        )}
        <p className="small" style={{ margin: '0 0 10px' }}>
          <strong>{preCount}</strong> pre-planned stream{preCount === 1 ? '' : 's'} will be locked in first.{' '}
          <Link href={`/admin/months/${m.id}?tab=preplanned`}>Review them</Link> or{' '}
          <Link href={`/admin/months/${m.id}?tab=preplanned&upload=1`}>upload a .csv / Excel file</Link> before running.
        </p>
        <form action={runSchedule} className="form-row">
          <input type="hidden" name="monthId" value={m.id} />
          <label className="field">Version name (optional)<input name="label" placeholder="e.g. First draft" /></label>
          <div><SubmitButton className="primary" pending="Scheduling… (takes a few seconds)">Run scheduler</SubmitButton></div>
        </form>
      </div>
      <h2>Versions</h2>
      <div className="table-wrap" data-tour="versions">
        <table>
          <thead><tr><th>Version</th><th>Created</th><th>Result</th><th className="num">Streams</th><th /></tr></thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/runs/${r.id}`}><strong>{r.label || 'Version #' + r.id}</strong></Link>{' '}
                  {m.published_run_id === r.id && <span className="badge accent">Published</span>}
                </td>
                <td className="small">{fmtDateTime(r.created_at)}<div className="muted">{r.by_email}</div></td>
                <td>
                  <span className={'badge ' + (r.stats.unfulfilled ? 'warn' : 'ok')}>{r.stats.fulfilled} / {r.stats.committed} fulfilled</span>
                  {r.stats.unhostedPreplanned > 0 && <span className="badge bad"> {r.stats.unhostedPreplanned} unhosted</span>}
                </td>
                <td className="num">{r.streams}</td>
                <td><Link href={`/admin/runs/${r.id}`}>Open</Link></td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={5} className="muted">No versions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {m.published_run_id && (
        <form action={unpublishMonth}>
          <input type="hidden" name="monthId" value={m.id} />
          <ConfirmButton message="Hide the schedule from hosts?">Unpublish</ConfirmButton>
        </form>
      )}
    </>
  );
}
