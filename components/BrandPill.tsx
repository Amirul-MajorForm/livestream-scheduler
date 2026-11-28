/** A brand name as a pill tinted with the brand's colour (text stays in the normal ink). */
export default function BrandPill({ brand, color, children }: { brand: string; color?: string; children?: React.ReactNode }) {
  return (
    <span className="brand-pill" style={color ? ({ '--bc': color } as React.CSSProperties) : undefined}>
      {brand}{children}
    </span>
  );
}
