import Link from 'next/link';
import { requireHost } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange, ensureMonth, todayYearMonth, type MonthRow } from '@/lib/data';
import AppShell from '@/components/AppShell';
import TypedGreeting from '@/components/TypedGreeting';
import AvailabilityGrid from '@/components/AvailabilityGrid';
import StreamList, { type StreamRow } from '@/components/StreamList';
import MonthCalendar from '@/components/MonthCalendar';
import PlatformTag from '@/components/PlatformTag';
import { brandColors } from '@/lib/colors';
import { loadHostEarnings, hostYears, type HostStream } from '@/lib/hostEarnings';
import { money } from '@/lib/earnings';
import { fmtDate, fmtRange, MONTH_NAMES } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function HostHome({ searchParams }: { searchParams: Promise<{ m?: string; tab?: string; view?: string; y?: string; em?: string; eb?: string }> }) {
  const user = await requireHost();
  const sp = await searchParams;
  const host = await one('SELECT * FROM hosts WHERE id = $1', [user.hostId]);

  // Hosts always see this month and the next two (created empty if ops haven't set them up yet),
  // plus any later month ops have opened or published.
  const now = todayYearMonth();
  const plus = (n: number) => ({ year: now.year + Math.floor((now.month + n) / 12), month: (now.month + n) % 12 });
  const ahead = plus(2);
  const [thisMonth, nextMonth, monthAfter] = await Promise.all([0, 1, 2].map(n => ensureMonth(plus(n).year, plus(n).month)));
  const later = await query<MonthRow>(
    `SELECT * FROM months WHERE (year * 12 + month) > $1 AND (availability_open OR published_run_id IS NOT NULL) ORDER BY year, month LIMIT 3`,
    [ahead.year * 12 + ahead.month]);
  // Earlier months of this year that have a schedule out, so hosts can look back.
  const earlier = await query<MonthRow>(
    `SELECT * FROM months WHERE year = $1 AND month < $2 AND published_run_id IS NOT NULL ORDER BY month`, [now.year, now.month]);
  const months = [...earlier, thisMonth, nextMonth, monthAfter, ...later];

  const tab = sp.tab === 'availability' ? 'availability' : sp.tab === 'earnings' ? 'earnings' : 'schedule';
  // Default: the schedule tab opens on the nearest month that has a schedule out (this month if it
  // has one, else the next one that does); the availability tab opens on next month.
  const current = months.find(m => String(m.id) === sp.m)
    || (tab === 'availability'
      ? (nextMonth.availability_open ? nextMonth : thisMonth)
      : (months.find(m => m.published_run_id && !earlier.some(e => e.id === m.id)) || thisMonth));
  const view = sp.view === 'calendar' ? 'calendar' : 'list';
  const link = (o: { m?: number; tab?: string; view?: string }) => {
    const q = new URLSearchParams();
    q.set('m', String(o.m ?? current.id));
    const t = o.tab ?? tab;
    if (t !== 'schedule') q.set('tab', t);
    if (t === 'earnings') { q.delete('m'); }
    const v = o.view ?? view;
    if (t === 'schedule' && v === 'calendar') q.set('view', 'calendar');
    return '/host?' + q.toString();
  };

  const { start, end } = monthRange(current.year, current.month);
  let content: React.ReactNode;
  if (tab === 'schedule') {
    const [sales, brandRows] = await Promise.all([
      query('SELECT name, day FROM sale_days WHERE month_id = $1', [current.id]),
      query('SELECT name FROM brands ORDER BY sort_order, name'),
    ]);
    const colors = brandColors(brandRows.map(b => b.name));
    const streams = current.published_run_id
      ? await query<StreamRow>(
        `SELECT id, date, start_min, end_min, host_name, brand, period, sale, platform, room, status
         FROM scheduled_streams WHERE run_id = $1
           AND (host_id = $2 OR lower($3) = ANY(regexp_split_to_array(lower(host_name), '\\s*(,|&|/|\\+| and )\\s*')))
         ORDER BY date, start_min`, [current.published_run_id, user.hostId, host?.name || ''])
      : [];
    const hours = Math.round(streams.reduce((a, x) => a + (x.end_min - x.start_min), 0) / 6) / 10;
    content = current.published_run_id ? (
      <div className="card" data-tour="host-schedule">
        <div className="host-sched-head">
          <div>
            <h2 style={{ margin: 0 }}>Your streams in {monthLabel(current.year, current.month)}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {streams.length} stream{streams.length === 1 ? '' : 's'} &middot; {hours} hours{' '}
              <span className="badge ok">{streams.filter(x => x.status === 'confirmed').length} confirmed</span>{' '}
              {streams.some(x => x.status !== 'confirmed') && <span className="badge warn">{streams.filter(x => x.status !== 'confirmed').length} tentative</span>}
            </p>
          </div>
          <div className="seg" role="tablist" aria-label="View">
            <Link href={link({ view: 'list' })} className={view === 'list' ? 'on' : ''} role="tab" aria-selected={view === 'list'}>List</Link>
            <Link href={link({ view: 'calendar' })} className={view === 'calendar' ? 'on' : ''} role="tab" aria-selected={view === 'calendar'}>Calendar</Link>
          </div>
        </div>
        {streams.length > 0 && (
          <div className="color-key" aria-label="Colour key">
            {[...new Set(streams.map(x => x.brand))].map(b => (
              <span key={b} className="key-brand" style={{ background: colors[b]?.bg, borderLeftColor: colors[b]?.edge }}>{b}</span>
            ))}
            <span className="key-sep" />
            {[...new Set(streams.map(x => x.platform))].map(p => <PlatformTag key={p} platform={p} />)}
          </div>
        )}
        {view === 'calendar'
          ? <MonthCalendar year={current.year} month={current.month} streams={streams} showHost={false} colors={colors}
              saleDays={Object.fromEntries(sales.map(s => [s.day, s.name]))} />
          : <StreamList streams={streams} colors={colors} />}
      </div>
    ) : (
      <div className="card" data-tour="host-schedule">
        <p style={{ marginTop: 0 }}>The schedule for {monthLabel(current.year, current.month)} hasn&rsquo;t been released yet. Check back later.</p>
        {current.availability_open && <p style={{ marginBottom: 0 }}><Link href={link({ tab: 'availability' })}>Add or update your availability for {monthLabel(current.year, current.month)}</Link> so you can be scheduled.</p>}
      </div>
    );
  } else if (tab === 'earnings') {
    const years = await hostYears();
    const year = years.includes(Number(sp.y)) ? Number(sp.y) : (years.includes(now.year) ? now.year : years[0] ?? now.year);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const streams = user.hostId && host ? await loadHostEarnings({ id: user.hostId, name: host.name }, year, today) : [];
    content = <EarningsView streams={streams} year={year} years={years} sp={sp} />;
  } else {
    const [hourRows, saleDays, sub] = await Promise.all([
      query('SELECT date, hour FROM availability WHERE host_id = $1 AND date BETWEEN $2 AND $3', [user.hostId, start, end]),
      query('SELECT name, day FROM sale_days WHERE month_id = $1', [current.id]),
      one('SELECT submitted_at FROM availability_submissions WHERE host_id = $1 AND month_id = $2', [user.hostId, current.id]),
    ]);
    content = (
      <AvailabilityGrid
        key={current.id}
        hostId={user.hostId} monthId={current.id} year={current.year} month={current.month}
        initial={hourRows.map(s => s.date + '|' + s.hour)}
        saleDays={Object.fromEntries(saleDays.map(s => [s.day, s.name]))}
        editable={current.availability_open}
        submittedAt={sub ? new Date(sub.submitted_at).toISOString() : null}
      />
    );
  }

  return (
    <AppShell user={user} links={[{ href: '/host', label: 'My schedule', icon: 'calendar' }]}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <TypedGreeting data-tour="title" text={`Hi ${(host?.name || user.name || '').split(' ')[0] || 'there'}!`} />
            <p className="muted" style={{ marginBottom: 0 }}>
              <strong>1.</strong> Open <em>My availability</em>, tap every hour you can stream, press <em>Save availability</em>.{' '}
              <strong>2.</strong> The ops team builds the schedule.{' '}
              <strong>3.</strong> Your streams appear under <em>My schedule</em>, marked Confirmed once they&rsquo;re locked in.{' '}
              <strong>4.</strong> See what you&rsquo;ve earned under <em>My earnings</em>.
            </p>
          </div>
        </div>
        {tab !== 'earnings' && <div className="month-pills" role="tablist" aria-label="Month">
          {earlier.length > 0 && (
            <div className="past-months" aria-label="Earlier months">
              <span className="small muted">Earlier</span>
              {earlier.map(m => (
                <Link key={m.id} href={link({ m: m.id })} className={'past' + (m.id === current.id ? ' on' : '')} role="tab" aria-selected={m.id === current.id}
                  title={monthLabel(m.year, m.month)}>{monthLabel(m.year, m.month).slice(0, 3)}</Link>
              ))}
            </div>
          )}
          {months.filter(m => !earlier.some(e => e.id === m.id)).map(m => (
            <Link key={m.id} href={link({ m: m.id })} className={m.id === current.id ? 'on' : ''} role="tab" aria-selected={m.id === current.id}>
              {monthLabel(m.year, m.month)}
              <span className="small">
                {m.id === thisMonth.id ? 'this month' : m.id === nextMonth.id ? 'next month' : ''}
                {m.published_run_id ? ' · schedule out' : m.availability_open ? ' · availability open' : ''}
              </span>
            </Link>
          ))}
        </div>}
        <div className="tabs" data-tour="host-tabs">
          <Link className={tab === 'schedule' ? 'on' : ''} href={link({ tab: 'schedule' })}>My schedule</Link>
          <Link className={tab === 'availability' ? 'on' : ''} href={link({ tab: 'availability' })}>
            My availability {current.availability_open ? '' : '(locked)'}
          </Link>
          <Link className={tab === 'earnings' ? 'on' : ''} href={link({ tab: 'earnings' })}>My earnings</Link>
        </div>
        {content}
    </AppShell>
  );
}

const STATE: Record<HostStream['state'], { label: string; cls: string; tip: string }> = {
  paid: { label: 'Paid', cls: 'ok', tip: 'Paid to you.' },
  due: { label: 'To be paid', cls: 'accent', tip: 'Worked out, not paid yet.' },
  pending: { label: 'Sales not in yet', cls: '', tip: 'The ops team hasn\u2019t entered this stream\u2019s sales yet, so the fee isn\u2019t worked out.' },
  none: { label: 'No fee', cls: '', tip: 'There\u2019s no talent fee for this stream (for example a creator-account deal).' },
  upcoming: { label: 'Upcoming', cls: '', tip: 'This stream hasn\u2019t happened yet.' },
};

function EarningsView({ streams, year, years, sp }: { streams: HostStream[]; year: number; years: number[]; sp: { em?: string; eb?: string } }) {
  const q = (o: { y?: number; em?: string | null; eb?: string | null }) => {
    const p = new URLSearchParams({ tab: 'earnings' });
    const y = o.y ?? year; if (y) p.set('y', String(y));
    const em = o.em === undefined ? sp.em : o.em; if (em) p.set('em', em);
    const eb = o.eb === undefined ? sp.eb : o.eb; if (eb) p.set('eb', eb);
    return '/host?' + p.toString();
  };
  const sum = (list: HostStream[]) => list.reduce((a, s) => {
    a.n++; a.hours += s.hours; a.gmv += s.gmv ?? 0; a.fee += s.fee ?? 0;
    if (s.state === 'paid') a.paid += s.fee ?? 0;
    if (s.state === 'due') a.due += s.fee ?? 0;
    if (s.state === 'pending') a.pending++;
    return a;
  }, { n: 0, hours: 0, gmv: 0, fee: 0, paid: 0, due: 0, pending: 0 });
  const done = streams.filter(s => s.state !== 'upcoming');
  const tot = sum(done);
  const r1 = (x: number) => Math.round(x * 10) / 10;

  const byMonth = new Map<number, HostStream[]>(), byBrand = new Map<string, HostStream[]>();
  done.forEach(s => { byMonth.set(s.month, [...(byMonth.get(s.month) || []), s]); byBrand.set(s.brand, [...(byBrand.get(s.brand) || []), s]); });
  const maxMonth = Math.max(1, ...[...byMonth.values()].map(l => sum(l).fee));
  const brandRows = [...byBrand].map(([b, l]) => [b, sum(l)] as const).sort((a, b) => b[1].fee - a[1].fee);
  const maxBrand = Math.max(1, ...brandRows.map(([, a]) => a.fee));

  const listed = streams.filter(s => (!sp.em || String(s.month) === sp.em) && (!sp.eb || s.brand === sp.eb));
  const upcoming = streams.filter(s => s.state === 'upcoming').length;

  if (!streams.length) {
    return <div className="card"><p style={{ margin: 0 }}>No streams with earnings yet for {year}. They&rsquo;ll show here once your streams are on a published schedule.</p></div>;
  }
  return (
    <>
      <div className="earn-head" data-tour="host-earnings">
        <p className="muted" style={{ margin: 0 }}>Your talent fees for {year}: what you&rsquo;ve earned on each livestream, by brand and by month. Shared streams show your half.</p>
        {years.length > 1 && (
          <div className="seg" role="tablist" aria-label="Year">
            {years.map(y => <Link key={y} href={q({ y, em: null, eb: null })} className={y === year ? 'on' : ''}>{y}</Link>)}
          </div>
        )}
      </div>
      <div className="kpis">
        <div className="kpi"><div className="lab">Earned in {year}</div><div className="v ok">{money(tot.fee)}</div><div className="s">{tot.n} streams &middot; {r1(tot.hours)} h</div></div>
        <div className="kpi"><div className="lab">Paid to you</div><div className="v">{money(tot.paid)}</div><div className="s">&nbsp;</div></div>
        <div className="kpi" data-tip={'To be paid:\nFees worked out but not paid yet.'}><div className="lab">To be paid</div><div className="v">{money(tot.due)}</div><div className="s">{tot.pending ? `+ ${tot.pending} stream${tot.pending === 1 ? '' : 's'} with sales not in yet` : '\u00a0'}</div></div>
        <div className="kpi"><div className="lab">Average per stream</div><div className="v">{money(tot.n - tot.pending ? tot.fee / (tot.n - tot.pending) : 0)}</div><div className="s">{money(tot.hours ? tot.fee / tot.hours : 0)} per hour</div></div>
        <div className="kpi" data-tip={'GMV generated:\nTotal sales on your streams (a shared stream\u2019s full GMV).'}><div className="lab">GMV generated</div><div className="v">{money(tot.gmv)}</div><div className="s">across {byBrand.size} brand{byBrand.size === 1 ? '' : 's'}</div></div>
        <div className="kpi"><div className="lab">Upcoming</div><div className="v">{upcoming}</div><div className="s">stream{upcoming === 1 ? '' : 's'} scheduled</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>By month</h2>
          <table className="compact earn-table">
            <thead><tr><th>Month</th><th className="num">Streams</th><th className="num">Hours</th><th className="num">Earned</th><th className="bar-col"></th></tr></thead>
            <tbody>
              {[...byMonth].sort((a, b) => a[0] - b[0]).map(([mo, l]) => { const a = sum(l); return (
                <tr key={mo} className={sp.em === String(mo) ? 'sel' : ''}>
                  <td><Link href={q({ em: sp.em === String(mo) ? null : String(mo) })}>{MONTH_NAMES[mo]}</Link></td>
                  <td className="num">{a.n}</td><td className="num">{r1(a.hours)}</td><td className="num"><strong>{money(a.fee)}</strong></td>
                  <td className="bar-col"><div className="bar"><span style={{ width: (a.fee / maxMonth * 100) + '%' }} /></div></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>By brand</h2>
          <table className="compact earn-table">
            <thead><tr><th>Brand</th><th className="num">Streams</th><th className="num">GMV</th><th className="num">Earned</th><th className="bar-col"></th></tr></thead>
            <tbody>
              {brandRows.map(([b, a]) => (
                <tr key={b} className={sp.eb === b ? 'sel' : ''}>
                  <td><Link href={q({ eb: sp.eb === b ? null : b })}>{b}</Link></td>
                  <td className="num">{a.n}</td><td className="num">{money(a.gmv)}</td><td className="num"><strong>{money(a.fee)}</strong></td>
                  <td className="bar-col"><div className="bar"><span style={{ width: (a.fee / maxBrand * 100) + '%' }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="host-sched-head">
          <h2 style={{ margin: 0 }}>Every livestream{sp.em ? ` in ${MONTH_NAMES[Number(sp.em)]}` : ''}{sp.eb ? ` for ${sp.eb}` : ''}</h2>
          {(sp.em || sp.eb) && <Link href={q({ em: null, eb: null })} className="btn">Show all</Link>}
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>Click a month or brand above to narrow this list.</p>
        <div className="table-wrap" style={{ marginBottom: 0 }}>
          <table className="compact one-line">
            <thead><tr><th>Date</th><th>Time</th><th>Brand</th><th>Platform</th><th className="num">TikTok GMV</th><th className="num">Shopee GMV</th><th className="num">Your earnings</th><th>Status</th></tr></thead>
            <tbody>
              {listed.map(s => { const st = STATE[s.state]; return (
                <tr key={s.key}>
                  <td>{fmtDate(s.date)}</td>
                  <td>{fmtRange(s.start_min, s.end_min)}</td>
                  <td><strong>{s.brand}</strong>{s.period === 'MEGA' && <> <span className="badge mega">Mega</span></>}{s.coHosts.length > 0 && <> <span className="badge" data-tip={`Shared with ${s.coHosts.join(', ')}: you get an equal share of the fee.`}>with {s.coHosts.join(', ')}</span></>}</td>
                  <td><PlatformTag platform={s.platform} short /></td>
                  <td className="num">{s.tiktok != null ? money(s.tiktok) : '\u2014'}</td>
                  <td className="num">{s.shopee != null ? money(s.shopee) : '\u2014'}</td>
                  <td className="num"><strong>{s.fee != null ? money(s.fee) : '\u2014'}</strong></td>
                  <td><span className={'badge ' + st.cls} data-tip={st.tip}>{st.label}</span></td>
                </tr>); })}
              {!listed.length && <tr><td colSpan={8} className="muted">No streams here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
