/** Coloured platform tag: TikTok (dark), Shopee (orange), or both for a simultaneous stream. */
export default function PlatformTag({ platform, short = false }: { platform: string; short?: boolean }) {
  const p = platform.toLowerCase();
  const tt = p.includes('tiktok'), sp = p.includes('shopee');
  return (
    <span className="ptags" title={platform}>
      {tt && <span className="ptag tt">{short ? 'TT' : 'TikTok'}</span>}
      {sp && <span className="ptag sp">{short ? 'SP' : 'Shopee'}</span>}
      {!tt && !sp && <span className="ptag">{platform}</span>}
    </span>
  );
}
