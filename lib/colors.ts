/**
 * Brand colours for calendars. Assigned by the brand's position in the Brands list (stable month to
 * month), from a palette of distinct, readable tints with a stronger edge colour.
 */
export const BRAND_PALETTE = [
  { bg: '#e8f0fe', edge: '#3b6fe0' }, // blue
  { bg: '#fde8ef', edge: '#d6336c' }, // pink
  { bg: '#e6f6ec', edge: '#2f9e5b' }, // green
  { bg: '#fff1db', edge: '#e08a00' }, // amber
  { bg: '#efe8fd', edge: '#7a4ce0' }, // purple
  { bg: '#e0f5f5', edge: '#1c9a9a' }, // teal
  { bg: '#fde9e3', edge: '#d9541e' }, // orange-red
  { bg: '#eef3df', edge: '#6d8a1f' }, // olive
  { bg: '#f3e6f3', edge: '#a3449f' }, // magenta
  { bg: '#e5eef6', edge: '#3f6f94' }, // slate blue
  { bg: '#f7efe2', edge: '#9a6b2f' }, // brown
  { bg: '#ececec', edge: '#5c5c5c' }, // grey
];

export type BrandColor = (typeof BRAND_PALETTE)[number];

export function brandColors(brandNamesInOrder: string[]): Record<string, BrandColor> {
  const out: Record<string, BrandColor> = {};
  brandNamesInOrder.forEach((b, i) => { out[b] = BRAND_PALETTE[i % BRAND_PALETTE.length]; });
  return out;
}
