import Link from 'next/link';
import PlatformTag from './PlatformTag';
import BrandPill from './BrandPill';
import { money } from '@/lib/earnings';
import { fmtDate, fmtRange, MONTH_NAMES } from '@/lib/format';
import type { HostStream } from '@/lib/hostEarnings';
import { HOST_STATE } from '@/lib/hostState';


export default function EarningsView({ streams, year, years, sp, colors = {} }: { streams: HostStream[]; year: number; years: number[]; sp: { em?: string; eb?: string }; colors?: Record<string, string> }) {
  const q = (o: { y?: number; em?: string | null; eb?: string | null }) => {
    const p = new URLSearchParams();
    const y = o.y ?? year; if (y) p.set('y', String(y));
    const em = o.em === undefined ? sp.em : o.em; if (em) p.set('em', em);
    const eb = o.eb === undefined ? sp.eb : o.eb; if (eb) p.set('eb', eb);
    const qs = p.toString();
    return '/host/earnings' + (qs ? '?' + qs : '');
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
                  <td><Link href={q({ eb: sp.eb === b ? null : b })}><BrandPill brand={b} color={colors[b]} /></Link></td>
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
              {listed.map(s => { const st = HOST_STATE[s.state]; return (
                <tr key={s.key}>
                  <td>{fmtDate(s.date)}</td>
                  <td>{fmtRange(s.start_min, s.end_min)}</td>
                  <td><BrandPill brand={s.brand} color={colors[s.brand]} />{s.period === 'MEGA' && <> <span className="badge mega">Mega</span></>}{s.coHosts.length > 0 && <> <span className="badge" data-tip={`Shared with ${s.coHosts.join(', ')}: you get an equal share of the fee.`}>with {s.coHosts.join(', ')}</span></>}</td>
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
