import { requireHost } from '@/lib/auth';
import { one } from '@/lib/db';
import { todayYearMonth } from '@/lib/data';
import { loadHostEarnings, hostYears } from '@/lib/hostEarnings';
import { HOST_LINKS } from '@/lib/hostNav';
import AppShell from '@/components/AppShell';
import EarningsView from '@/components/EarningsView';

export const dynamic = 'force-dynamic';

/** The host's earnings dashboard: the year at a glance, by month, by brand and stream by stream. */
export default async function HostEarnings({ searchParams }: { searchParams: Promise<{ y?: string; em?: string; eb?: string }> }) {
  const user = await requireHost();
  const sp = await searchParams;
  const host = await one('SELECT id, name FROM hosts WHERE id = $1', [user.hostId]);
  const now = todayYearMonth();
  const years = await hostYears();
  const year = years.includes(Number(sp.y)) ? Number(sp.y) : (years.includes(now.year) ? now.year : years[0] ?? now.year);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const streams = host ? await loadHostEarnings({ id: host.id, name: host.name }, year, today) : [];
  return (
    <AppShell user={user} links={HOST_LINKS}>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1 data-tour="title">My earnings</h1>
        </div>
      </div>
      <EarningsView streams={streams} year={year} years={years} sp={sp} />
    </AppShell>
  );
}
