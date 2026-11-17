import Link from 'next/link';
import { formatTime } from '@/lib/format';

export interface CalStream {
  id: number;
  date: string;
  start_min: number;
  end_min: number;
  host_name: string;
  brand: string;
  period: string;
  platform: string;
  room: string;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PLATFORM_SHORT: Record<string, string> = { 'TikTok': 'TT', 'Shopee': 'SP', 'TikTok & Shopee': 'TT+SP' };

/** Month view (Monday first). Each stream shows time, brand, platform and host; flagged streams get an amber edge. */
export default function MonthCalendar({ year, month, streams, saleDays, showHost = true, flagged, hrefFor }: {
  year: number;
  month: number; // 0-based
  streams: CalStream[];
  saleDays: Record<number, string>;
  showHost?: boolean;
  flagged?: Set<number>;
  hrefFor?: (id: number) => string;
}) {
  const days = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<number, CalStream[]>();
  streams.forEach(s => {
    const d = Number(s.date.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) || []), s]);
  });
  byDay.forEach(list => list.sort((a, b) => a.start_min - b.start_min || a.brand.localeCompare(b.brand)));

  return (
    <div className="cal-wrap">
      <div className="cal">
        {DOW.map(d => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={'cal-day' + (d == null ? ' empty' : '') + (d && saleDays[d] ? ' mega' : '') + (i % 7 >= 5 ? ' weekend' : '')}>
            {d != null && (
              <>
                <div className="cal-num">
                  <span>{d}</span>
                  {saleDays[d] && <span className="cal-sale">{saleDays[d]}</span>}
                </div>
                {(byDay.get(d) || []).map(s => {
                  const body = (
                    <>
                      <span className="t">{formatTime(s.start_min)}</span> <strong>{s.brand}</strong>{' '}
                      <span className="muted">{PLATFORM_SHORT[s.platform] || s.platform}</span>
                      {showHost && <div className={s.host_name ? 'h' : 'h nohost'}>{s.host_name || 'No host'}</div>}
                      {!showHost && s.room && <div className="h">{s.room}</div>}
                    </>
                  );
                  const cls = 'cal-item' + (s.period === 'MEGA' ? ' mega' : '') + (flagged?.has(s.id) ? ' flag' : '');
                  const title = `${formatTime(s.start_min)}–${formatTime(s.end_min)} ${s.brand} on ${s.platform}${s.host_name ? ', ' + s.host_name : ''}${s.room ? ', ' + s.room : ''}`;
                  return hrefFor
                    ? <Link key={s.id} href={hrefFor(s.id)} className={cls} title={title}>{body}</Link>
                    : <div key={s.id} className={cls} title={title}>{body}</div>;
                })}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
