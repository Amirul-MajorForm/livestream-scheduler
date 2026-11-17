import Link from 'next/link';
import { query } from '@/lib/db';
import { pct } from '@/lib/format';
import Flash from '@/components/Flash';
import { createHost } from '../actions';

export default async function HostsPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  const [hosts, brands, prefs, users] = await Promise.all([
    query('SELECT * FROM hosts ORDER BY active DESC, sort_order, name'),
    query('SELECT id, name FROM brands ORDER BY sort_order, name'),
    query('SELECT host_id, brand_id, level FROM host_brand_prefs'),
    query("SELECT host_id, email FROM users WHERE role = 'host'"),
  ]);
  const pref = new Map(prefs.map(p => [p.host_id + '|' + p.brand_id, p.level]));
  const login = new Map(users.map(u => [u.host_id, u.email]));
  const missing = (h: any) => h.active && (h.max_streams_month == null || !h.max_brand_pct || !h.platforms);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hosts</h1>
          <p className="muted">Caps, platforms, rooms and which brands each host can stream. P = Preferred, R = Regular, blank = Excluded.</p>
        </div>
        <form action={createHost} className="inline">
          <input name="name" placeholder="New host name" required />
          <button className="primary" type="submit">Add host</button>
        </form>
      </div>
      <Flash sp={sp} />
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Host</th><th>Login</th><th className="num">Max / month</th><th className="num">Max % per brand</th><th>Platforms</th>
              {brands.map(b => <th key={b.id} style={{ textAlign: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 110 }}>{b.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {hosts.map(h => (
              <tr key={h.id} style={h.active ? undefined : { opacity: 0.5 }}>
                <td className="h">
                  <Link href={`/admin/hosts/${h.id}`}><strong>{h.name}</strong></Link>
                  {!h.active && <span className="badge"> inactive</span>}
                  {missing(h) && <span className="badge bad"> needs setup</span>}
                </td>
                <td className="h small">{login.get(h.id) ?? <span className="muted">none</span>}</td>
                <td className="num">{h.max_streams_month ?? '–'}</td>
                <td className="num">{pct(h.max_brand_pct) || '–'}</td>
                <td className="h small">{h.platforms}</td>
                {brands.map(b => {
                  const lv = pref.get(h.id + '|' + b.id);
                  return <td key={b.id} className={lv === 'preferred' ? 'heat3' : lv === 'regular' ? 'heat1' : 'heat0'}>{lv === 'preferred' ? 'P' : lv === 'regular' ? 'R' : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
