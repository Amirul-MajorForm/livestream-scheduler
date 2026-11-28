import { redirect } from 'next/navigation';
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
import { tint } from '@/lib/colors';
import { loadBrandColors } from '@/lib/brandPalette';
import { loadHostMonth } from '@/lib/hostEarnings';
import { HOST_STATE } from '@/lib/hostState';
import { money } from '@/lib/earnings';
import BrandPill from '@/components/BrandPill';
import { HOST_LINKS } from '@/lib/hostNav';

export const dynamic = 'force-dynamic';

export default async function HostHome({ searchParams }: { searchParams: Promise<{ m?: string; tab?: string; view?: string }> }) {
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

  if (sp.tab === 'earnings') redirect('/host/earnings');
  const tab = sp.tab === 'availability' ? 'availability' : 'schedule';
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
    const v = o.view ?? view;
    if (t === 'schedule' && v === 'calendar') q.set('view', 'calendar');
    return '/host?' + q.toString();
  };

  const { start, end } = monthRange(current.year, current.month);
  let content: React.ReactNode;
  if (tab === 'schedule') {
    const sales = await query('SELECT name, day FROM sale_days WHERE month_id = $1', [current.id]);
    const streams = current.published_run_id
      ? await query<StreamRow>(
        `SELECT id, date, start_min, end_min, host_name, brand, period, sale, platform, room, status
         FROM scheduled_streams WHERE run_id = $1
           AND (host_id = $2 OR lower($3) = ANY(regexp_split_to_array(lower(host_name), '\\s*(,|&|/|\\+| and )\\s*')))
         ORDER BY date, start_min`, [current.published_run_id, user.hostId, host?.name || ''])
      : [];
    const hours = Math.round(streams.reduce((a, x) => a + (x.end_min - x.start_min), 0) / 6) / 10;
    // Same brand colours as everywhere else in the app; calendar tiles use a tint of each.
    const edges = await loadBrandColors(streams.map(x => x.brand));
    const colors = Object.fromEntries(Object.entries(edges).map(([b, e]) => [b, tint(e)]));
    // This month's sales and the host's share of each fee.
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const earned = host ? await loadHostMonth({ id: host.id, name: host.name }, current, today) : [];
    const earnBy = new Map(earned.filter(e => e.streamId != null).map(e => [e.streamId!, e]));
    const monthFee = earned.reduce((a, e) => a + (e.fee ?? 0), 0);
    const monthGmv = earned.reduce((a, e) => a + (e.gmv ?? 0), 0);
    const monthPaid = earned.filter(e => e.state === 'paid').reduce((a, e) => a + (e.fee ?? 0), 0);
    const withSales = earned.filter(e => e.gmv != null || e.fee != null).length;
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
            {withSales > 0 && (
              <p className="month-earn">
                Earned <strong>{money(monthFee)}</strong>
                <span className="muted"> &middot; {money(monthPaid)} paid &middot; sales (GMV) {money(monthGmv)} over {withSales} stream{withSales === 1 ? '' : 's'}</span>
              </p>
            )}
          </div>
          <div className="seg" role="tablist" aria-label="View">
            <Link href={link({ view: 'list' })} className={view === 'list' ? 'on' : ''} role="tab" aria-selected={view === 'list'}>List</Link>
            <Link href={link({ view: 'calendar' })} className={view === 'calendar' ? 'on' : ''} role="tab" aria-selected={view === 'calendar'}>Calendar</Link>
          </div>
        </div>
        {streams.length > 0 && (
          <div className="color-key" aria-label="Colour key">
            {[...new Set(streams.map(x => x.brand))].map(b => <BrandPill key={b} brand={b} color={edges[b]} />)}
            <span className="key-sep" />
            {['TikTok', 'Shopee'].filter(pl => streams.some(x => x.platform.toLowerCase().includes(pl.toLowerCase()))).map(pl => <PlatformTag key={pl} platform={pl} />)}
          </div>
        )}
        {view === 'calendar'
          ? <MonthCalendar year={current.year} month={current.month} streams={streams} showHost={false} colors={colors}
              saleDays={Object.fromEntries(sales.map(s => [s.day, s.name]))}
              extraTip={Object.fromEntries([...earnBy].map(([id, e]) => [id, e.fee != null
                ? `Your earnings ${money(e.fee)} (${HOST_STATE[e.state].label})` + (e.gmv != null ? `\nSales (GMV) ${money(e.gmv)}` : '')
                : HOST_STATE[e.state].label]))} />
          : <StreamList streams={streams} brandColors={edges} earnings={earnBy} />}
      </div>
    ) : (
      <div className="card" data-tour="host-schedule">
        <p style={{ marginTop: 0 }}>The schedule for {monthLabel(current.year, current.month)} hasn&rsquo;t been released yet. Check back later.</p>
        {current.availability_open && <p style={{ marginBottom: 0 }}><Link href={link({ tab: 'availability' })}>Add or update your availability for {monthLabel(current.year, current.month)}</Link> so you can be scheduled.</p>}
      </div>
    );
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
    <AppShell user={user} links={HOST_LINKS}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <TypedGreeting data-tour="title" text={`Hi ${(host?.name || user.name || '').split(' ')[0] || 'there'}!`} />
            <p className="muted" style={{ marginBottom: 0 }}>
              <strong>1.</strong> Open <em>My availability</em>, tap every hour you can stream, press <em>Save availability</em>.{' '}
              <strong>2.</strong> The ops team builds the schedule.{' '}
              <strong>3.</strong> Your streams appear under <em>My schedule</em>, marked Confirmed once they&rsquo;re locked in.{' '}
              <strong>4.</strong> See what you&rsquo;ve earned under <em>My earnings</em> in the menu.
            </p>
          </div>
        </div>
        <div className="month-pills" role="tablist" aria-label="Month">
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
        </div>
        <div className="tabs" data-tour="host-tabs">
          <Link className={tab === 'schedule' ? 'on' : ''} href={link({ tab: 'schedule' })}>My schedule</Link>
          <Link className={tab === 'availability' ? 'on' : ''} href={link({ tab: 'availability' })}>
            My availability {current.availability_open ? '' : '(locked)'}
          </Link>
        </div>
        {content}
    </AppShell>
  );
}
