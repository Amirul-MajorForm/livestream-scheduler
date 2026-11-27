/**
 * Brand colours for calendars. Assigned by the brand's position in the Brands list (stable month to
 * month), from a palette of distinct edge colours, each with a matching tint for the background.
 */
/** Light tint of the edge colour on the page surface: pastel in light mode, a deep wash in dark mode. */
const tint = (edge: string) => ({ bg: `color-mix(in srgb, ${edge} 15%, var(--surface))`, edge });

export const BRAND_PALETTE = [
  tint('#3b6fe0'), // blue
  tint('#d6336c'), // pink
  tint('#2f9e5b'), // green
  tint('#e08a00'), // amber
  tint('#7a4ce0'), // purple
  tint('#1c9a9a'), // teal
  tint('#d9541e'), // orange-red
  tint('#6d8a1f'), // olive
  tint('#a3449f'), // magenta
  tint('#3f6f94'), // slate blue
  tint('#9a6b2f'), // brown
  tint('#5c5c5c'), // grey
];

export type BrandColor = (typeof BRAND_PALETTE)[number];

export function brandColors(brandNamesInOrder: string[]): Record<string, BrandColor> {
  const out: Record<string, BrandColor> = {};
  brandNamesInOrder.forEach((b, i) => { out[b] = BRAND_PALETTE[i % BRAND_PALETTE.length]; });
  return out;
}
