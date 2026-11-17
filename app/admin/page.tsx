import Link from 'next/link';
import { query } from '@/lib/db';
import { monthLabel } from '@/lib/data';
import Flash from '@/components/Flash';
import { createMonth } from './actions';
import StartTourButton from '@/components/StartTourButton';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  const months = await query(`
    SELECT m.*,
      (SELECT count(*)::int FROM schedule_runs r WHERE r.month_id = m.id) AS runs,
      (SELECT coalesce(sum(qty),0)::int FROM commitments c WHERE c.month_id = m.id) AS committed,
      (SELECT count(*)::int FROM hosts h WHERE h.active AND (
         EXISTS (SELECT 1 FROM availability_submissions s WHERE s.host_id = h.id AND s.month_id = m.id)
         OR EXISTS (SELECT 1 FROM availability a WHERE a.host_id = h.id
           AND a.date >= make_date(m.year, m.month + 1, 1) AND a.date < make_date(m.year, m.month + 1, 1) + interval '1 month'))) AS submitted,
      r.stats AS published_stats
    FROM months m LEFT JOIN schedule_runs r ON r.id = m.published_run_id
    ORDER BY m.year DESC, m.month DESC`);
  const activeHosts = (await query('SELECT count(*)::int AS n FROM hosts WHERE active'))[0].n;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const defaultYm = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 data-tour="title">Months</h1>
          <p className="muted">Each month has its own sale dates, commitments, pre-planned streams and schedule versions.</p>
        </div>
      </div>
      <Flash sp={sp} />
      <Guide hasMonths={months.length > 0} />
      <div className="table-wrap" data-tour="months-table">
        <table>
          <thead>
            <tr><th>Month</th><th>Host availability</th><th className="num">Committed sessions</th><th>Schedule</th><th className="num">Versions</th></tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.id}>
                <td><Link href={`/admin/months/${m.id}`}><strong>{monthLabel(m.year, m.month)}</strong></Link></td>
                <td>
                  <span className={'badge ' + (m.availability_open ? 'ok' : '')}>{m.availability_open ? 'Open' : 'Locked'}</span>{' '}
                  <span className="small muted">{m.submitted} / {activeHosts} hosts have availability</span>
                </td>
                <td className="num">{m.committed}</td>
                <td>
                  {m.published_run_id
                    ? <><span className="badge accent">Published</span> <span className="small muted">{m.published_stats?.fulfilled} / {m.published_stats?.committed} fulfilled</span></>
                    : <span className="badge">Not published</span>}
                </td>
                <td className="num">{m.runs}</td>
              </tr>
            ))}
            {!months.length && <tr><td colSpan={5} className="muted">No months yet. Create one below, or <Link href="/admin/import">import your Google Sheet</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card" data-tour="months-new">
        <h2 style={{ marginTop: 0 }}>Start a new month</h2>
        <form action={createMonth} className="form-row">
          <label className="field">Month<input type="month" name="ym" defaultValue={defaultYm} required /></label>
          <label className="field">Copy commitments, sale days and rules from
            <select name="copyFrom" defaultValue={months[0]?.id ?? ''}>
              <option value="">Start empty</option>
              {months.map(m => <option key={m.id} value={m.id}>{monthLabel(m.year, m.month)}</option>)}
            </select>
          </label>
          <div><button className="primary" type="submit">Create month</button></div>
        </form>
      </div>
    </>
  );
}

function Guide({ hasMonths }: { hasMonths: boolean }) {
  return (
    <details className="card guide" open={!hasMonths || undefined}>
      <summary>How to use this app <span className="small muted" style={{ fontWeight: 400 }}>(click to show or hide)</span></summary>
      <p style={{ margin: '10px 0 4px' }}><StartTourButton /> <span className="small muted">Clicks you through each page and points at what to do. Or read the steps below.</span></p>
      <h3>One-time setup</h3>
      <ol>
        <li><strong>Bring in your data.</strong> Go to <Link href="/admin/import">Import</Link> and upload the Google Sheet (File &rarr; Download &rarr; .xlsx). This loads hosts, brands, rooms, commitments, pre-planned streams and availability.</li>
        <li><strong>Give every host a login.</strong> <Link href="/admin/hosts">Hosts</Link> &rarr; click a name &rarr; <em>Login</em> box &rarr; type their email and a temporary password &rarr; <em>Create login</em>. Send them the website link, email and password.</li>
      </ol>
      <h3>Every month</h3>
      <ol>
        <li><strong>Create the month.</strong> Under <em>Start a new month</em> below, pick the month, copy from last month, click <em>Create month</em>.</li>
        <li><strong>Check sale dates.</strong> Tab <em>Rules &amp; sale days</em>: make sure each Mega sale (Double digit, Mid-month, Payday, D-1 and D-Day) is on the right date.</li>
        <li><strong>Set the commitments.</strong> Tab <em>Commitments</em>: change the number of sessions for each brand and platform, then click <em>Save</em> on that row. For a new Mega commitment, tick the sales it belongs to.</li>
        <li><strong>Add confirmed bookings.</strong> Tab <em>Pre-planned streams</em>: add streams that are already agreed (date, time, brand, platform). Choose the host, or leave it on <em>Auto-assign</em> to let the app pick one.</li>
        <li><strong>Collect availability.</strong> Ask hosts to sign in, open <em>My availability</em>, tap the slots they can do and press <em>Save</em>. Tab <em>Host availability</em> shows who has done it (&ldquo;Not yet&rdquo; = chase them). You can fill it in for a host by clicking their name. When everyone is done, click <em>Lock availability</em>.</li>
        <li><strong>Make the schedule.</strong> Tab <em>Schedule</em> &rarr; <em>Run scheduler</em>. Wait a few seconds; it opens the result.</li>
        <li><strong>Check it.</strong> The top boxes show how many commitments were filled. <span className="badge bad">Red</span> and <span className="badge warn">amber</span> tags are things to check (open <em>What do the tags mean?</em> under the list). <em>Summary &amp; diagnostics</em> explains every unfilled commitment. Fix a stream with <em>Edit</em>, or change settings (e.g. raise a host&rsquo;s monthly cap) and run again. Each run is saved as a new version, so nothing is lost.</li>
        <li><strong>Confirm it.</strong> Click <em>Publish to hosts</em>. That is the confirmed schedule: hosts now see their streams under <em>My schedule</em>. Only one version per month is published at a time.</li>
      </ol>
      <div className="tip">
        <strong>Good to know:</strong> sort any list by clicking a column heading (e.g. <em>Host</em>). Switch between <em>List</em> and <em>Calendar</em> on a schedule.
        Changes to a published version show to hosts immediately, so use <em>Duplicate</em> to try changes on a draft first.
      </div>
    </details>
  );
}
