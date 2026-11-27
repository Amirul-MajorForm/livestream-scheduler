import { fmtDate, fmtRange } from '@/lib/format';
import type { BrandColor } from '@/lib/colors';
import PlatformTag from './PlatformTag';

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
 * A host's streams, one compact row each: date, time, brand, platform, room, BAU/Mega and status.
 * On a phone the row wraps onto two short lines.
 */
export default function StreamList({ streams, showHost = false, colors }: { streams: StreamRow[]; showHost?: boolean; colors?: Record<string, BrandColor> }) {
  if (!streams.length) return <p className="muted">No streams.</p>;
  return (
    <div className="slist" role="table" aria-label="Your streams">
      <div className="slist-row head" role="row">
        <span role="columnheader">Date</span><span role="columnheader">Time</span><span role="columnheader">Brand</span>
        <span role="columnheader">Platform</span><span role="columnheader">Room</span><span role="columnheader">Sale</span><span role="columnheader">Status</span>
      </div>
      {streams.map((s, i) => {
        const newDay = i === 0 || streams[i - 1].date !== s.date;
        const c = colors?.[s.brand];
        return (
          <div key={s.id} role="row" className={'slist-row' + (newDay ? ' new-day' : '') + (s.status === 'confirmed' ? ' confirmed' : '')}
            style={c ? { borderLeftColor: c.edge } : undefined}>
            <span className="d" role="cell">{newDay ? fmtDate(s.date) : ''}</span>
            <span className="t" role="cell">{fmtRange(s.start_min, s.end_min)}</span>
            <span className="b" role="cell"><strong>{s.brand}</strong>{showHost && <span className="muted"> &middot; {s.host_name || 'No host'}</span>}</span>
            <span className="p" role="cell"><PlatformTag platform={s.platform} /></span>
            <span className="r" role="cell">{s.room || <span className="muted">Room TBC</span>}</span>
            <span className="s" role="cell">
              {s.period === 'MEGA' ? <><span className="badge mega">MEGA</span> <span className="small muted">{s.sale}</span></> : <span className="badge">BAU</span>}
            </span>
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
