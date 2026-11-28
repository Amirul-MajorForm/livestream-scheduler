/**
 * Vertical bar chart (optionally stacked), drawn as SVG on the server. One y-axis; thin bars with
 * rounded tops anchored to the baseline; 2px surface gap between stacked segments; recessive grid;
 * hover any column for its figures (global tooltip). Colours come from CSS variables so dark mode works.
 */
export interface BarSeries { name: string; color: string }
export interface BarDatum { label: string; values: number[]; tip: string }

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const short = (v: number) => v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `$${Math.round(v)}`;

const topRounded = (x: number, yTop: number, w: number, h: number) => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`;
};

/** `grouped`: series side by side in each column instead of stacked. */
export default function BarChart({ series, data, height = 200, label, grouped = false }: { series: BarSeries[]; data: BarDatum[]; height?: number; label: string; grouped?: boolean }) {
  const W = 520, H = height, L = 46, R = 6, T = 10, B = 24;
  const totals = data.map(d => grouped ? Math.max(0, ...d.values) : d.values.reduce((a, x) => a + x, 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotH = H - T - B, plotW = W - L - R;
  const band = plotW / Math.max(1, data.length);
  const bw = Math.min(34, band * 0.56);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const labelStep = Math.max(1, Math.ceil(data.length / 10)); // thin the x labels when there are many columns (hover shows every one)
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(f => f * max); // fifths land on round numbers for 1, 2, 2.5, 5 and 10 maxima
  return (
    <figure className="chart" aria-label={label}>
      {series.length > 1 && (
        <figcaption className="chart-legend">
          {series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={L - 8} y={y(t) + 4} className="tick" textAnchor="end">{short(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + band * i + band / 2;
          let acc = 0;
          const segs = d.values.map((v, si) => ({ v, si })).filter(s => s.v > 0);
          return (
            <g key={d.label} data-tip={d.tip} className="bar-g">
              <rect x={L + band * i} y={T} width={band} height={plotH} className="hit" />
              {grouped && d.values.map((v, si) => {
                const n = d.values.length, gw = Math.min(band * 0.8, n * 16 + (n - 1) * 2), w = (gw - (n - 1) * 2) / n;
                const x = cx - gw / 2 + si * (w + 2), h = Math.max(0, y(0) - y(v));
                return v > 0 ? <path key={si} d={topRounded(x, y(v), w, h)} style={{ fill: series[si].color }} /> : null;
              })}
              {!grouped && segs.map((s, k) => {
                const y0 = y(acc), y1 = y(acc + s.v);
                acc += s.v;
                const top = k === segs.length - 1;
                const gap = k > 0 ? 2 : 0;                 // surface gap between stacked segments
                const h = Math.max(0, y0 - y1 - gap);
                const x = cx - bw / 2, r = Math.min(4, h, bw / 2);
                const d0 = top
                  ? `M${x},${y1 + h} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y1 + h} Z`
                  : `M${x},${y1} H${x + bw} V${y1 + h} H${x} Z`;
                return <path key={s.si} d={d0} style={{ fill: series[s.si].color }} />;
              })}
              {i % labelStep === 0 && <text x={cx} y={H - 8} className="tick" textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
