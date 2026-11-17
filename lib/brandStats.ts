import { parsePlatforms, type SummarySection } from './scheduler';

/** Hours per committed session (each session is one 2-hour stream). */
export const SESSION_HOURS = 2;

export interface PeriodStats { committed: number; fulfilled: number }
export interface BrandStats {
  brand: string;
  bau: PeriodStats;
  mega: PeriodStats;
  /** sessions committed / fulfilled across both periods */
  committed: number;
  fulfilled: number;
  /** streams for this brand that don't count toward any commitment (e.g. extra pre-planned), and their hours */
  extraStreams: number;
  extraHours: number;
  /** per commitment line, for the tooltip */
  lines: { period: string; platform: string; sale: string; committed: number; fulfilled: number }[];
}

interface Stream { brand: string; period: string; sale: string; platform: string; start_min: number; end_min: number; host_name: string }

const pkey = (p: string) => [...(parsePlatforms(p) || [])].sort().join(',');

/**
 * Counts, live, how many committed sessions each brand's streams cover in a version.
 * Commitments are taken from the run's summary (as they were when the scheduler ran). Each stream
 * with a host counts toward the first commitment line it matches (same brand, BAU/Mega, platform, and
 * for Mega one of the listed sales) that still has room, so edits to the version are reflected.
 */
export function brandStats(sections: SummarySection[], streams: Stream[]): BrandStats[] {
  const rows = sections.find(s => s.title.toLowerCase().startsWith('brand / campaign'))?.rows || [];
  const lines = rows.map(r => ({
    brand: String(r[0]), period: String(r[1]).toLowerCase(), sale: String(r[2]), platform: String(r[3]),
    committed: Number(r[4]) || 0, fulfilled: 0,
  }));
  const byBrand = new Map<string, BrandStats>();
  const get = (brand: string) => {
    const k = brand.toLowerCase();
    if (!byBrand.has(k)) byBrand.set(k, { brand, bau: { committed: 0, fulfilled: 0 }, mega: { committed: 0, fulfilled: 0 }, committed: 0, fulfilled: 0, extraStreams: 0, extraHours: 0, lines: [] });
    return byBrand.get(k)!;
  };
  for (const s of streams) {
    if (!s.host_name) continue; // unhosted streams don't fulfil anything
    const period = s.period.toLowerCase();
    const line = lines.find(l => l.fulfilled < l.committed && l.brand.toLowerCase() === s.brand.toLowerCase() && l.period === period &&
      pkey(l.platform) === pkey(s.platform) &&
      (period === 'bau' || l.sale === 'all' || l.sale.split(',').map(x => x.trim().toLowerCase()).includes(s.sale.trim().toLowerCase())));
    if (line) line.fulfilled++;
    else {
      const b = get(s.brand);
      b.extraStreams++;
      b.extraHours += (s.end_min - s.start_min) / 60;
    }
  }
  for (const l of lines) {
    if (!l.committed) continue;
    const b = get(l.brand);
    const p = l.period === 'mega' ? b.mega : b.bau;
    p.committed += l.committed; p.fulfilled += l.fulfilled;
    b.committed += l.committed; b.fulfilled += l.fulfilled;
    b.lines.push({ period: l.period, platform: l.platform, sale: l.sale, committed: l.committed, fulfilled: l.fulfilled });
  }
  return [...byBrand.values()].filter(b => b.committed > 0 || b.extraStreams > 0)
    .sort((a, b) => (b.committed - b.fulfilled) - (a.committed - a.fulfilled) || b.committed - a.committed || a.brand.localeCompare(b.brand));
}
