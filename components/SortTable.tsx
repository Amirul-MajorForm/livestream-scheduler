'use client';

import { useMemo, useState } from 'react';

export interface SortCol { label: React.ReactNode; num?: boolean; tip?: string; sortable?: boolean }
export interface SortRow { key: string; cells: React.ReactNode[]; sort: (string | number | null)[]; className?: string }

/** A table whose columns sort on click (click again to reverse). Rows and cells are rendered on the server. */
export default function SortTable({ cols, rows, foot, initial, className }: {
  cols: SortCol[];
  rows: SortRow[];
  foot?: React.ReactNode[];
  initial?: { col: number; dir: 'asc' | 'desc' };
  className?: string;
}) {
  const [sort, setSort] = useState(initial ?? { col: 0, dir: 'asc' as const });
  const sorted = useMemo(() => {
    const { col, dir } = sort;
    const m = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a.sort[col], y = b.sort[col];
      if (x == null && y == null) return 0;
      if (x == null) return 1;            // blanks last either way
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * m;
    });
  }, [rows, sort]);
  const click = (i: number) => setSort(s => s.col === i
    ? { col: i, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col: i, dir: cols[i].num ? 'desc' : 'asc' });   // numbers start biggest-first
  return (
    <table className={'compact ' + (className || '')}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} className={c.num ? 'num' : ''} data-tip={c.tip} aria-sort={sort.col === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.sortable === false ? c.label : (
                <button type="button" className={'th-sort' + (sort.col === i ? ' on' : '')} onClick={() => click(i)}>
                  {c.label}<span className="arrow">{sort.col === i ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => <tr key={r.key} className={r.className}>{r.cells.map((c, i) => <td key={i} className={cols[i].num ? 'num' : ''}>{c}</td>)}</tr>)}
        {!rows.length && <tr><td colSpan={cols.length} className="muted">Nothing to show.</td></tr>}
      </tbody>
      {foot && <tfoot><tr className="total-row">{foot.map((c, i) => <td key={i} className={cols[i]?.num ? 'num' : ''}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}
