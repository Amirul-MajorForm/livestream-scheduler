'use client';

import { Fragment, useMemo, useState } from 'react';
import type { Rate } from '@/lib/earnings';
import { money } from '@/lib/earnings';
import BrandPill from './BrandPill';
import ConfirmButton from './ConfirmButton';

type Action = (f: FormData) => Promise<void>;
type Kind = 'text' | 'num' | 'pct' | 'date' | 'select';
interface Col {
  key: keyof Rate;
  label: string;
  kind: Kind;
  options?: [string, string][];    // value, label (select columns)
  tip?: string;
  width?: number;                  // edit input width
}

const PERIODS: [string, string][] = [['BAU', 'BAU'], ['Mega', 'Mega'], ['All', 'All']];
const TYPES: [string, string][] = [['any', 'Any'], ['single', 'One'], ['dual', 'Both']];
const METHODS: [string, string][] = [['base_comms', 'Base+comms'], ['split', 'Split']];
const ACCOUNTS: [string, string][] = [['Brand', 'Brand'], ['Creator', 'Creator']];
const ACTIVE: [string, string][] = [['on', 'On'], ['off', 'Off']];

const COLS: Col[] = [
  { key: 'brand', label: 'Brand', kind: 'text', width: 104 },
  { key: 'label', label: 'Version', kind: 'text', width: 104 },
  { key: 'account', label: 'Account', kind: 'select', options: ACCOUNTS },
  { key: 'period', label: 'Period', kind: 'select', options: PERIODS },
  { key: 'stream_type', label: 'Type', kind: 'select', options: TYPES, tip: 'Stream type this rate is for: One platform, Both at once (TikTok & Shopee), or Any' },
  { key: 'method', label: 'Method', kind: 'select', options: METHODS },
  { key: 'tier', label: 'Tier', kind: 'text', width: 64 },
  { key: 'gmv_min', label: 'GMV/h from', kind: 'num', tip: 'Tier starts above this GMV per hour', width: 58 },
  { key: 'gmv_max', label: 'GMV/h to', kind: 'num', tip: 'Tier ends at this GMV per hour', width: 58 },
  { key: 'base_per_hour', label: 'Base $/h', kind: 'num', tip: 'Talent base pay per stream hour', width: 50 },
  { key: 'total_comms', label: 'Comms %', kind: 'pct', tip: 'Commission on total GMV', width: 44 },
  { key: 'tiktok_comms', label: 'TT %', kind: 'pct', tip: 'TikTok commission (split comms only)', width: 44 },
  { key: 'shopee_comms', label: 'SP %', kind: 'pct', tip: 'Shopee commission (split comms only)', width: 44 },
  { key: 'agency_comms', label: 'Agency %', kind: 'pct', tip: 'Agency share taken off the talent fee', width: 44 },
  { key: 'valid_from', label: 'Valid from', kind: 'date', tip: 'First day this rate applies' },
  { key: 'valid_to', label: 'Valid to', kind: 'date', tip: 'Last day this rate applies (blank = open-ended)' },
  { key: 'active', label: 'On', kind: 'select', options: ACTIVE },
];

const pct = (x: number) => String(Math.round(x * 10000) / 100);
const svg = (d: React.ReactNode) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const ICON = {
  edit: svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  remove: svg(<><path d="M5 7h14" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></>),
};
const shortDate = (d: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${String(y).slice(2)}`;
};
/** The value a cell shows (also what the filter matches). */
function shown(r: Rate, c: Col): string {
  const v = r[c.key];
  if (c.key === 'active') return r.active ? 'On' : 'Off';
  if (c.options) return c.options.find(o => o[0] === v)?.[1] ?? String(v ?? '');
  if (v == null || v === '') return '';
  if (c.kind === 'pct') return pct(v as number) + '%';
  if (c.key === 'base_per_hour') return money(v as number);
  if (c.kind === 'num') return String(Math.round((v as number) * 100) / 100);
  if (c.kind === 'date') return shortDate(v as string);
  return String(v);
}
/** The value a column sorts by. */
function sortVal(r: Rate, c: Col): string | number | null {
  const v = r[c.key];
  if (c.key === 'active') return r.active ? 1 : 0;
  if (v == null || v === '') return null;
  return typeof v === 'number' ? v : String(v);
}

/**
 * Payment rates, one compact line each. Sort by any column, filter under each header,
 * Edit a row in place (Save / Cancel), Copy or Remove it.
 */
export default function RatesTable({ rates, colors, returnTo, initialFilters, initialSort, update, duplicate, remove }: {
  rates: Rate[];
  colors: Record<string, string>;
  returnTo: string;
  initialFilters?: Record<string, string>;
  initialSort?: { i: number; dir: 1 | -1 };
  update: Action; duplicate: Action; remove: Action;
}) {
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters || {});
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 }>(initialSort || { i: 0, dir: 1 });
  // Saving reloads the page: send the filters and sort along so you come back to the same view.
  const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const back = returnTo + '?view=' + encodeURIComponent(JSON.stringify({ f: active, s: sort }));
  const [editing, setEditing] = useState<number | null>(null);

  const rows = useMemo(() => {
    const f = rates.filter(r => COLS.every(c => {
      const q = (filters[c.key] || '').trim().toLowerCase();
      if (!q) return true;
      if (c.options) return (c.key === 'active' ? (r.active ? 'on' : 'off') : String(r[c.key])).toLowerCase() === q;
      return shown(r, c).toLowerCase().includes(q) || String(r[c.key] ?? '').toLowerCase().includes(q);
    }));
    const c = COLS[sort.i];
    // Brand / version / tier order as the tie-break so groups stay together.
    const base = (a: Rate, b: Rate) => a.brand.localeCompare(b.brand) || a.label.localeCompare(b.label, undefined, { numeric: true })
      || a.period.localeCompare(b.period) || (a.gmv_min ?? -1) - (b.gmv_min ?? -1) || a.id - b.id;
    return [...f].sort((a, b) => {
      const x = sortVal(a, c), y = sortVal(b, c);
      if (x == null && y == null) return base(a, b);
      if (x == null) return 1;
      if (y == null) return -1;
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return d * sort.dir || base(a, b);
    });
  }, [rates, filters, sort]);

  const anyFilter = Object.values(filters).some(Boolean);
  const editValue = (r: Rate, c: Col) => {
    const v = r[c.key];
    if (c.key === 'active') return r.active ? 'on' : 'off';
    if (c.kind === 'pct') return pct(v as number);
    return v == null ? '' : String(v);
  };

  return (
    <>
      <div className="toolbar-row">
        <span className="small muted">
          {rows.length} of {rates.length} rate rows. Click a header to sort; type or pick under it to filter. Percentages are entered as numbers (12 for 12%).
        </span>
        {anyFilter && <button type="button" className="link" onClick={() => setFilters({})}>Clear filters</button>}
      </div>
      {/* Hidden forms: one for the row being edited, one per row for Copy / Remove. */}
      <div hidden>
        <form id="rate-edit" action={update} onSubmit={() => setEditing(null)}>
          <input type="hidden" name="id" value={editing ?? ''} />
          <input type="hidden" name="returnTo" value={back} />
        </form>
        {rows.map(r => (
          <form key={r.id} id={'rx' + r.id} action={duplicate}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="returnTo" value={back} />
          </form>
        ))}
      </div>
      <div className="table-wrap scroll-y">
        <table className="compact one-line rates-grid">
          <thead>
            <tr>
              {COLS.map((c, i) => (
                <th key={c.key} className={c.kind === 'num' || c.kind === 'pct' ? 'num' : ''}
                  aria-sort={sort.i === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className={'th-sort' + (sort.i === i ? ' on' : '')} data-tip={c.tip}
                    onClick={() => setSort(s => s.i === i ? { i, dir: (s.dir * -1) as 1 | -1 } : { i, dir: 1 })}>
                    {c.label}<span className="arrow">{sort.i === i ? (sort.dir === 1 ? ' \u25b2' : ' \u25bc') : ' \u21c5'}</span>
                  </button>
                  <div className="th-filter">
                    {c.options ? (
                      <select value={filters[c.key] || ''} onChange={e => setFilters({ ...filters, [c.key]: e.target.value })} aria-label={'Filter ' + c.label}>
                        <option value="">All</option>
                        {c.options.map(([v, l]) => <option key={v} value={v.toLowerCase()}>{l}</option>)}
                      </select>
                    ) : (
                      <input value={filters[c.key] || ''} onChange={e => setFilters({ ...filters, [c.key]: e.target.value })}
                        placeholder={c.kind === 'date' ? 'Dec 26' : 'Filter'} aria-label={'Filter ' + c.label}
                        list={c.key === 'brand' ? 'rate-filter-brands' : undefined} />
                    )}
                  </div>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isEdit = editing === r.id;
              return (
                <Fragment key={r.id}>
                  <tr id={'rate-' + r.id} className={(r.active ? '' : 'row-inactive ') + (isEdit ? 'row-editing' : '')}>
                    {COLS.map(c => (
                      <td key={c.key} className={c.kind === 'num' || c.kind === 'pct' ? 'num' : ''}>
                        {c.key === 'brand' ? <BrandPill brand={r.brand} color={colors[r.brand]} /> : shown(r, c) || <span className="muted">{'\u2014'}</span>}
                      </td>
                    ))}
                    <td className="nw">
                      <div className="row-actions icon-actions">
                        <button type="button" className="icon-btn" onClick={() => setEditing(isEdit ? null : r.id)} disabled={editing != null && !isEdit}
                          title={isEdit ? 'Close without saving' : 'Edit this rate'} aria-label={`Edit ${r.brand} ${r.label} ${r.tier}`} aria-expanded={isEdit}>{ICON.edit}</button>
                        <button type="submit" form={'rx' + r.id} className="icon-btn"
                          title="Copy as a new rate (then edit the copy)" aria-label={`Copy ${r.brand} ${r.label} ${r.tier}`}>{ICON.copy}</button>
                        <ConfirmButton form={'rx' + r.id} formAction={remove} className="icon-btn danger"
                          title="Remove this rate" ariaLabel={`Remove ${r.brand} ${r.label} ${r.tier}`}
                          message={`Remove this ${r.brand} rate${r.tier ? ' (' + r.tier + ')' : ''}? Streams that used it will show \u201cNo rate\u201d unless another rate applies.`}>{ICON.remove}</ConfirmButton>
                      </div>
                    </td>
                  </tr>
                  {isEdit && (
                    <tr className="edit-panel">
                      <td colSpan={COLS.length + 1}>
                        <div className="edit-grid">
                          {COLS.map(c => {
                            const num = c.kind === 'num' || c.kind === 'pct';
                            const common = { form: 'rate-edit', name: c.key, defaultValue: editValue(r, c) };
                            return (
                              <label key={c.key} className="field" title={c.tip}>{c.label}
                                {c.options
                                  ? <select {...common}>{c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                  : <input {...common} type={c.kind === 'date' ? 'date' : 'text'} inputMode={num ? 'decimal' : undefined}
                                      className={num ? 'n' : ''} required={c.key === 'brand'} autoFocus={c.key === 'base_per_hour'} />}
                              </label>
                            );
                          })}
                          <div className="edit-actions">
                            <input type="hidden" form="rate-edit" name="notes" value={r.notes} />
                            <button type="submit" form="rate-edit" className="primary">Save</button>
                            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={COLS.length + 1} className="muted">No rates match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <datalist id="rate-filter-brands">{[...new Set(rates.map(r => r.brand))].sort().map(b => <option key={b} value={b} />)}</datalist>
    </>
  );
}
