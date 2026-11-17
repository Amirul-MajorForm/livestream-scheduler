'use client';

import { useEffect, useState } from 'react';

/**
 * One tooltip for the whole app. Any element with a data-tip attribute shows its text on hover
 * (or keyboard focus). Rendered with position: fixed so it is never clipped by scrolling tables.
 * Text may contain newlines; a first line ending in ":" is shown in bold.
 */
export default function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    const show = (el: Element) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      current = el;
      const r = el.getBoundingClientRect();
      const below = r.bottom + 160 < window.innerHeight || r.top < 160;
      setTip({ text, x: Math.min(Math.max(r.left, 8), window.innerWidth - 328), y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && el !== current) show(el);
      if (!el && current) { current = null; setTip(null); }
    };
    const hide = () => { current = null; setTip(null); };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', over);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tip) return null;
  const [first, ...rest] = tip.text.split('\n');
  const heading = first.endsWith(':') || rest.length > 0;
  return (
    <div className="tooltip" role="tooltip"
      style={{ left: tip.x, top: tip.y, transform: tip.below ? undefined : 'translateY(-100%)' }}>
      {heading ? <><strong>{first}</strong>{rest.length > 0 && <div>{rest.join('\n')}</div>}</> : first}
    </div>
  );
}
