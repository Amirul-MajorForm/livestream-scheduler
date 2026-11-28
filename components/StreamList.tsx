import { fmtDate, fmtRange } from '@/lib/format';
import { money } from '@/lib/earnings';
import type { HostStream } from '@/lib/hostEarnings';
import { HOST_STATE } from '@/lib/hostState';
import PlatformTag from './PlatformTag';
import BrandPill from './BrandPill';

export interface StreamRow {
  id: number;
  date: string;
  start_min: number;
  end_min: number;
  host_name: string;
  brand: string;
  period: string;
  status?: string;
  sale: string;
  platform: string;
  room: string;
}

/**
 * A host's streams, one compact row each: date, time, brand, platform, room, BAU/Mega, sales,
 * their earnings and status. On a phone the row wraps onto short lines.
 */
export default function StreamList({ streams, showHost = false, brandColors, earnings }: {
  streams: StreamRow[];
  showHost?: boolean;
  /** Brand colour (edge colour) per brand, for the pills. */
  brandColors?: Record<string, string>;
  /** The host's sales and share of the fee per stream id (host view). */
  earnings?: Map<number, HostStream>;
}) {
  if (!streams.length) return <p className="muted">No streams.</p>;
  const withEarn = !!earnings;
  return (
    <div className={'slist' + (withEarn ? ' with-earn' : '')} role="table" aria-label="Your streams">
      <div className="slist-row head" role="row">
        <span role="columnheader">Date</span><span role="columnheader">Time</span><span role="columnheader">Brand</span>
        <span role="columnheader">Platform</span><span role="columnheader">Room</span><span role="columnheader">Sale</span>
        {withEarn && <><span role="columnheader" className="num">Sales (GMV)</span><span role="columnheader" className="num">Your earnings</span></>}
        <span role="columnheader">Status</span>
      </div>
      {streams.map((s, i) => {
        const newDay = i === 0 || streams[i - 1].date !== s.date;
        const e = earnings?.get(s.id);
        const st = e ? HOST_STATE[e.state] : null;
        const others = e?.coHosts.length ? e.coHosts.join(', ') : '';
        return (
          <div key={s.id} role="row" className={'slist-row' + (newDay ? ' new-day' : '') + (s.status === 'confirmed' ? ' confirmed' : '')}
            style={brandColors?.[s.brand] ? { borderLeftColor: brandColors[s.brand] } : undefined}>
            <span className="d" role="cell">{newDay ? fmtDate(s.date) : ''}</span>
            <span className="t" role="cell">{fmtRange(s.start_min, s.end_min)}</span>
            <span className="b" role="cell">
              <BrandPill brand={s.brand} color={brandColors?.[s.brand]} />
              {showHost && <span className="muted"> &middot; {s.host_name || 'No host'}</span>}
              {others && <span className="small muted" title={`Shared with ${others}: you get an equal share of the fee`}> with {others}</span>}
            </span>
            <span className="p" role="cell"><PlatformTag platform={s.platform} /></span>
            <span className="r" role="cell">{s.room || <span className="muted">Room TBC</span>}</span>
            <span className="s" role="cell">
              {s.period === 'MEGA' ? <><span className="badge mega">MEGA</span> <span className="small muted">{s.sale}</span></> : <span className="badge">BAU</span>}
            </span>
            {withEarn && (
              <>
                <span className="g num" role="cell" title={e && e.gmv != null ? `TikTok ${money(e.tiktok ?? 0)} · Shopee ${money(e.shopee ?? 0)}` : undefined}>
                  {e?.gmv != null ? money(e.gmv) : <span className="muted">{'—'}</span>}
                </span>
                <span className="e num" role="cell" title={st?.tip}>
                  {e?.fee != null ? <strong>{money(e.fee)}</strong> : null}
                  {st && <span className={'badge ' + st.cls}>{st.label}</span>}
                </span>
              </>
            )}
            <span className="st" role="cell">
              {s.status === 'confirmed'
                ? <span className="badge ok">{'✓'} Confirmed</span>
                : <span className="badge warn" title="This stream may still change. You'll see it marked Confirmed once it's locked in.">Tentative</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
