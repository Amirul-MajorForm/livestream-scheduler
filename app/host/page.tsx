import Link from 'next/link';
import { requireHost } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { monthLabel, monthRange } from '@/lib/data';
import TopBar from '@/components/TopBar';
import AvailabilityGrid from '@/components/AvailabilityGrid';
import StreamList, { type StreamRow } from '@/components/StreamList';

export const dynamic = 'force-dynamic';

export default async function HostHome({ searchParams }: { searchParams: Promise<{ m?: string; tab?: string }> }) {
  const user = await requireHost();
  const sp = await searchParams;
  const host = await one('SELECT * FROM hosts WHERE id = $1', [user.hostId]);
  // Months a host can see: open for availability, or with a published schedule.
  const months = await query(
    'SELECT * FROM months WHERE availability_open OR published_run_id IS NOT NULL ORDER BY year DESC, month DESC LIMIT 12');
  const current = months.find(m => String(m.id) === sp.m) || months[0];
  const tab = sp.tab === 'availability' ? 'availability' : 'schedule';

  let content: React.ReactNode = <div className="card muted">No months are open yet. The ops team will let you know when to add your availability.</div>;
  if (current) {
    const { start, end } = monthRange(current.year, current.month);
    if (tab === 'schedule') {
      const streams = current.published_run_id
        ? await query<StreamRow>(
          `SELECT id, date, start_min, end_min, host_name, brand, period, sale, platform, room
           FROM scheduled_streams WHERE run_id = $1 AND host_id = $2 ORDER BY date, start_min`, [current.published_run_id, user.hostId])
        : [];
      content = current.published_run_id ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your streams in {monthLabel(current.year, current.month)}</h2>
          <p className="muted">{streams.length} stream{streams.length === 1 ? '' : 's'} scheduled.</p>
          <StreamList streams={streams} />
        </div>
      ) : (
        <div className="card">
          <p>The schedule for {monthLabel(current.year, current.month)} hasn&rsquo;t been published yet.</p>
          {current.availability_open && <p><Link href={`/host?m=${current.id}&tab=availability`}>Add or update your availability</Link> so you can be scheduled.</p>}
        </div>
      );
    } else {
      const [slots, saleDays, sub] = await Promise.all([
        query('SELECT date, slot FROM availability WHERE host_id = $1 AND date BETWEEN $2 AND $3', [user.hostId, start, end]),
        query('SELECT name, day FROM sale_days WHERE month_id = $1', [current.id]),
        one('SELECT submitted_at FROM availability_submissions WHERE host_id = $1 AND month_id = $2', [user.hostId, current.id]),
      ]);
      content = (
        <AvailabilityGrid
          hostId={user.hostId} monthId={current.id} year={current.year} month={current.month}
          initial={slots.map(s => s.date + '|' + s.slot)}
          saleDays={Object.fromEntries(saleDays.map(s => [s.day, s.name]))}
          editable={current.availability_open}
          submittedAt={sub ? new Date(sub.submitted_at).toISOString() : null}
        />
      );
    }
  }

  return (
    <>
      <TopBar user={user} links={[{ href: '/host', label: 'My schedule' }]} />
      <main>
        <div className="page-head">
          <div>
            <h1>Hi {host?.name || user.name}</h1>
            <p className="muted">Mark when you can stream, then check back here for your schedule once it&rsquo;s published.</p>
          </div>
          {months.length > 1 && (
            <form className="inline">
              <input type="hidden" name="tab" value={tab} />
              <select name="m" defaultValue={current?.id}>
                {months.map(m => <option key={m.id} value={m.id}>{monthLabel(m.year, m.month)}</option>)}
              </select>
              <button type="submit">Go</button>
            </form>
          )}
        </div>
        {current && (
          <div className="tabs">
            <Link className={tab === 'schedule' ? 'on' : ''} href={`/host?m=${current.id}`}>My schedule</Link>
            <Link className={tab === 'availability' ? 'on' : ''} href={`/host?m=${current.id}&tab=availability`}>
              My availability {current.availability_open ? '' : '(locked)'}
            </Link>
          </div>
        )}
        {content}
      </main>
    </>
  );
}
