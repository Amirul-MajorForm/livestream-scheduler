import Link from 'next/link';
import { loadAnalysis, analysisYears, emptyTotals, addTo, CAMPAIGNS, type Totals, type CampaignType } from '@/lib/analysis';
import { loadBrandColors } from '@/lib/brandPalette';
import { todayYearMonth } from '@/lib/data';
import { money } from '@/lib/earnings';
import { MONTH_NAMES } from '@/lib/format';
import SortTable from '@/components/SortTable';
import BrandPill from '@/components/BrandPill';
import BarChart from '@/components/BarChart';
import PieChart from '@/components/PieChart';

export const dynamic = 'force-dynamic';

type SP = { y?: string; mf?: string; mt?: string; b?: string; h?: string; p?: string; mx?: string };
const PLATFORM_LABEL = { tiktok: 'TikTok only', shopee: 'Shopee only', both: 'TikTok & Shopee' } as const;
// Chart colours (checked for colour-blind separation and contrast in both themes).
const PLATFORM_COLOR = { tiktok: '#0891b2', shopee: '#ea580c', both: '#7c3aed' } as const;
const CAMPAIGN_COLOR: Record<CampaignType, string> = { dd: '#2563eb', mm: '#d97706', pd: '#db2777' };

/** A collapsible block of the page (open by default). */
function Section({ title, note, right, children }: { title: string; note?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="section" open>
      <summary><h2>{title}</h2>{note && <span className="small">{note}</span>}{right && <span className="section-right" onClick={undefined}>{right}</span>}</summary>
      {children}
    </details>
  );
}
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
  const gph = (t: Totals) => (t.hours ? t.gmv / t.hours : 0);
  const times = (a: number, b: number) => (b ? `${(Math.round((a / b) * 10) / 10).toFixed(1)}\u00d7` : '\u2014');

  // Mega campaigns: each sale's D-1 and D-Day, the other Mega days, and regular BAU streams for comparison.
  type Phase = { d1: Totals; dday: Totals; both: Totals };
  const phase = (): Phase => ({ d1: emptyTotals(), dday: emptyTotals(), both: emptyTotals() });
  const camp: Record<CampaignType, Phase> = { dd: phase(), mm: phase(), pd: phase() };
  const otherMega = emptyTotals(), bau = emptyTotals();
  const byCampMonth = new Map<string, { year: number; month: number; t: Record<CampaignType, Phase> }>();
  for (const s of list) {
    if (!s.mega) { addTo(bau, s); continue; }
    if (!s.campaign) { addTo(otherMega, s); continue; }
    const c = s.campaign;
    addTo(camp[c.type][c.phase], s); addTo(camp[c.type].both, s);
    const k = `${c.year}-${String(c.month).padStart(2, '0')}`;
    const e = byCampMonth.get(k) || { year: c.year, month: c.month, t: { dd: phase(), mm: phase(), pd: phase() } };
    addTo(e.t[c.type][c.phase], s); addTo(e.t[c.type].both, s);
    byCampMonth.set(k, e);
  }
  const campMonths = [...byCampMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);

  // Year on year (shown when more than one year is in view).
  const yearsIn = [...new Set(list.map(x => x.year))].sort();
  const byYear = new Map<number, Totals & { months: Set<number> }>();
  const ym = new Map<string, Totals>(); // `${month}|${year}`
  for (const x of list) {
    const y = byYear.get(x.year) || { ...emptyTotals(), months: new Set<number>() };
    addTo(y, x); y.months.add(x.month); byYear.set(x.year, y);
    const k = `${x.month}|${x.year}`; const t = ym.get(k) || emptyTotals(); addTo(t, x); ym.set(k, t);
  }
  const yoyMonths = [...new Set(list.map(x => x.month))].sort((a, b) => a - b);
  const change = (now: number, before: number) => before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : '\u2014';

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

          {yearsIn.length > 1 && (
            <Section title="Year on year" note="Each year in view, then the same months side by side. Use the month filter to compare like-for-like periods.">
              <div className="table-wrap">
                <SortTable initial={{ col: 0, dir: 'asc' }}
                  cols={[{ label: 'Year' }, { label: 'Months', num: true }, { label: 'Streams', num: true }, { label: 'Hours', num: true },
                    { label: 'TikTok GMV', num: true }, { label: 'Shopee GMV', num: true }, { label: 'Total GMV', num: true },
                    { label: 'GMV / month', num: true }, { label: 'GMV / hour', num: true }, { label: 'Talent fees', num: true }]}
                  rows={yearsIn.map(y => { const a = byYear.get(y)!; return {
                    key: String(y), sort: [y, a.months.size, a.streams, a.hours, a.tt, a.sp, a.gmv, a.gmv / a.months.size, gph(a), a.fee],
                    cells: [<Link key="y" href={q({ y: String(y) })}><strong>{y}</strong></Link>, a.months.size, a.streams, r1(a.hours), money(a.tt), money(a.sp),
                      <strong key="g">{money(a.gmv)}</strong>, money(a.gmv / a.months.size), money(gph(a)), money(a.fee)],
                  }; })} />
              </div>
              <h3>Month by month</h3>
              <div className="table-wrap scroll-y">
                <SortTable initial={{ col: 0, dir: 'asc' }}
                  cols={[{ label: 'Month' },
                    ...yearsIn.map(y => ({ label: `${y} GMV`, num: true })),
                    ...yearsIn.slice(1).map((y, i) => ({ label: `vs ${yearsIn[i]}`, num: true, tip: `GMV change from ${yearsIn[i]} to ${y}` })),
                    ...yearsIn.map(y => ({ label: `${y} fees`, num: true }))]}
                  rows={yoyMonths.map(mo => {
                    const t = (y: number) => ym.get(`${mo}|${y}`);
                    return {
                      key: String(mo),
                      sort: [mo, ...yearsIn.map(y => t(y)?.gmv ?? null),
                        ...yearsIn.slice(1).map((y, i) => { const a = t(y)?.gmv, b = t(yearsIn[i])?.gmv; return a != null && b ? (a - b) / b : null; }),
                        ...yearsIn.map(y => t(y)?.fee ?? null)],
                      cells: [MONTH_NAMES[mo],
                        ...yearsIn.map(y => t(y) ? <span key={y} data-tip={`${MONTH_NAMES[mo]} ${y}\n${t(y)!.streams} streams \u00b7 ${money(gph(t(y)!))} per hour`}>{money(t(y)!.gmv)}</span> : <span key={y} className="muted">{'\u2014'}</span>),
                        ...yearsIn.slice(1).map((y, i) => { const a = t(y), b = t(yearsIn[i]); return a && b ? <span key={'c' + y} className={a.gmv >= b.gmv ? 'up' : 'down'}>{change(a.gmv, b.gmv)}</span> : <span key={'c' + y} className="muted">{'\u2014'}</span>; }),
                        ...yearsIn.map(y => t(y) ? money(t(y)!.fee) : <span key={'f' + y} className="muted">{'\u2014'}</span>)],
                    };
                  })} />
              </div>
            </Section>
          )}

          <Section title="By month" note="GMV split by platform, and talent fees. Hover a bar for the figures.">
            <div className="grid2">
              <div className="card">
                <h3 style={{ marginTop: 0 }}>GMV by month</h3>
                <BarChart label="GMV by month, TikTok and Shopee"
                  series={[{ name: 'TikTok', color: 'var(--chart-tt)' }, { name: 'Shopee', color: 'var(--chart-sp)' }]}
                  data={months.map(m => ({ label: monthLabel(m), values: [m.tt, m.sp],
                    tip: `${MONTH_NAMES[m.month]} ${m.year}\nTotal ${money(m.gmv)}\nTikTok ${money(m.tt)} \u00b7 Shopee ${money(m.sp)}\n${m.streams} streams` }))} />
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Talent fees by month</h3>
                <BarChart label="Talent fees by month" series={[{ name: 'Talent fees', color: 'var(--chart-one)' }]}
                  data={months.map(m => ({ label: monthLabel(m), values: [m.fee],
                    tip: `${MONTH_NAMES[m.month]} ${m.year}\nFees ${money(m.fee)} (${pct(m.fee, m.gmv)} of GMV)\nPaid ${money(m.paid)}` }))} />
              </div>
            </div>
          </Section>

          <Section title="Mega campaigns" note="Mega streams on Double Digit (day = month, e.g. 11.11), Mid-Month (15th) and Payday (25th), each with its D-1. Compared with regular BAU streams.">
            <div className="grid2">
              <div className="card">
                <h3 style={{ marginTop: 0 }}>GMV by campaign, each month</h3>
                <BarChart grouped label="GMV by campaign and month"
                  series={CAMPAIGNS.map(c => ({ name: c.name, color: CAMPAIGN_COLOR[c.type] }))}
                  data={campMonths.map(cm => ({ label: monthLabel(cm), values: CAMPAIGNS.map(c => cm.t[c.type].both.gmv),
                    tip: [`${MONTH_NAMES[cm.month]} ${cm.year}`, ...CAMPAIGNS.map(c => `${c.name}: ${money(cm.t[c.type].both.gmv)} (D-1 ${money(cm.t[c.type].d1.gmv)} \u00b7 D-Day ${money(cm.t[c.type].dday.gmv)})`)].join('\n') }))} />
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>GMV per hour: D-1 vs D-Day</h3>
                <BarChart grouped label="GMV per hour, D-1 and D-Day, by campaign"
                  series={[{ name: 'D-1', color: 'var(--chart-d1)' }, { name: 'D-Day', color: 'var(--chart-dday)' }]}
                  data={[...CAMPAIGNS.map(c => ({ label: c.name, values: [gph(camp[c.type].d1), gph(camp[c.type].dday)],
                    tip: `${c.name}\nD-1: ${money(gph(camp[c.type].d1))}/h over ${camp[c.type].d1.streams} streams\nD-Day: ${money(gph(camp[c.type].dday))}/h over ${camp[c.type].dday.streams} streams` })),
                    { label: 'BAU', values: [gph(bau), 0], tip: `Regular BAU streams\n${money(gph(bau))}/h over ${bau.streams} streams` }]} />
              </div>
            </div>
            <div className="table-wrap scroll-y">
              <SortTable initial={{ col: 0, dir: 'asc' }}
                cols={[{ label: 'Campaign' }, { label: 'Day' }, { label: 'Streams', num: true }, { label: 'Hours', num: true },
                  { label: 'Total GMV', num: true }, { label: 'GMV / hour', num: true }, { label: 'GMV / stream', num: true },
                  { label: 'vs BAU (per hour)', num: true, tip: 'How many times the regular BAU GMV per hour' }, { label: 'Talent fees', num: true }]}
                rows={[
                  ...CAMPAIGNS.flatMap(c => (['d1', 'dday'] as const).map(ph => {
                    const t = camp[c.type][ph];
                    return { key: c.type + ph, sort: [c.name + (ph === 'd1' ? '1' : '2'), ph, t.streams, t.hours, t.gmv, gph(t), t.streams ? t.gmv / t.streams : 0, gph(bau) ? gph(t) / gph(bau) : 0, t.fee],
                      cells: [<span key="c" className="camp-dot" style={{ '--cc': CAMPAIGN_COLOR[c.type] } as React.CSSProperties}>{c.name}</span>, ph === 'd1' ? 'D-1' : 'D-Day',
                        t.streams, r1(t.hours), <strong key="g">{money(t.gmv)}</strong>, money(gph(t)), money(t.streams ? t.gmv / t.streams : 0), times(gph(t), gph(bau)), money(t.fee)] };
                  })),
                  { key: 'other', sort: ['Other Mega days', '', otherMega.streams, otherMega.hours, otherMega.gmv, gph(otherMega), otherMega.streams ? otherMega.gmv / otherMega.streams : 0, gph(bau) ? gph(otherMega) / gph(bau) : 0, otherMega.fee],
                    cells: ['Other Mega days', '\u2014', otherMega.streams, r1(otherMega.hours), money(otherMega.gmv), money(gph(otherMega)), money(otherMega.streams ? otherMega.gmv / otherMega.streams : 0), times(gph(otherMega), gph(bau)), money(otherMega.fee)] },
                  { key: 'bau', className: 'muted-row', sort: ['Regular (BAU)', '', bau.streams, bau.hours, bau.gmv, gph(bau), bau.streams ? bau.gmv / bau.streams : 0, 1, bau.fee],
                    cells: ['Regular (BAU)', '\u2014', bau.streams, r1(bau.hours), money(bau.gmv), money(gph(bau)), money(bau.streams ? bau.gmv / bau.streams : 0), '1.0\u00d7', money(bau.fee)] },
                ]} />
            </div>
            <h3>Each month, side by side</h3>
            <div className="table-wrap scroll-y">
              <SortTable initial={{ col: 0, dir: 'asc' }}
                cols={[{ label: 'Month' }, ...CAMPAIGNS.flatMap(c => [{ label: `${c.name} D-1`, num: true }, { label: `${c.name} D-Day`, num: true }]), { label: 'Campaign total', num: true }]}
                rows={campMonths.map(cm => {
                  const cellsFor = CAMPAIGNS.flatMap(c => (['d1', 'dday'] as const).map(ph => cm.t[c.type][ph]));
                  const totalC = cellsFor.reduce((a, t) => a + t.gmv, 0);
                  return {
                    key: `${cm.year}-${cm.month}`,
                    sort: [cm.year * 12 + cm.month, ...cellsFor.map(t => t.gmv), totalC],
                    cells: [`${MONTH_NAMES[cm.month]} ${cm.year}`,
                      ...cellsFor.map((t, i) => t.streams
                        ? <span key={i} data-tip={`${t.streams} streams \u00b7 ${r1(t.hours)} h\n${money(gph(t))} per hour\nFees ${money(t.fee)}`}>{money(t.gmv)}</span>
                        : <span key={i} className="muted">{'\u2014'}</span>),
                      <strong key="t">{money(totalC)}</strong>],
                  };
                })} />
            </div>
          </Section>

          <Section title="Hosts" note="Click a column to sort. Shared streams: GMV and fees split equally; streams and hours count in full for each host.">
            <div className="table-wrap scroll-y">
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
                    money(a.paid), a.brands.size ? <BrandPill key="b" brand={top(a.brands)} color={colors[top(a.brands)]} /> : '\u2014', a.brands.size,
                  ],
                }))} />
            </div>
          </Section>

          <Section title="Brands">
            <div className="table-wrap scroll-y">
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
          </Section>

          <Section title="Months">
            <div className="table-wrap scroll-y">
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
          </Section>

          <Section title="Platforms" note="Share of GMV. Hover a slice for streams, GMV per hour and fees.">
            <div className="card">
              <PieChart label="Share of GMV by platform" center={{ value: money(tot.gmv).replace(/\.\d\d$/, ''), caption: 'total GMV' }}
                slices={(['tiktok', 'shopee', 'both'] as const).map(p => {
                  const a = byPlatform.get(p) || emptyTotals();
                  return {
                    name: PLATFORM_LABEL[p], value: a.gmv, color: PLATFORM_COLOR[p],
                    tip: `${PLATFORM_LABEL[p]}\nGMV ${money(a.gmv)} (${pct(a.gmv, tot.gmv)})\n${a.streams} streams \u00b7 ${money(gph(a))} per hour\nFees ${money(a.fee)}`,
                    detail: <>{money(a.gmv)} &middot; {a.streams} streams &middot; {money(gph(a))}/h</>,
                  };
                })} />
            </div>
          </Section>

          <Section title={'Hosts \u00d7 brands'} note={`Darker = more. Top ${mHosts.length} hosts and ${mBrands.length} brands by ${metric === 'gmv' ? 'GMV' : metric === 'fee' ? 'talent fees' : 'streams'}. Hover a cell for the figures.`}
            right={<div className="seg" role="tablist" aria-label="Measure">
              {(['gmv', 'fee', 'streams'] as const).map(k => (
                <Link key={k} href={q({ mx: k === 'gmv' ? null : k })} className={metric === k ? 'on' : ''}>{k === 'gmv' ? 'GMV' : k === 'fee' ? 'Talent fees' : 'Streams'}</Link>
              ))}
            </div>}>
            <div className="table-wrap scroll-y">
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
                            data-tip={c ? `${h} \u00b7 ${b}\nGMV ${money(c.gmv)} \u00b7 fees ${money(c.fee)}\n${c.streams} streams` : undefined}>
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
          </Section>
        </>
      )}
    </>
  );
}
