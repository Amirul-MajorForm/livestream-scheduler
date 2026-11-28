import Link from 'next/link';
import { loadAnalysis, analysisYears, emptyTotals, addTo, type AStream, type Totals } from '@/lib/analysis';
import { loadBrandColors } from '@/lib/brandPalette';
import { todayYearMonth } from '@/lib/data';
import { money } from '@/lib/earnings';
import { fmtDate, fmtRange, MONTH_NAMES } from '@/lib/format';
import SortTable from '@/components/SortTable';
import BrandPill from '@/components/BrandPill';
import BarChart from '@/components/BarChart';
import PlatformTag from '@/components/PlatformTag';

export const dynamic = 'force-dynamic';

type SP = { y?: string; mf?: string; mt?: string; b?: string; h?: string; p?: string; mx?: string };
const PLATFORM_LABEL = { tiktok: 'TikTok only', shopee: 'Shopee only', both: 'TikTok & Shopee' } as const;
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number) => (b ? `${r1((a / b) * 100)}%` : '—');

/**
 * Earnings and sales across every month, brand and host: who earns most, which brands sell,
 * how platforms compare. Shared streams count in full for each host's streams and hours, while
 * their GMV and fees are split equally between the hosts.
 */
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = todayYearMonth();
  const years = await analysisYears();
  const yearSel = sp.y === 'all' ? 'all' : (years.includes(Number(sp.y)) ? Number(sp.y) : (years.includes(now.year) ? now.year : years[0]));
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const all = await loadAnalysis(yearSel === 'all' ? years : yearSel != null ? [yearSel] : [], today);

  const mf = sp.mf ? Number(sp.mf) : null, mt = sp.mt ? Number(sp.mt) : null;
  const metric = sp.mx === 'fee' || sp.mx === 'streams' ? sp.mx : 'gmv';
  const list = all.filter(s =>
    (mf == null || s.month >= mf) && (mt == null || s.month <= mt)
    && (!sp.b || s.brand === sp.b) && (!sp.h || s.hosts.includes(sp.h)) && (!sp.p || s.platform === sp.p));
  const colors = await loadBrandColors(all.map(s => s.brand));
  const allBrands = [...new Set(all.map(s => s.brand))].sort();
  const allHosts = [...new Set(all.flatMap(s => s.hosts))].sort();

  // ---- aggregate ----
  const tot = emptyTotals();
  const byHost = new Map<string, Totals & { brands: Map<string, number>; shared: number }>();
  const byBrand = new Map<string, Totals & { hosts: Map<string, number> }>();
  const byMonth = new Map<string, Totals & { year: number; month: number; brands: Map<string, number> }>();
  const byPlatform = new Map<string, Totals>();
  const cell = new Map<string, Totals>(); // host|brand
  for (const s of list) {
    addTo(tot, s);
    const share = 1 / Math.max(1, s.hosts.length);
    for (const h of s.hosts.length ? s.hosts : ['No host']) {
      const a = byHost.get(h) || { ...emptyTotals(), brands: new Map(), shared: 0 };
      addTo(a, s, share); if (share < 1) a.shared++;
      a.brands.set(s.brand, (a.brands.get(s.brand) || 0) + s.fee * share);
      byHost.set(h, a);
      const c = cell.get(h + '|' + s.brand) || emptyTotals(); addTo(c, s, share); cell.set(h + '|' + s.brand, c);
    }
    const b = byBrand.get(s.brand) || { ...emptyTotals(), hosts: new Map() };
    addTo(b, s);
    s.hosts.forEach(h => b.hosts.set(h, (b.hosts.get(h) || 0) + s.gmv * share));
    byBrand.set(s.brand, b);
    const mk = `${s.year}-${String(s.month).padStart(2, '0')}`;
    const m = byMonth.get(mk) || { ...emptyTotals(), year: s.year, month: s.month, brands: new Map() };
    addTo(m, s); m.brands.set(s.brand, (m.brands.get(s.brand) || 0) + s.gmv); byMonth.set(mk, m);
    const p = byPlatform.get(s.platform) || emptyTotals(); addTo(p, s); byPlatform.set(s.platform, p);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const months = [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  const monthLabel = (m: { year: number; month: number }) => MONTH_NAMES[m.month].slice(0, 3) + (yearSel === 'all' ? ` ${String(m.year).slice(2)}` : '');
  const hostRows = [...byHost].sort((a, b) => b[1].fee - a[1].fee);
  const brandRows = [...byBrand].sort((a, b) => b[1].gmv - a[1].gmv);
  const topStreams = [...list].filter(s => s.entered).sort((a, b) => b.gmv - a.gmv).slice(0, 10);
  const gph = (t: Totals) => (t.hours ? t.gmv / t.hours : 0);

  // Host x brand matrix (top hosts and brands by the chosen measure).
  const mval = (t?: Totals) => !t ? 0 : metric === 'fee' ? t.fee : metric === 'streams' ? t.streams : t.gmv;
  const mfmt = (v: number) => metric === 'streams' ? String(v) : money(v);
  const mHosts = hostRows.map(([h]) => h).sort((a, b) => mval(byHost.get(b)) - mval(byHost.get(a))).slice(0, 25);
  const mBrands = brandRows.map(([b]) => b).sort((a, b) => mval(byBrand.get(b)) - mval(byBrand.get(a))).slice(0, 12);
  const mMax = Math.max(1, ...mHosts.flatMap(h => mBrands.map(b => mval(cell.get(h + '|' + b)))));

  const q = (o: Partial<Record<keyof SP, string | null>>) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...o } as Record<string, string | null | undefined>;
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    const s = p.toString();
    return '/admin/analysis' + (s ? '?' + s : '');
  };
  const filtered = !!(sp.mf || sp.mt || sp.b || sp.h || sp.p);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analysis</h1>
          <p className="muted" style={{ margin: 0 }}>Sales and talent fees across months, brands and hosts. Streams that haven&rsquo;t happened yet are left out.</p>
        </div>
      </div>

      <form className="sales-filters" action="/admin/analysis">
        <select name="y" defaultValue={String(yearSel ?? '')} aria-label="Year">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
          {years.length > 1 && <option value="all">All years</option>}
        </select>
        <label className="inline small">Months
          <select name="mf" defaultValue={sp.mf || ''} aria-label="From month"><option value="">Jan</option>{MONTH_NAMES.map((n, i) => <option key={i} value={i}>{n.slice(0, 3)}</option>)}</select>
          to
          <select name="mt" defaultValue={sp.mt || ''} aria-label="To month"><option value="">Dec</option>{MONTH_NAMES.map((n, i) => <option key={i} value={i}>{n.slice(0, 3)}</option>)}</select>
        </label>
        <select name="b" defaultValue={sp.b || ''} aria-label="Brand"><option value="">All brands</option>{allBrands.map(b => <option key={b}>{b}</option>)}</select>
        <select name="h" defaultValue={sp.h || ''} aria-label="Host"><option value="">All hosts</option>{allHosts.map(h => <option key={h}>{h}</option>)}</select>
        <select name="p" defaultValue={sp.p || ''} aria-label="Platform"><option value="">All platforms</option><option value="tiktok">TikTok only</option><option value="shopee">Shopee only</option><option value="both">TikTok &amp; Shopee</option></select>
        {sp.mx && <input type="hidden" name="mx" value={sp.mx} />}
        <button type="submit" className="primary">Apply</button>
        {filtered && <Link href={q({ mf: null, mt: null, b: null, h: null, p: null })} className="small">Clear filters</Link>}
      </form>

      {!list.length ? <div className="card"><p style={{ margin: 0 }}>No streams match. Import or publish schedules, or widen the filters.</p></div> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="lab">Total GMV</div><div className="v">{money(tot.gmv)}</div><div className="s">TikTok {money(tot.tt)} &middot; Shopee {money(tot.sp)}</div></div>
            <div className="kpi"><div className="lab">Talent fees</div><div className="v ok">{money(tot.fee)}</div><div className="s">{pct(tot.fee, tot.gmv)} of GMV</div></div>
            <div className="kpi" data-tip={'Paid to hosts:\nFees on streams marked Paid (or Paid to Host, Pending Payment From Brand).'}><div className="lab">Paid to hosts</div><div className="v">{money(tot.paid)}</div><div className="s">{money(tot.fee - tot.paid)} still to pay</div></div>
            <div className="kpi"><div className="lab">Streams</div><div className="v">{tot.streams}</div><div className="s">{r1(tot.hours)} hours &middot; {tot.entered} with sales</div></div>
            <div className="kpi"><div className="lab">GMV per hour</div><div className="v">{money(gph(tot))}</div><div className="s">{money(tot.streams ? tot.gmv / tot.streams : 0)} per stream</div></div>
            <div className="kpi"><div className="lab">Hosts &middot; brands</div><div className="v">{byHost.size} &middot; {byBrand.size}</div><div className="s">top host: {hostRows[0]?.[0] ?? '—'}</div></div>
          </div>

          <div className="grid2">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>GMV by month</h2>
              <BarChart label="GMV by month, TikTok and Shopee"
                series={[{ name: 'TikTok', color: 'var(--chart-tt)' }, { name: 'Shopee', color: 'var(--chart-sp)' }]}
                data={months.map(m => ({ label: monthLabel(m), values: [m.tt, m.sp],
                  tip: `${MONTH_NAMES[m.month]} ${m.year}\nTotal ${money(m.gmv)}\nTikTok ${money(m.tt)} · Shopee ${money(m.sp)}\n${m.streams} streams` }))} />
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Talent fees by month</h2>
              <BarChart label="Talent fees by month" series={[{ name: 'Talent fees', color: 'var(--chart-one)' }]}
                data={months.map(m => ({ label: monthLabel(m), values: [m.fee],
                  tip: `${MONTH_NAMES[m.month]} ${m.year}\nFees ${money(m.fee)} (${pct(m.fee, m.gmv)} of GMV)\nPaid ${money(m.paid)}` }))} />
            </div>
          </div>

          <h2>Hosts</h2>
          <p className="small muted" style={{ marginTop: -4 }}>Click a column to sort. Shared streams: GMV and fees split equally; streams and hours count in full for each host.</p>
          <div className="table-wrap">
            <SortTable initial={{ col: 5, dir: 'desc' }}
              cols={[{ label: 'Host' }, { label: 'Streams', num: true }, { label: 'Hours', num: true }, { label: 'GMV', num: true },
                { label: 'GMV / hour', num: true }, { label: 'Talent fees', num: true }, { label: 'Avg fee / stream', num: true },
                { label: 'Paid', num: true }, { label: 'Top brand (fees)' }, { label: 'Brands', num: true }]}
              rows={hostRows.map(([h, a]) => ({
                key: h,
                sort: [h, a.streams, a.hours, a.gmv, gph(a), a.fee, a.streams ? a.fee / a.streams : 0, a.paid, top(a.brands), a.brands.size],
                cells: [
                  <><Link href={q({ h })}><strong>{h}</strong></Link>{a.shared > 0 && <> <span className="badge" data-tip={`${a.shared} shared stream(s)`}>{a.shared} shared</span></>}</>,
                  a.streams, r1(a.hours), money(a.gmv), money(gph(a)), <strong key="f">{money(a.fee)}</strong>, money(a.streams ? a.fee / a.streams : 0),
                  money(a.paid), a.brands.size ? <BrandPill key="b" brand={top(a.brands)} color={colors[top(a.brands)]} /> : '—', a.brands.size,
                ],
              }))} />
          </div>

          <h2>Brands</h2>
          <div className="table-wrap">
            <SortTable initial={{ col: 5, dir: 'desc' }}
              cols={[{ label: 'Brand' }, { label: 'Streams', num: true }, { label: 'Hours', num: true }, { label: 'TikTok GMV', num: true },
                { label: 'Shopee GMV', num: true }, { label: 'Total GMV', num: true }, { label: 'GMV / hour', num: true },
                { label: 'Talent fees', num: true }, { label: 'Fees % of GMV', num: true }, { label: 'Hosts', num: true }, { label: 'Top host (GMV)' }]}
              rows={brandRows.map(([b, a]) => ({
                key: b,
                sort: [b, a.streams, a.hours, a.tt, a.sp, a.gmv, gph(a), a.fee, a.gmv ? a.fee / a.gmv : 0, a.hosts.size, top(a.hosts)],
                cells: [
                  <Link key="b" href={q({ b })}><BrandPill brand={b} color={colors[b]} /></Link>,
                  a.streams, r1(a.hours), money(a.tt), money(a.sp), <strong key="g">{money(a.gmv)}</strong>, money(gph(a)),
                  money(a.fee), pct(a.fee, a.gmv), a.hosts.size, top(a.hosts),
                ],
              }))} />
          </div>

          <h2>Months</h2>
          <div className="table-wrap">
            <SortTable initial={{ col: 0, dir: 'asc' }}
              cols={[{ label: 'Month' }, { label: 'Streams', num: true }, { label: 'Hours', num: true }, { label: 'TikTok GMV', num: true },
                { label: 'Shopee GMV', num: true }, { label: 'Total GMV', num: true }, { label: 'Talent fees', num: true }, { label: 'Paid', num: true }, { label: 'Top brand (GMV)' }]}
              rows={months.map(m => ({
                key: `${m.year}-${m.month}`,
                sort: [m.year * 12 + m.month, m.streams, m.hours, m.tt, m.sp, m.gmv, m.fee, m.paid, top(m.brands)],
                cells: [
                  <Link key="m" href={q({ y: String(m.year), mf: String(m.month), mt: String(m.month) })}>{MONTH_NAMES[m.month]} {m.year}</Link>,
                  m.streams, r1(m.hours), money(m.tt), money(m.sp), <strong key="g">{money(m.gmv)}</strong>, money(m.fee), money(m.paid),
                  <BrandPill key="b" brand={top(m.brands)} color={colors[top(m.brands)]} />,
                ],
              }))}
              foot={['Total', tot.streams, r1(tot.hours), money(tot.tt), money(tot.sp), <strong key="g">{money(tot.gmv)}</strong>, money(tot.fee), money(tot.paid), '']} />
          </div>

          <div className="grid2">
            <div>
              <h2>Platforms</h2>
              <div className="table-wrap">
                <SortTable initial={{ col: 3, dir: 'desc' }}
                  cols={[{ label: 'Platform' }, { label: 'Streams', num: true }, { label: 'Hours', num: true }, { label: 'GMV', num: true }, { label: 'GMV / hour', num: true }, { label: 'Talent fees', num: true }]}
                  rows={[...byPlatform].map(([p, a]) => ({
                    key: p, sort: [p, a.streams, a.hours, a.gmv, gph(a), a.fee],
                    cells: [PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL], a.streams, r1(a.hours), money(a.gmv), money(gph(a)), money(a.fee)],
                  }))} />
              </div>
            </div>
            <div>
              <h2>Top 10 streams by GMV</h2>
              <div className="table-wrap">
                <table className="compact one-line">
                  <thead><tr><th>Date</th><th>Host</th><th>Brand</th><th>Platform</th><th className="num">GMV</th><th className="num">Fee</th></tr></thead>
                  <tbody>
                    {topStreams.map((s, i) => (
                      <tr key={i}>
                        <td data-tip={fmtRange(s.start_min, s.end_min)}>{fmtDate(s.date)}</td>
                        <td>{s.hosts.join(', ') || '—'}</td>
                        <td><BrandPill brand={s.brand} color={colors[s.brand]} /></td>
                        <td><PlatformTag platform={s.platformText} short /></td>
                        <td className="num"><strong>{money(s.gmv)}</strong></td>
                        <td className="num">{money(s.fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="host-sched-head" style={{ marginTop: 22 }}>
            <h2 style={{ margin: 0 }}>Hosts &times; brands</h2>
            <div className="seg" role="tablist" aria-label="Measure">
              {(['gmv', 'fee', 'streams'] as const).map(k => (
                <Link key={k} href={q({ mx: k === 'gmv' ? null : k })} className={metric === k ? 'on' : ''}>{k === 'gmv' ? 'GMV' : k === 'fee' ? 'Talent fees' : 'Streams'}</Link>
              ))}
            </div>
          </div>
          <p className="small muted">Darker = more. Top {mHosts.length} hosts and {mBrands.length} brands by {metric === 'gmv' ? 'GMV' : metric === 'fee' ? 'talent fees' : 'streams'}. Hover a cell for the figures.</p>
          <div className="table-wrap">
            <table className="compact heat-matrix">
              <thead>
                <tr><th>Host</th>{mBrands.map(b => <th key={b} className="num"><BrandPill brand={b} color={colors[b]} /></th>)}<th className="num">Total</th></tr>
              </thead>
              <tbody>
                {mHosts.map(h => (
                  <tr key={h}>
                    <td><strong>{h}</strong></td>
                    {mBrands.map(b => {
                      const c = cell.get(h + '|' + b);
                      const v = mval(c);
                      const k = v / mMax;
                      return (
                        <td key={b} className={'num heat' + (k > 0.55 ? ' dark' : '')}
                          style={v ? ({ '--k': `${Math.round(8 + k * 82)}%` } as React.CSSProperties) : undefined}
                          data-tip={c ? `${h} · ${b}\nGMV ${money(c.gmv)} · fees ${money(c.fee)}\n${c.streams} streams` : undefined}>
                          {v ? mfmt(v) : ''}
                        </td>
                      );
                    })}
                    <td className="num"><strong>{mfmt(mval(byHost.get(h)))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
