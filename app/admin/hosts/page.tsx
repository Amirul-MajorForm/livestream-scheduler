import { query } from '@/lib/db';
import { pct } from '@/lib/format';
import Flash from '@/components/Flash';
import HostMatrix from '@/components/HostMatrix';
import { readSort, sortRows } from '@/components/SortHeader';
import { createHost } from '../actions';

export default async function HostsPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string; sort?: string; dir?: string }> }) {
  const sp = await searchParams;
  const [hostRows, brands, prefs, users] = await Promise.all([
    query('SELECT * FROM hosts ORDER BY active DESC, name'),
    query('SELECT id, name FROM brands ORDER BY sort_order, name'),
    query('SELECT host_id, brand_id, level FROM host_brand_prefs'),
    query("SELECT host_id, email FROM users WHERE role = 'host'"),
  ]);
  const login = new Map(users.map(u => [u.host_id, u.email]));
  const { sort, dir } = readSort(sp, ['host', 'status', 'login', 'max', 'pct'], 'host');
  const keyFn: Record<string, (h: any) => string | number> = {
    host: h => (h.active ? '0' : '1') + h.name.toLowerCase(),
    status: h => (h.active ? '0' : '1') + h.name.toLowerCase(),
    login: h => login.get(h.id) ?? '',
    max: h => h.max_streams_month ?? -1, pct: h => h.max_brand_pct ?? -1,
  };
  const hosts = sortRows(hostRows, keyFn[sort], dir);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hosts</h1>
          <p className="muted">
            Change a brand cell to <strong>P</strong> (Preferred), <strong>R</strong> (Regular) or <strong>&ndash;</strong> (Excluded, never scheduled),
            or a host&rsquo;s <strong>Status</strong>: changes save straight away. Click a name for caps, platforms, rooms and login.
          </p>
        </div>
        <form action={createHost} className="inline">
          <input name="name" placeholder="New host name" required />
          <button className="primary" type="submit">Add host</button>
        </form>
      </div>
      <Flash sp={sp} />
      <HostMatrix
        sort={sort} dir={dir}
        brands={brands.map(b => ({ id: b.id, name: b.name }))}
        prefs={Object.fromEntries(prefs.map(p => [p.host_id + '|' + p.brand_id, p.level]))}
        hosts={hosts.map(h => ({
          id: h.id, name: h.name, active: h.active, login: login.get(h.id) ?? null,
          maxStreams: h.max_streams_month, maxBrandPct: pct(h.max_brand_pct), platforms: h.platforms,
          needsSetup: h.max_streams_month == null || !h.max_brand_pct || !h.platforms,
        }))}
      />
    </>
  );
}
