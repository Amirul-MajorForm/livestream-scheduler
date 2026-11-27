'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeFee, withRecordedFee, money, pctLabel, PAY_STATUSES, type Rate } from '@/lib/earnings';
import { fmtRange } from '@/lib/format';
import PlatformTag from './PlatformTag';

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

const toNum = (x: string) => { const t = x.replace(/[$,\s]/g, ''); return t === '' ? null : Number(t); };

/** Sales entry for the month's published streams. Fees and totals update as you type; Save stores them all. */
export default function SalesTable({ rows, monthId, returnTo, action }: {
  rows: SalesRowIn[];
  monthId: number;
  returnTo: string;
  action: (f: FormData) => Promise<void>;
}) {
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.id, { tt: r.tt, sp: r.sp, pay: r.pay, notes: r.notes }])));
  const [dirty, setDirty] = useState(false);
  const set = (id: number, k: 'tt' | 'sp' | 'pay' | 'notes', v: string) => { setVals(p => ({ ...p, [id]: { ...p[id], [k]: v } })); setDirty(true); };

  // Ticked rows for bulk changes. Shift-click ticks a range.
  const [sel, setSel] = useState<Set<number>>(new Set());
  const lastClick = useRef<number | null>(null);
  const [bulkPay, setBulkPay] = useState<string>('Paid');
  const [bulkNote, setBulkNote] = useState('');
  const [submitNext, setSubmitNext] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = sel.size > 0 && sel.size < rows.length;
  }, [sel, rows.length]);
  useEffect(() => {
    // Save straight after a bulk change has been applied to the inputs.
    if (submitNext) { setSubmitNext(false); formRef.current?.requestSubmit(); }
  }, [submitNext]);
  const tick = (id: number, index: number, on: boolean, shift: boolean) => {
    const from = lastClick.current; // read now: the state updater below runs later
    setSel(prev => {
      const next = new Set(prev);
      if (shift && from != null) {
        const [a, b] = [Math.min(from, index), Math.max(from, index)];
        rows.slice(a, b + 1).forEach(r => { if (on) next.add(r.id); else next.delete(r.id); });
      } else if (on) next.add(id); else next.delete(id);
      return next;
    });
    lastClick.current = index;
  };
  const selectWhere = (pred: (r: SalesRowIn) => boolean) => setSel(new Set(rows.filter(pred).map(r => r.id)));
  const applyBulk = (alsoNote: boolean) => {
    if (!sel.size) return;
    setVals(p => {
      const n = { ...p };
      sel.forEach(id => { n[id] = { ...n[id], pay: bulkPay, ...(alsoNote ? { notes: bulkNote } : {}) }; });
      return n;
    });
    setDirty(true);
    setSubmitNext(true);
  };

  const calc = useMemo(() => rows.map(r => {
    const v = vals[r.id];
    const tt = toNum(v.tt), sp = toNum(v.sp);
    const bad = (tt != null && !(tt >= 0)) || (sp != null && !(sp >= 0));
    const keepRecorded = (r.recordedFee != null || r.feeBlank) && v.tt === r.tt && v.sp === r.sp;
    const res = bad ? null : computeFee(r.group, { ...r, tiktok_gmv: tt, shopee_gmv: sp });
    return { r, v, bad, entered: tt != null || sp != null || keepRecorded, res: res && keepRecorded ? withRecordedFee(res, r.recordedFee, r.feeBlank) : res };
  }), [rows, vals]);

  const tot = calc.reduce((a, c) => {
    if (!c.res || !c.entered) return a;
    a.tt += toNum(c.v.tt) ?? 0; a.sp += toNum(c.v.sp) ?? 0; a.fee += c.res.fee ?? 0; a.agency += c.res.agency ?? 0; a.n++;
    if (c.res.fee != null && c.res.agency == null) a.agencyUnknown++;
    if (c.res.fee == null && !c.res.recorded) a.noRate++;
    return a;
  }, { tt: 0, sp: 0, fee: 0, agency: 0, n: 0, noRate: 0, agencyUnknown: 0 });
  const noRateRows = calc.filter(c => !c.r.group.length && !c.res?.recorded).length;

  return (
    <form action={action} onSubmit={() => setDirty(false)} ref={formRef}>
      <input type="hidden" name="monthId" value={monthId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="kpis">
        <div className="kpi"><div className="lab">Total GMV</div><div className="v">{money(tot.tt + tot.sp)}</div><div className="s">{tot.n} of {rows.length} streams entered</div></div>
        <div className="kpi"><div className="lab">TikTok GMV</div><div className="v">{money(tot.tt)}</div><div className="s">&nbsp;</div></div>
        <div className="kpi"><div className="lab">Shopee GMV</div><div className="v">{money(tot.sp)}</div><div className="s">&nbsp;</div></div>
        <div className="kpi" data-tip={'Talent fees:\nWhat the hosts are owed for the streams shown, after the agency share.'}><div className="lab">Talent fees</div><div className="v ok">{money(tot.fee)}</div><div className="s">for streams with figures</div></div>
        <div className="kpi" data-tip={'Agency share:\nThe agency % taken off each host’s gross.'}><div className="lab">Agency share</div><div className="v">{money(tot.agency)}</div>
          <div className="s">{tot.agencyUnknown ? `${tot.agencyUnknown} stream${tot.agencyUnknown === 1 ? '' : 's'} not counted (rate not in Payment rates)` : '\u00a0'}</div></div>
        <div className="kpi" data-tip={'No rate:\nStreams with no matching payment rate (brand, period, platform, date). Add one under Payment rates.'}>
          <div className="lab">No rate</div><div className={'v' + (noRateRows ? ' bad' : '')}>{noRateRows}</div><div className="s">{noRateRows ? <a href="/admin/rates">add rates</a> : 'all streams covered'}</div>
        </div>
      </div>

      <div className={'bulk-pay' + (sel.size ? ' on' : '')}>
        <span className="small"><strong>{sel.size}</strong> selected</span>
        <span className="small muted">Select:</span>
        <button type="button" className="link" onClick={() => selectWhere(() => true)}>all</button>
        <button type="button" className="link" onClick={() => selectWhere(r => !!(vals[r.id].tt || vals[r.id].sp) || r.recordedFee != null)}>with sales</button>
        <button type="button" className="link" onClick={() => selectWhere(r => !/^paid/i.test(vals[r.id].pay))}>not paid</button>
        <button type="button" className="link" onClick={() => setSel(new Set())} disabled={!sel.size}>none</button>
        <span className="bulk-sep" />
        <label className="inline small">Payment status
          <select value={bulkPay} onChange={e => setBulkPay(e.target.value)} aria-label="Payment status for selected streams">
            {PAY_STATUSES.map(s => <option key={s} value={s}>{s || '\u2014 (clear)'}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={!sel.size} onClick={() => applyBulk(false)}>
          Set for {sel.size || ''} stream{sel.size === 1 ? '' : 's'} &amp; save
        </button>
        <details className="bulk-note">
          <summary className="small">Also set a note</summary>
          <div className="inline" style={{ marginTop: 6 }}>
            <input value={bulkNote} onChange={e => setBulkNote(e.target.value)} placeholder="e.g. Paid 30 Nov, batch 12" aria-label="Note for selected streams" />
            <button type="button" disabled={!sel.size} onClick={() => applyBulk(true)}>Set status + note &amp; save</button>
          </div>
        </details>
      </div>

      <div className="table-wrap sticky-matrix sales-scroll">
        <table className="compact one-line sales-table">
          <thead>
            <tr>
              <th className="cb"><input type="checkbox" ref={allBox} checked={rows.length > 0 && sel.size === rows.length}
                onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} aria-label="Select all streams" /></th>
              <th>Date &amp; time</th><th>Host</th><th>Brand</th><th>Platform</th>
              <th className="num">TikTok GMV</th><th className="num">Shopee GMV</th><th className="num">Total</th>
              <th className="num" data-tip="Total GMV per stream hour (per platform-hour for a both-platforms rate). Picks the tier.">GMV/h</th>
              <th>Rate</th><th className="num">Talent fee</th><th>Payment</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {calc.map(({ r, v, bad, entered, res }, i) => {
              const p = r.platform.toLowerCase();
              const hasTT = p.includes('tiktok'), hasSP = p.includes('shopee');
              const newDay = i > 0 && calc[i - 1].r.date !== r.date;
              const rate = res?.rate;
              const tip = res?.recorded ? [
                r.feeBlank ? 'The sheet has no fee for this stream (e.g. a creator deal).' : `Fee as recorded in the sheet${r.recLabel ? ' (' + r.recLabel + (r.recTier ? ' \u00b7 ' + r.recTier : '') + ')' : ''}.`,
                'Change the GMV and it\u2019s worked out again from Payment rates.',
              ].join('\n') : rate ? [
                `${rate.label || 'Rate'}${rate.tier ? ' · ' + rate.tier : ''} (${rate.period})`,
                rate.method === 'split'
                  ? `${pctLabel(rate.tiktok_comms)} of TikTok + ${pctLabel(rate.shopee_comms)} of Shopee`
                  : `${money(rate.base_per_hour)}/h × ${res!.hours} h + ${pctLabel(rate.total_comms)} of GMV`,
                `less ${pctLabel(rate.agency_comms)} agency`,
              ].join('\n') : 'No rate:\nNo payment rate matches this brand, period, platform and date.';
              return (
                <tr key={r.id} className={(newDay ? 'day-start ' : '') + (bad ? 'up-bad' : '')}>
                  <td className="cb">
                    <input type="checkbox" checked={sel.has(r.id)} aria-label={`Select ${r.brand} ${r.dateLabel}`}
                      onClick={e => tick(r.id, i, e.currentTarget.checked, e.shiftKey)} onChange={() => { /* handled on click, which knows about Shift */ }} />
                  </td>
                  <td>
                    <input type="hidden" name="row" value={r.id} />
                    {r.dateLabel} <span className="muted">{fmtRange(r.start_min, r.end_min)}</span>
                  </td>
                  <td className={r.host_name ? '' : 'muted'}>{r.host_name || 'No host'}</td>
                  <td><strong>{r.brand}</strong> {r.period === 'MEGA' && <span className="badge mega">Mega</span>}</td>
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
                    ? <span className="rate-cell">{r.recTier ? <strong>{r.recTier}</strong> : null}{r.recTier && r.recLabel ? ' \u00b7 ' : ''}{r.recLabel || 'Sheet'}</span>
                    : rate
                    ? <span className="rate-cell">{rate.tier ? <strong>{rate.tier}</strong> : null}{rate.tier && rate.label ? ' \u00b7 ' : ''}{rate.label}</span>
                    : <span className="badge bad tip">No rate</span>}</td>
                  <td className="num"><strong>{bad ? <span className="badge bad">Not a number</span> : entered ? money(res?.fee) : '—'}</strong></td>
                  <td>
                    <select name={'st_' + r.id} value={v.pay} onChange={e => set(r.id, 'pay', e.target.value)} className="w-pay" aria-label="Payment status">
                      {PAY_STATUSES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                    </select>
                  </td>
                  <td><input name={'nt_' + r.id} value={v.notes} onChange={e => set(r.id, 'notes', e.target.value)} className="w-notes" aria-label="Notes" /></td>
                </tr>
              );
            })}
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
