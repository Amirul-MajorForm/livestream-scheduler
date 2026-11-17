import Link from 'next/link';
import { query } from '@/lib/db';
import { monthLabel } from '@/lib/data';
import Flash from '@/components/Flash';
import { createMonth } from './actions';

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
          <h1>Months</h1>
          <p className="muted">Each month has its own sale dates, commitments, pre-planned streams and schedule versions.</p>
        </div>
      </div>
      <Flash sp={sp} />
      <div className="table-wrap">
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
      <div className="card">
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
