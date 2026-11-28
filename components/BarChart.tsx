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

export default function BarChart({ series, data, height = 200, label }: { series: BarSeries[]; data: BarDatum[]; height?: number; label: string }) {
  const W = 520, H = height, L = 46, R = 6, T = 10, B = 24;
  const totals = data.map(d => d.values.reduce((a, x) => a + x, 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotH = H - T - B, plotW = W - L - R;
  const band = plotW / Math.max(1, data.length);
  const bw = Math.min(34, band * 0.56);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
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
              {segs.map((s, k) => {
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
              <text x={cx} y={H - 8} className="tick" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
