import { fmtDate, fmtRange } from '@/lib/format';

export interface StreamRow {
  id: number;
  date: string;
  start_min: number;
  end_min: number;
  host_name: string;
  brand: string;
  period: string;
  sale: string;
  platform: string;
  room: string;
}

/** Streams grouped by day, as cards. Used on the host portal. */
export default function StreamList({ streams, showHost = false }: { streams: StreamRow[]; showHost?: boolean }) {
  if (!streams.length) return <p className="muted">No streams.</p>;
  const byDay = new Map<string, StreamRow[]>();
  streams.forEach(s => byDay.set(s.date, [...(byDay.get(s.date) || []), s]));
  return (
    <div>
      {[...byDay.entries()].map(([date, rows]) => (
        <div key={date} className="day-group">
          <div className="day-head">{fmtDate(date)}</div>
          {rows.map(s => (
            <div key={s.id} className="stream">
              <div className="time">{fmtRange(s.start_min, s.end_min)}</div>
              <div>
                <strong>{s.brand}</strong> <span className="muted">on</span> {s.platform}
                {showHost && <> &middot; {s.host_name || <span className="badge bad">No host</span>}</>}
                <div className="small muted">
                  {s.room || 'Room TBC'}
                  {' · '}
                  <span className={'badge ' + (s.period === 'MEGA' ? 'mega' : '')}>{s.period}</span>
                  {s.period === 'MEGA' && s.sale && <> {s.sale}</>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
