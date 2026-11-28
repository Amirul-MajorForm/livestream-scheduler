'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeFee, withRecordedFee, money, pctLabel, splitHosts, PAY_STATUSES, type Rate, type FeeResult } from '@/lib/earnings';
import { fmtRange } from '@/lib/format';
import PlatformTag from './PlatformTag';
import BrandPill from './BrandPill';

export interface SalesRowIn {
  id: number;
  date: string;
  dateLabel: string;
  start_min: number;
  end_min: number;
  host_name: string;
  brand: string;
  period: string;
  platform: string;
  confirmed: boolean;
  tt: string;
  sp: string;
  pay: string;
  notes: string;
  group: Rate[];
  /** Imported from the sheet: the fee it recorded, and its rate version / tier (used while the GMV is unchanged). */
  recordedFee: number | null;
  feeBlank: boolean;
  recLabel: string;
  recTier: string;
}

type Calc = { r: SalesRowIn; v: { tt: string; sp: string; pay: string; notes: string }; bad: boolean; entered: boolean; res: FeeResult | null };
type SortKey = 'date' | 'host' | 'brand' | 'platform' | 'tt' | 'sp' | 'total' | 'gph' | 'rate' | 'fee' | 'pay' | 'notes';

const toNum = (x: string) => { const t = x.replace(/[$,\s]/g, ''); return t === '' ? null : Number(t); };
const PAID = /^paid/i;
const platformOf = (p: string) => { const s = p.toLowerCase(); return s.includes('tiktok') && s.includes('shopee') ? 'both' : s.includes('shopee') ? 'shopee' : 'tiktok'; };

/**
 * Sales entry for the month's published streams: filter, sort, tick rows for bulk payment status.
 * Fees and totals update as you type; Save stores every row (filtered-out rows stay in the form, hidden).
 */
export interface SalesFilter { host: string; brand: string; platform: string; from: string; to: string; pay: string }
/** URL query keys for the filters, so a save brings you back to the same view. */
export const FILTER_KEYS: Record<keyof SalesFilter, string> = { host: 'sh', brand: 'sb', platform: 'pf', from: 'df', to: 'dt', pay: 'ps' };

export default function SalesTable({ rows, monthId, returnTo, action, colors, initial }: {
  rows: SalesRowIn[];
  monthId: number;
  returnTo: string;
  action: (f: FormData) => Promise<void>;
  colors: Record<string, string>;
  initial: SalesFilter;
}) {
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.id, { tt: r.tt, sp: r.sp, pay: r.pay, notes: r.notes }])));
  const [dirty, setDirty] = useState(false);
  const set = (id: number, k: 'tt' | 'sp' | 'pay' | 'notes', v: string) => { setVals(p => ({ ...p, [id]: { ...p[id], [k]: v } })); setDirty(true); };

  // Filters and sort (in the browser, so nothing typed is lost when they change).
  const [f, setF] = useState<SalesFilter>(initial);
  const back = returnTo + Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${FILTER_KEYS[k as keyof SalesFilter]}=${encodeURIComponent(v)}`).join('');
  const setFilter = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: 1 });

  const calc: Calc[] = useMemo(() => rows.map(r => {
    const v = vals[r.id];
    const tt = toNum(v.tt), sp = toNum(v.sp);
    const bad = (tt != null && !(tt >= 0)) || (sp != null && !(sp >= 0));
    const keepRecorded = (r.recordedFee != null || r.feeBlank) && v.tt === r.tt && v.sp === r.sp;
    const res = bad ? null : computeFee(r.group, { ...r, tiktok_gmv: tt, shopee_gmv: sp });
    return { r, v, bad, entered: tt != null || sp != null || keepRecorded, res: res && keepRecorded ? withRecordedFee(res, r.recordedFee, r.feeBlank) : res };
  }), [rows, vals]);

  const hosts = useMemo(() => [...new Set(rows.flatMap(r => splitHosts(r.host_name)))].sort(), [rows]);
  const brands = useMemo(() => [...new Set(rows.map(r => r.brand))].sort(), [rows]);

  const visible = useMemo(() => {
    const shown = calc.filter(({ r, v }) =>
      (!f.host || splitHosts(r.host_name).includes(f.host))
      && (!f.brand || r.brand === f.brand)
      && (!f.platform || platformOf(r.platform) === f.platform)
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
      && (!f.pay || (f.pay === '-' ? !v.pay : f.pay === 'unpaid' ? !PAID.test(v.pay) : v.pay === f.pay)));
    const key = (c: Calc): string | number | null => {
      const { r, v, res, entered } = c;
      switch (sort.key) {
        case 'date': return r.date + String(r.start_min).padStart(4, '0');
        case 'host': return r.host_name || null;
        case 'brand': return r.brand;
        case 'platform': return r.platform;
        case 'tt': return toNum(v.tt);
        case 'sp': return toNum(v.sp);
        case 'total': return entered && res ? res.totalGmv : null;
        case 'gph': return entered ? res?.gmvPerHour ?? null : null;
        case 'rate': return ((res?.rate?.tier || r.recTier || '') + (res?.rate?.label || r.recLabel || '')) || null;
        case 'fee': return entered ? res?.fee ?? null : null;
        case 'pay': return v.pay || null;
        case 'notes': return v.notes || null;
      }
    };
    return [...shown].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [calc, f, sort]);
  const visibleIds = useMemo(() => new Set(visible.map(c => c.r.id)), [visible]);
  const filtered = visible.length !== rows.length;

  // Ticked rows for bulk changes. Shift-click ticks a range (in the order shown).
  const [sel, setSel] = useState<Set<number>>(new Set());
  const lastClick = useRef<number | null>(null);
  const [bulkPay, setBulkPay] = useState<string>('Paid');
  const [bulkNote, setBulkNote] = useState('');
  const [submitNext, setSubmitNext] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const allBox = useRef<HTMLInputElement>(null);
  const selVisible = [...sel].filter(id => visibleIds.has(id));
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = selVisible.length > 0 && selVisible.length < visible.length;
  }, [selVisible.length, visible.length]);
  useEffect(() => {
    if (submitNext) { setSubmitNext(false); formRef.current?.requestSubmit(); }
  }, [submitNext]);
  const tick = (id: number, index: number, on: boolean, shift: boolean) => {
    const from = lastClick.current; // read now: the state updater below runs later
    setSel(prev => {
      const next = new Set(prev);
      if (shift && from != null) {
        const [a, b] = [Math.min(from, index), Math.max(from, index)];
        visible.slice(a, b + 1).forEach(c => { if (on) next.add(c.r.id); else next.delete(c.r.id); });
      } else if (on) next.add(id); else next.delete(id);
      return next;
    });
    lastClick.current = index;
  };
  const selectWhere = (pred: (c: Calc) => boolean) => setSel(new Set(visible.filter(pred).map(c => c.r.id)));
  const applyBulk = (alsoNote: boolean) => {
    if (!selVisible.length) return;
    setVals(p => {
      const n = { ...p };
      selVisible.forEach(id => { n[id] = { ...n[id], pay: bulkPay, ...(alsoNote ? { notes: bulkNote } : {}) }; });
      return n;
    });
    setDirty(true);
    setSubmitNext(true);
  };

  const tot = visible.reduce((a, c) => {
    if (!c.res || !c.entered) return a;
    a.tt += toNum(c.v.tt) ?? 0; a.sp += toNum(c.v.sp) ?? 0; a.fee += c.res.fee ?? 0; a.n++;
    if (PAID.test(c.v.pay)) a.paid += c.res.fee ?? 0;
    if (c.res.fee == null && !c.res.recorded) a.noRate++;
    return a;
  }, { tt: 0, sp: 0, fee: 0, paid: 0, n: 0, noRate: 0 });
  const noRateRows = visible.filter(c => !c.r.group.length && !c.res?.recorded).length;

  const Th = ({ k, children, num, tip }: { k: SortKey; children: React.ReactNode; num?: boolean; tip?: string }) => (
    <th className={num ? 'num' : ''} data-tip={tip} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={'th-sort' + (sort.key === k ? ' on' : '')}
        onClick={() => setSort(s => s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: num ? -1 : 1 })}>
        {children}<span className="arrow">{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ⇅'}</span>
      </button>
    </th>
  );

  return (
    <form action={action} onSubmit={() => setDirty(false)} ref={formRef}>
      <input type="hidden" name="monthId" value={monthId} />
      <input type="hidden" name="returnTo" value={back} />

      <div className="sales-filters">
        <select value={f.host} onChange={setFilter('host')} aria-label="Host"><option value="">All hosts</option>{hosts.map(h => <option key={h}>{h}</option>)}</select>
        <select value={f.brand} onChange={setFilter('brand')} aria-label="Brand"><option value="">All brands</option>{brands.map(b => <option key={b}>{b}</option>)}</select>
        <select value={f.platform} onChange={setFilter('platform')} aria-label="Platform">
          <option value="">All platforms</option><option value="tiktok">TikTok only</option><option value="shopee">Shopee only</option><option value="both">TikTok &amp; Shopee</option>
        </select>
        <label className="inline small">From <input type="date" value={f.from} onChange={setFilter('from')} /></label>
        <label className="inline small">to <input type="date" value={f.to} onChange={setFilter('to')} /></label>
        <select value={f.pay} onChange={setFilter('pay')} aria-label="Payment status">
          <option value="">Any payment status</option><option value="unpaid">Not paid yet</option><option value="-">No status</option>
          {PAY_STATUSES.filter(Boolean).map(s => <option key={s}>{s}</option>)}
        </select>
        {filtered && <button type="button" className="link" onClick={() => setF({ host: '', brand: '', platform: '', from: '', to: '', pay: '' })}>Clear filters</button>}
        <span className="small muted">{visible.length} of {rows.length} streams</span>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="lab">Total GMV</div><div className="v">{money(tot.tt + tot.sp)}</div><div className="s">{tot.n} of {visible.length} streams entered</div></div>
        <div className="kpi"><div className="lab">TikTok GMV</div><div className="v">{money(tot.tt)}</div><div className="s">&nbsp;</div></div>
        <div className="kpi"><div className="lab">Shopee GMV</div><div className="v">{money(tot.sp)}</div><div className="s">&nbsp;</div></div>
        <div className="kpi" data-tip={'Talent fees:\nWhat the hosts are owed for the streams shown.'}><div className="lab">Talent fees</div><div className="v ok">{money(tot.fee)}</div><div className="s">for streams with figures</div></div>
        <div className="kpi" data-tip={'Paid to hosts:\nFees on streams marked Paid (or Paid to Host, Pending Payment From Brand).'}><div className="lab">Paid to hosts</div><div className="v">{money(tot.paid)}</div><div className="s">{money(tot.fee - tot.paid)} still to pay</div></div>
        <div className="kpi" data-tip={'No rate:\nStreams with no matching payment rate (brand, period, platform, date). Add one under Payment rates.'}>
          <div className="lab">No rate</div><div className={'v' + (noRateRows ? ' bad' : '')}>{noRateRows}</div><div className="s">{noRateRows ? <a href="/admin/rates">add rates</a> : 'all streams covered'}</div>
        </div>
      </div>

      <div className={'bulk-pay' + (selVisible.length ? ' on' : '')}>
        <span className="small"><strong>{selVisible.length}</strong> selected</span>
        <span className="small muted">Select:</span>
        <button type="button" className="link" onClick={() => selectWhere(() => true)}>all</button>
        <button type="button" className="link" onClick={() => selectWhere(c => !!(c.v.tt || c.v.sp) || c.r.recordedFee != null)}>with sales</button>
        <button type="button" className="link" onClick={() => selectWhere(c => !PAID.test(c.v.pay))}>not paid</button>
        <button type="button" className="link" onClick={() => setSel(new Set())} disabled={!sel.size}>none</button>
        <span className="bulk-sep" />
        <label className="inline small">Payment status
          <select value={bulkPay} onChange={e => setBulkPay(e.target.value)} aria-label="Payment status for selected streams">
            {PAY_STATUSES.map(s => <option key={s} value={s}>{s || '— (clear)'}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={!selVisible.length} onClick={() => applyBulk(false)}>
          Set for {selVisible.length || ''} stream{selVisible.length === 1 ? '' : 's'} &amp; save
        </button>
        <details className="bulk-note">
          <summary className="small">Also set a note</summary>
          <div className="inline" style={{ marginTop: 6 }}>
            <input value={bulkNote} onChange={e => setBulkNote(e.target.value)} placeholder="e.g. Paid 30 Nov, batch 12" aria-label="Note for selected streams" />
            <button type="button" disabled={!selVisible.length} onClick={() => applyBulk(true)}>Set status + note &amp; save</button>
          </div>
        </details>
      </div>

      <div className="table-wrap sticky-matrix sales-scroll">
        <table className="compact one-line sales-table">
          <thead>
            <tr>
              <th className="cb"><input type="checkbox" ref={allBox} checked={visible.length > 0 && selVisible.length === visible.length}
                onChange={e => setSel(e.target.checked ? new Set(visible.map(c => c.r.id)) : new Set())} aria-label="Select all streams shown" /></th>
              <Th k="date">Date &amp; time</Th><Th k="host">Host</Th><Th k="brand">Brand</Th><Th k="platform">Platform</Th>
              <Th k="tt" num>TikTok GMV</Th><Th k="sp" num>Shopee GMV</Th><Th k="total" num>Total</Th>
              <Th k="gph" num tip="Total GMV per stream hour (per platform-hour for a both-platforms rate). Picks the tier.">GMV/h</Th>
              <Th k="rate">Rate</Th><Th k="fee" num>Talent fee</Th><Th k="pay">Payment</Th><Th k="notes">Notes</Th>
            </tr>
          </thead>
          <tbody>
            {[...visible, ...calc.filter(c => !visibleIds.has(c.r.id))].map((c, i) => {
              const { r, v, bad, entered, res } = c;
              const hidden = !visibleIds.has(r.id);
              const p = r.platform.toLowerCase();
              const hasTT = p.includes('tiktok'), hasSP = p.includes('shopee');
              const newDay = !hidden && sort.key === 'date' && i > 0 && visible[i - 1]?.r.date !== r.date;
              const rate = res?.rate;
              const tip = res?.recorded ? [
                r.feeBlank ? 'The sheet has no fee for this stream (e.g. a creator deal).' : `Fee as recorded in the sheet${r.recLabel ? ' (' + r.recLabel + (r.recTier ? ' · ' + r.recTier : '') + ')' : ''}.`,
                'Change the GMV and it’s worked out again from Payment rates.',
              ].join('\n') : rate ? [
                `${rate.label || 'Rate'}${rate.tier ? ' · ' + rate.tier : ''} (${rate.period})`,
                rate.method === 'split'
                  ? `${pctLabel(rate.tiktok_comms)} of TikTok + ${pctLabel(rate.shopee_comms)} of Shopee`
                  : `${money(rate.base_per_hour)}/h × ${res!.hours} h + ${pctLabel(rate.total_comms)} of GMV`,
              ].join('\n') : 'No rate:\nNo payment rate matches this brand, period, platform and date.';
              return (
                <tr key={r.id} hidden={hidden} className={(newDay ? 'day-start ' : '') + (bad ? 'up-bad' : '')}>
                  <td className="cb">
                    <input type="checkbox" checked={sel.has(r.id)} aria-label={`Select ${r.brand} ${r.dateLabel}`}
                      onClick={e => tick(r.id, i, e.currentTarget.checked, e.shiftKey)} onChange={() => { /* handled on click, which knows about Shift */ }} />
                  </td>
                  <td>
                    <input type="hidden" name="row" value={r.id} />
                    {r.dateLabel} <span className="muted">{fmtRange(r.start_min, r.end_min)}</span>
                  </td>
                  <td className={r.host_name ? '' : 'muted'}>{r.host_name || 'No host'}</td>
                  <td><BrandPill brand={r.brand} color={colors[r.brand]} />{r.period === 'MEGA' && <> <span className="badge mega">Mega</span></>}</td>
                  <td><PlatformTag platform={r.platform} short /></td>
                  <td className="num">
                    <input name={'tt_' + r.id} value={v.tt} onChange={e => set(r.id, 'tt', e.target.value)} inputMode="decimal" className="w-money"
                      disabled={!hasTT && !v.tt} placeholder={hasTT ? '0.00' : '—'} aria-label={`TikTok GMV ${r.brand} ${r.dateLabel}`} />
                  </td>
                  <td className="num">
                    <input name={'sp_' + r.id} value={v.sp} onChange={e => set(r.id, 'sp', e.target.value)} inputMode="decimal" className="w-money"
                      disabled={!hasSP && !v.sp} placeholder={hasSP ? '0.00' : '—'} aria-label={`Shopee GMV ${r.brand} ${r.dateLabel}`} />
                  </td>
                  <td className="num">{entered && res ? money(res.totalGmv) : '—'}</td>
                  <td className="num">{entered && res?.gmvPerHour != null ? money(res.gmvPerHour) : '—'}</td>
                  <td data-tip={tip}>{res?.recorded && (r.recLabel || !rate)
                    ? <span className="rate-cell">{r.recTier ? <strong>{r.recTier}</strong> : null}{r.recTier && r.recLabel ? ' · ' : ''}{r.recLabel || 'Sheet'}</span>
                    : rate
                    ? <span className="rate-cell">{rate.tier ? <strong>{rate.tier}</strong> : null}{rate.tier && rate.label ? ' · ' : ''}{rate.label}</span>
                    : <span className="badge bad tip">No rate</span>}</td>
                  <td className="num"><strong>{bad ? <span className="badge bad">Not a number</span> : entered ? money(res?.fee) : '—'}</strong>{res?.recorded && entered ? <span className="rec-mark" title="Recorded in the sheet">s</span> : null}</td>
                  <td>
                    <select name={'st_' + r.id} value={v.pay} onChange={e => set(r.id, 'pay', e.target.value)} className="w-pay" aria-label="Payment status">
                      {PAY_STATUSES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                    </select>
                  </td>
                  <td><input name={'nt_' + r.id} value={v.notes} onChange={e => set(r.id, 'notes', e.target.value)} className="w-notes" aria-label="Notes" /></td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={13} className="muted">No streams match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sticky-bar save-bar">
        <span className="small muted">{dirty ? 'Unsaved changes' : 'Enter GMV as shown in TikTok Shop / Shopee. Blank = not entered yet.'}{tot.noRate ? ` · ${tot.noRate} entered stream${tot.noRate === 1 ? ' has' : 's have'} no rate` : ''}</span>
        <button className="primary" type="submit">Save sales</button>
      </div>
    </form>
  );
}
