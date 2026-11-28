/**
 * Donut chart with a legend table (the legend doubles as the table view). Slices are separated by a
 * 2px surface gap; hover a slice or legend row for its figures.
 */
export interface Slice { name: string; value: number; color: string; tip: string; detail?: React.ReactNode }

export default function PieChart({ slices, label, center }: { slices: Slice[]; label: string; center?: { value: string; caption: string } }) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const R = 80, r = 50, C = 90;
  let a0 = -Math.PI / 2;
  const arc = (start: number, end: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    return `M${p(R, start)} A${R},${R} 0 ${large} 1 ${p(R, end)} L${p(r, end)} A${r},${r} 0 ${large} 0 ${p(r, start)} Z`;
  };
  return (
    <figure className="pie" aria-label={label}>
      <svg viewBox="0 0 180 180" role="img" aria-label={label}>
        {slices.filter(s => s.value > 0).map(s => {
          const frac = s.value / total;
          const a1 = a0 + frac * Math.PI * 2 - (frac >= 0.999 ? 0.0001 : 0);
          const d = arc(a0, a1);
          a0 = a1;
          return <path key={s.name} d={d} style={{ fill: s.color }} className="slice" data-tip={s.tip} />;
        })}
        {center && (
          <>
            <text x={C} y={C - 2} textAnchor="middle" className="pie-v">{center.value}</text>
            <text x={C} y={C + 15} textAnchor="middle" className="pie-c">{center.caption}</text>
          </>
        )}
      </svg>
      <figcaption>
        <table className="compact pie-legend">
          <tbody>
            {slices.map(s => (
              <tr key={s.name} data-tip={s.tip}>
                <td><i style={{ background: s.color }} />{s.name}</td>
                <td className="num"><strong>{Math.round((s.value / total) * 1000) / 10}%</strong></td>
                {s.detail != null && <td className="num muted">{s.detail}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
