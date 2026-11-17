import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, one } from '@/lib/db';
import { pct } from '@/lib/format';
import { parsePlatforms } from '@/lib/scheduler';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import { updateHost, setHostLogin, removeHostLogin, deleteHost } from '../../actions';

export default async function HostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const h = await one('SELECT * FROM hosts WHERE id = $1', [Number(id)]);
  if (!h) notFound();
  const [brands, prefs, rooms, login] = await Promise.all([
    query('SELECT id, name FROM brands ORDER BY sort_order, name'),
    query('SELECT brand_id, level FROM host_brand_prefs WHERE host_id = $1', [h.id]),
    query('SELECT name FROM rooms ORDER BY sort_order, id'),
    one("SELECT email FROM users WHERE host_id = $1", [h.id]),
  ]);
  const pref = new Map(prefs.map(p => [p.brand_id, p.level]));
  const platforms = parsePlatforms(h.platforms) || new Set<string>();
  const allowed: string[] | null = h.allowed_rooms;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link href="/admin/hosts">Hosts</Link> /</div>
          <h1>{h.name}</h1>
        </div>
      </div>
      <Flash sp={sp} />
      <form action={updateHost}>
        <input type="hidden" name="hostId" value={h.id} />
        <div className="grid2">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Profile &amp; limits</h2>
            <div className="form-row">
              <label className="field">Name<input name="name" defaultValue={h.name} required /></label>
              <label className="field">Gender
                <select name="gender" defaultValue={h.gender}>
                  <option value="">Not set</option><option>Female</option><option>Male</option>
                </select>
              </label>
            </div>
            <div className="form-row" style={{ marginTop: 10 }}>
              <label className="field">Max streams per month<input name="max_streams_month" type="number" min={0} defaultValue={h.max_streams_month ?? ''} required /></label>
              <label className="field">Max % of a brand&rsquo;s sessions<input name="max_brand_pct" defaultValue={pct(h.max_brand_pct)} placeholder="40%" required /></label>
            </div>
            <p className="small muted">
              Max % caps how many of one brand&rsquo;s monthly sessions this host can take (e.g. 40% of 22 Blackmores sessions = up to 9).
              Female hosts are steered away from being the only stream in a late slot (6PM onward) where possible.
            </p>
            <h3>Platforms</h3>
            <div className="inline" style={{ gap: 16 }}>
              <label className="inline"><input type="checkbox" name="platforms" value="TikTok" defaultChecked={platforms.has('tiktok')} /> TikTok</label>
              <label className="inline"><input type="checkbox" name="platforms" value="Shopee" defaultChecked={platforms.has('shopee')} /> Shopee</label>
            </div>
            <h3>Rooms this host can use</h3>
            <div className="inline" style={{ gap: 16, flexWrap: 'wrap' }}>
              {rooms.map(r => (
                <label key={r.name} className="inline">
                  <input type="checkbox" name="rooms" value={r.name}
                    defaultChecked={!allowed || allowed.some(a => a.toLowerCase() === r.name.toLowerCase())} /> {r.name}
                </label>
              ))}
            </div>
            <h3>Status</h3>
            <label className="inline"><input type="checkbox" name="active" defaultChecked={h.active} /> Active (included when scheduling)</label>
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Brands</h2>
            <p className="small muted">Excluded brands are never scheduled with this host. Preferred hosts are favoured over Regular ones.</p>
            <table>
              <tbody>
                {brands.map(b => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>
                      <select name={'pref_' + b.id} defaultValue={pref.get(b.id) || 'excluded'} aria-label={b.name}>
                        <option value="preferred">Preferred</option>
                        <option value="regular">Regular</option>
                        <option value="excluded">Excluded</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <button className="primary" type="submit">Save host</button>
      </form>

      <div className="grid2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Login</h2>
          <p className="small muted">The host signs in with this email to enter availability and see their schedule.</p>
          <form action={setHostLogin} className="form-row">
            <input type="hidden" name="hostId" value={h.id} />
            <label className="field">Email<input name="email" type="email" defaultValue={login?.email ?? ''} required /></label>
            <label className="field">{login ? 'New password (leave blank to keep)' : 'Password'}<input name="password" type="text" minLength={8} autoComplete="off" /></label>
            <div><button type="submit">{login ? 'Update login' : 'Create login'}</button></div>
          </form>
          {login && (
            <form action={removeHostLogin} style={{ marginTop: 10 }}>
              <input type="hidden" name="hostId" value={h.id} />
              <ConfirmButton className="link danger" message="Remove this host's login?">Remove login</ConfirmButton>
            </form>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Delete host</h2>
          <p className="small muted">Prefer unticking Active: deleting also removes their availability and brand settings. Past schedule versions keep their name.</p>
          <form action={deleteHost}>
            <input type="hidden" name="hostId" value={h.id} />
            <ConfirmButton className="danger" message={`Permanently delete ${h.name}?`}>Delete {h.name}</ConfirmButton>
          </form>
        </div>
      </div>
    </>
  );
}
