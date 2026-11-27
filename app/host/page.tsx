import Link from 'next/link';
import { requireHost } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange, ensureMonth, todayYearMonth, type MonthRow } from '@/lib/data';
import TopBar from '@/components/TopBar';
import AvailabilityGrid from '@/components/AvailabilityGrid';
import StreamList, { type StreamRow } from '@/components/StreamList';
import MonthCalendar from '@/components/MonthCalendar';
import PlatformTag from '@/components/PlatformTag';
import { brandColors } from '@/lib/colors';

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
  const months = [thisMonth, nextMonth, monthAfter, ...later];

  const tab = sp.tab === 'availability' ? 'availability' : 'schedule';
  // Default: the schedule tab opens on the nearest month that has a schedule out (this month if it
  // has one, else the next one that does); the availability tab opens on next month.
  const current = months.find(m => String(m.id) === sp.m)
    || (tab === 'availability'
      ? (nextMonth.availability_open ? nextMonth : thisMonth)
      : (months.find(m => m.published_run_id) || thisMonth));
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
    const [sales, brandRows] = await Promise.all([
      query('SELECT name, day FROM sale_days WHERE month_id = $1', [current.id]),
      query('SELECT name FROM brands ORDER BY sort_order, name'),
    ]);
    const colors = brandColors(brandRows.map(b => b.name));
    const streams = current.published_run_id
      ? await query<StreamRow>(
        `SELECT id, date, start_min, end_min, host_name, brand, period, sale, platform, room, status
         FROM scheduled_streams WHERE run_id = $1 AND host_id = $2 ORDER BY date, start_min`, [current.published_run_id, user.hostId])
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
    <>
      <TopBar user={user} links={[{ href: '/host', label: 'My schedule' }]} />
      <main>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <h1 data-tour="title">Hi {host?.name || user.name}</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              <strong>1.</strong> Open <em>My availability</em>, tap every hour you can stream, press <em>Save availability</em>.{' '}
              <strong>2.</strong> The ops team builds the schedule.{' '}
              <strong>3.</strong> Your streams appear under <em>My schedule</em>, marked Confirmed once they&rsquo;re locked in.
            </p>
          </div>
        </div>
        <div className="month-pills" role="tablist" aria-label="Month">
          {months.map(m => (
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
      </main>
    </>
  );
}
