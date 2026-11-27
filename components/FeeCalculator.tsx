'use client';

import { useMemo, useState } from 'react';
import { rateGroupFor, computeFee, money, pctLabel, type Rate } from '@/lib/earnings';

/** Try a stream against the current rates: shows which rate and tier apply and how the fee is worked out. */
export default function FeeCalculator({ rates, brands }: { rates: Rate[]; brands: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ brand: brands[0] || '', date: today, period: 'BAU', platform: 'TikTok', hours: '2', tt: '', sp: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const num = (x: string) => (x.trim() === '' ? null : Number(x.replace(/[$,]/g, '')));
  const res = useMemo(() => {
    const sale = { date: v.date, start_min: 0, end_min: Math.round((Number(v.hours) || 0) * 60), brand: v.brand, period: v.period, platform: v.platform,
      tiktok_gmv: num(v.tt), shopee_gmv: num(v.sp) };
    return computeFee(rateGroupFor(rates, sale), sale);
  }, [v, rates]);
  const r = res.rate;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Fee calculator</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Try a stream against the rates below to check what a host would be paid.</p>
      <div className="calc-form">
        <label className="field">Brand<select value={v.brand} onChange={set('brand')}>{brands.map(b => <option key={b}>{b}</option>)}</select></label>
        <label className="field">Date<input type="date" value={v.date} onChange={set('date')} /></label>
        <label className="field">Period<select value={v.period} onChange={set('period')}><option>BAU</option><option>Mega</option></select></label>
        <label className="field">Platform<select value={v.platform} onChange={set('platform')}><option>TikTok</option><option>Shopee</option><option>TikTok & Shopee</option></select></label>
        <label className="field">Hours<input inputMode="decimal" value={v.hours} onChange={set('hours')} /></label>
        <label className="field">TikTok GMV<input inputMode="decimal" placeholder="$0.00" value={v.tt} onChange={set('tt')} /></label>
        <label className="field">Shopee GMV<input inputMode="decimal" placeholder="$0.00" value={v.sp} onChange={set('sp')} /></label>
      </div>
      <div className="calc-out">
        {!r ? <span className="badge bad">No rate</span> : (
          <>
            <div><span className="lab">Rate</span>{r.label || 'Unnamed'}{r.tier ? ' · ' + r.tier : ''} <span className="muted small">({r.period}, {r.stream_type === 'any' ? 'any platform' : r.stream_type === 'dual' ? 'both platforms' : 'one platform'})</span></div>
            <div><span className="lab">GMV / hour</span>{money(res.gmvPerHour)}{r.stream_type === 'dual' ? <span className="muted small"> (hours counted twice for a dual stream)</span> : null}</div>
            <div><span className="lab">Gross</span>
              {r.method === 'split'
                ? <>{pctLabel(r.tiktok_comms)} of TikTok + {pctLabel(r.shopee_comms)} of Shopee = {money(res.gross)}</>
                : <>{money(r.base_per_hour)}/h &times; {res.hours} h + {pctLabel(r.total_comms)} of {money(res.totalGmv)} = {money(res.gross)}</>}
            </div>
            <div><span className="lab">Agency</span>{pctLabel(r.agency_comms)} = {money(res.agency)}</div>
            <div className="fee"><span className="lab">Talent fee</span>{money(res.fee)}</div>
          </>
        )}
      </div>
    </div>
  );
}
