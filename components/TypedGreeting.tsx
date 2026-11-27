'use client';

import { useEffect, useState } from 'react';

/**
 * "Hi Naomi!" typed out letter by letter with a blinking caret.
 * Server render shows the full text (no layout jump, readable without JS);
 * people who prefer reduced motion just see the text.
 */
export default function TypedGreeting({ text, ...rest }: { text: string } & React.HTMLAttributes<HTMLHeadingElement>) {
  const [n, setN] = useState(text.length);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setN(0); setTyping(true);
    let i = 0, timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i++; setN(i);
      if (i < text.length) timer = setTimeout(step, 55 + Math.random() * 45);
      else timer = setTimeout(() => setTyping(false), 2400); // caret blinks a little, then goes
    };
    timer = setTimeout(step, 250);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <h1 className="greeting" aria-label={text} {...rest}>
      <span aria-hidden="true">{text.slice(0, n)}</span>
      {typing && <span className="caret" aria-hidden="true" />}
    </h1>
  );
}
