import { query } from './db';
import { BRAND_PALETTE } from './colors';

/**
 * Each brand's colour (the palette's edge colour), fixed by its place in the Brands list so it's the
 * same on every page and every month. Brands only seen in imported data come after, alphabetically.
 */
export async function loadBrandColors(extra: string[] = []): Promise<Record<string, string>> {
  const known = (await query<{ name: string }>('SELECT name FROM brands ORDER BY sort_order, name')).map(b => b.name);
  const others = [...new Set(extra)].filter(b => !known.includes(b)).sort((a, b) => a.localeCompare(b));
  const out: Record<string, string> = {};
  [...known, ...others].forEach((b, i) => { out[b] = BRAND_PALETTE[i % BRAND_PALETTE.length].edge; });
  return out;
}
