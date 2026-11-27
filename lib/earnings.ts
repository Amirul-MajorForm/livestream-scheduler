/**
 * Talent fee calculation, ported from the Master Availability Sheet's "Tier", "GMV / Hour" and
 * "Talent Fee" formulas (rates from its Reference tab). Pure functions: used on the server and,
 * for live previews while typing, in the browser.
 *
 *   Pick the rate: same brand, period (BAU / Mega, or a rate for All), stream type (one platform
 *   = single, TikTok & Shopee = dual, or a rate for any), valid on the stream's date. The most
 *   specific match wins, then the latest start date.
 *   GMV / hour = total GMV / (hours x 2 for a dual rate, else hours).
 *   Tier: the first tier whose upper bound is at or above GMV / hour (no tiers = the single row).
 *   Fee:   base + comms: (base per hour x hours + total comms x total GMV) x (1 - agency comms)
 *          split comms:  (TikTok comms x TikTok GMV + Shopee comms x Shopee GMV) x (1 - agency comms)
 */

export interface Rate {
  id: number;
  brand: string;
  label: string;
  account: string;
  period: 'BAU' | 'Mega' | 'All';
  stream_type: 'single' | 'dual' | 'any';
  method: 'base_comms' | 'split';
  tier: string;
  gmv_min: number | null;
  gmv_max: number | null;
  base_per_hour: number;
  total_comms: number;
  tiktok_comms: number;
  shopee_comms: number;
  agency_comms: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  notes: string;
}

export interface SaleInput {
  date: string;          // YYYY-MM-DD
  start_min: number;
  end_min: number;
  brand: string;
  period: string;        // BAU / MEGA / Mega
  platform: string;
  tiktok_gmv: number | null;
  shopee_gmv: number | null;
}

export interface FeeResult {
  rate: Rate | null;     // the tier row used
  hours: number;
  totalGmv: number;
  gmvPerHour: number | null;
  gross: number | null;  // before the agency share
  agency: number | null;
  fee: number | null;    // talent fee
  reason?: string;       // why there's no fee
  recorded?: boolean;    // fee as recorded in the imported sheet
}

export const streamTypeOf = (platform: string): 'single' | 'dual' => {
  const p = platform.toLowerCase();
  return p.includes('tiktok') && p.includes('shopee') ? 'dual' : 'single';
};
const normPeriod = (p: string) => (p.toUpperCase() === 'MEGA' ? 'Mega' : p.toUpperCase() === 'BAU' ? 'BAU' : 'All');
const key = (r: Rate) => `${r.label}|${r.period}|${r.stream_type}|${r.valid_from || ''}`;

/** All tier rows of the rate that applies to this stream (GMV not needed yet), or [] if none. */
export function rateGroupFor(rates: Rate[], s: Pick<SaleInput, 'date' | 'brand' | 'period' | 'platform'>): Rate[] {
  const brand = s.brand.trim().toLowerCase(), period = normPeriod(s.period), type = streamTypeOf(s.platform);
  const ok = rates.filter(r => r.active && r.brand.trim().toLowerCase() === brand
    && (r.period === period || r.period === 'All')
    && (r.stream_type === type || r.stream_type === 'any')
    && (!r.valid_from || r.valid_from <= s.date) && (!r.valid_to || r.valid_to >= s.date));
  if (!ok.length) return [];
  const score = (r: Rate) => (r.period === period ? 2 : 0) + (r.stream_type === type ? 1 : 0);
  const best = [...ok].sort((a, b) =>
    score(b) - score(a)
    || (b.valid_from || '').localeCompare(a.valid_from || '')
    || b.label.localeCompare(a.label, undefined, { numeric: true })
    || b.id - a.id)[0];
  return ok.filter(r => key(r) === key(best));
}

export function pickTier(group: Rate[], gmvPerHour: number): Rate | null {
  if (!group.length) return null;
  const tiers = [...group].sort((a, b) => (a.gmv_min ?? -Infinity) - (b.gmv_min ?? -Infinity));
  return tiers.find(t => t.gmv_max == null || gmvPerHour <= t.gmv_max) || tiers[tiers.length - 1];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The rate for a stream, honouring a version recorded for it (imported from the sheet): that
 * version's rows are used whatever their dates; otherwise the normal date-based choice.
 */
export function rateGroupWithLabel(rates: Rate[], s: Pick<SaleInput, 'date' | 'brand' | 'period' | 'platform'>, label: string): Rate[] {
  if (label) {
    const g = rateGroupFor(rates.filter(r => r.label === label).map(r => ({ ...r, valid_from: null, valid_to: null, active: true })), s);
    if (g.length) return g;
  }
  return rateGroupFor(rates, s);
}

/** Use the sheet's recorded fee (or its blank fee) in place of the calculated one (agency share follows the rate's %). */
export function withRecordedFee(res: FeeResult, recordedFee: number | null, blank = false): FeeResult {
  if (blank) return { ...res, fee: null, agency: null, gross: null, recorded: true, reason: 'No fee in the sheet' };
  if (recordedFee == null) return res;
  const a = res.rate?.agency_comms;
  return { ...res, fee: recordedFee, agency: a != null && a < 1 ? round2(recordedFee * a / (1 - a)) : null,
    gross: a != null && a < 1 ? round2(recordedFee / (1 - a)) : null, recorded: true, reason: undefined };
}

export function computeFee(group: Rate[], s: SaleInput): FeeResult {
  const hours = Math.max(0, s.end_min - s.start_min) / 60;
  const tt = s.tiktok_gmv ?? 0, sp = s.shopee_gmv ?? 0, totalGmv = tt + sp;
  if (!group.length) return { rate: null, hours, totalGmv, gmvPerHour: null, gross: null, agency: null, fee: null, reason: 'No rate for this brand, period and platform on this date' };
  const divisor = hours * (group[0].stream_type === 'dual' ? 2 : 1);
  const gmvPerHour = divisor ? totalGmv / divisor : 0;
  const rate = pickTier(group, gmvPerHour)!;
  const gross = rate.method === 'split'
    ? rate.tiktok_comms * tt + rate.shopee_comms * sp
    : rate.base_per_hour * hours + rate.total_comms * totalGmv;
  const fee = gross * (1 - rate.agency_comms);
  return { rate, hours, totalGmv, gmvPerHour: round2(gmvPerHour), gross: round2(gross), agency: round2(gross - fee), fee: round2(fee) };
}

export const money = (x: number | null | undefined) =>
  x == null ? '—' : '$' + x.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pctLabel = (x: number) => `${Math.round(x * 10000) / 100}%`;

export const PAY_STATUSES = ['', 'Invoice Pending', 'Invoice Sent', 'Paid to Host, Pending Payment From Brand', 'Paid'] as const;
