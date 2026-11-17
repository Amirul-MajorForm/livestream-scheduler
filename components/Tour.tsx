'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/**
 * Guided tour that walks through the app page by page, highlighting one element at a time.
 * Started from the "Tour" button in the top bar (or a 'start-tour' window event).
 * Progress is kept in localStorage so it survives page navigation.
 */

interface Loc { pathname: string; params: URLSearchParams }
interface Step {
  /** Is the current page the one this step belongs to? */
  on: (l: Loc) => boolean;
  /** URL to open this step's page, worked out from the page the user is on (null = can't). */
  go: (l: Loc) => string | null;
  /** data-tour value of the element to highlight; omitted = centred card. */
  target?: string;
  title: string;
  body: string;
}

const KEY = 'ls-tour';
const monthId = (l: Loc) => l.pathname.match(/^\/admin\/months\/(\d+)/)?.[1] || null;
const monthTab = (tab: string) => (l: Loc) => !!monthId(l) && (l.params.get('tab') || 'setup') === tab && !l.params.get('host');
const toMonthTab = (tab: string) => (l: Loc) => {
  const id = monthId(l) || firstHref('a[href^="/admin/months/"]')?.match(/\d+/)?.[0];
  return id ? `/admin/months/${id}?tab=${tab}` : null;
};
const isRun = (l: Loc) => /^\/admin\/runs\/\d+$/.test(l.pathname);
const runView = (v: string) => (l: Loc) => isRun(l) && (l.params.get('view') || 'list') === v;
const toRun = (view: string) => (l: Loc) => {
  const base = isRun(l) ? l.pathname : firstHref('[data-tour="versions"] a[href^="/admin/runs/"]');
  return base ? base + (view === 'list' ? '' : '?view=' + view) : null;
};
function firstHref(sel: string) {
  return typeof document === 'undefined' ? null : document.querySelector(sel)?.getAttribute('href') || null;
}

const ADMIN_STEPS: Step[] = [
  { on: l => l.pathname === '/admin', go: () => '/admin', target: 'title', title: 'Welcome',
    body: 'This tour walks you through the app in the order you’ll use it each month. Use Next and Back, or close it any time with ×. You can restart it from the Tour button at the top.' },
  { on: l => l.pathname.startsWith('/admin'), go: () => '/admin', target: 'nav', title: 'The main menu',
    body: 'Months: plan each month. Hosts: people, caps and brands. Brands, rooms & team: the lists the app uses and ops logins. Import: bring in the Google Sheet (one time).' },
  { on: l => l.pathname === '/admin/hosts', go: () => '/admin/hosts', target: 'hosts-table', title: 'Hosts',
    body: 'Each host’s monthly cap, max % of any one brand, platforms, and which brands they can do (P = Preferred, R = Regular, blank = never). Click a column heading to sort.' },
  { on: l => l.pathname === '/admin/hosts', go: () => '/admin/hosts', target: 'hosts-first', title: 'Edit a host and give them a login',
    body: 'Click a name to change their settings. At the bottom of that page, the Login box creates their sign-in (email + temporary password). Send it to them so they can enter availability.' },
  { on: l => l.pathname === '/admin', go: () => '/admin', target: 'months-new', title: 'Start a new month',
    body: 'Pick the month and copy from last month: commitments and sale days come across, so you only adjust what changed.' },
  { on: l => l.pathname === '/admin', go: () => '/admin', target: 'months-table', title: 'Open a month',
    body: 'All planning happens inside a month. Next opens the most recent one.' },
  { on: monthTab('setup'), go: toMonthTab('setup'), target: 'month-tabs', title: 'Five tabs, in working order',
    body: 'Work left to right: set sale dates, commitments and confirmed bookings, collect availability, then make the schedule.' },
  { on: monthTab('setup'), go: toMonthTab('setup'), target: 'sale-days', title: 'Mega sale days',
    body: 'Any date listed here is a Mega day (with its sale name); every other day is BAU. Check these are on the right dates each month.' },
  { on: monthTab('commitments'), go: toMonthTab('commitments'), target: 'commitments', title: 'Commitments',
    body: 'How many 2-hour sessions each brand needs, per platform, for BAU and for Mega sales. Change the number and click Save on that row. Priority 1 is filled first.' },
  { on: monthTab('preplanned'), go: toMonthTab('preplanned'), target: 'preplanned', title: 'Pre-planned streams',
    body: 'Bookings already agreed with a brand. They go in first, exactly as entered. Leave the host on Auto-assign to let the app choose someone suitable.' },
  { on: monthTab('availability'), go: toMonthTab('availability'), target: 'avail-matrix', title: 'Who has given availability',
    body: 'One row per host, one column per day; the number is how many 2-hour slots they ticked. “Not yet” means chase them. Click a name to fill it in for them.' },
  { on: monthTab('availability'), go: toMonthTab('availability'), target: 'avail-lock', title: 'Lock availability',
    body: 'When everyone has replied, lock it so hosts can’t change it while you schedule. You can re-open it later.' },
  { on: monthTab('schedule'), go: toMonthTab('schedule'), target: 'run-scheduler', title: 'Make the schedule',
    body: 'Click Run scheduler. It takes a few seconds and follows the same rules as the old Google Sheet script.' },
  { on: monthTab('schedule'), go: toMonthTab('schedule'), target: 'versions', title: 'Versions',
    body: 'Every run is kept as a version, so you can try changes and compare. Next opens the newest one (run the scheduler first if this list is empty).' },
  { on: runView('list'), go: toRun('list'), target: 'run-stats', title: 'The result at a glance',
    body: 'Sessions and hours fulfilled, what’s left unfulfilled, streams with no host, and streams with warnings. Hover a tile for details; click it to filter the list.' },
  { on: runView('list'), go: toRun('list'), target: 'run-views', title: 'List or calendar',
    body: 'List is best for checking and editing (click a column heading to sort, e.g. by host). Calendar shows the month at a glance. Summary explains every unfulfilled commitment.' },
  { on: runView('list'), go: toRun('list'), target: 'run-table', title: 'Tags and fixes',
    body: 'Amber and red tags are things to check: hover a tag to see exactly what’s wrong (e.g. who a host is double-booked with). Fix a row with Edit, or change settings and run again.' },
  { on: runView('list'), go: toRun('list'), target: 'run-publish', title: 'Confirm the schedule',
    body: 'Publish to hosts makes this the confirmed schedule: each host sees their streams under My schedule. That’s the whole cycle. Click Done to finish.' },
];

const toHost = (tab: string) => (l: Loc) => {
  const q = new URLSearchParams();
  if (l.params.get('m')) q.set('m', l.params.get('m')!);
  if (tab !== 'schedule') q.set('tab', tab);
  const s = q.toString();
  return '/host' + (s ? '?' + s : '');
};
const hostTab = (tab: string) => (l: Loc) => l.pathname === '/host' && (l.params.get('tab') || 'schedule') === tab;

const HOST_STEPS: Step[] = [
  { on: hostTab('schedule'), go: toHost('schedule'), target: 'title', title: 'Welcome',
    body: 'This quick tour shows you how to give your availability and find your schedule. Use Next, or close it any time with ×.' },
  { on: l => l.pathname === '/host', go: toHost('schedule'), target: 'host-tabs', title: 'Two tabs',
    body: 'My availability is where you tell us when you can stream. My schedule shows your confirmed streams.' },
  { on: hostTab('availability'), go: toHost('availability'), target: 'avail-grid', title: 'Tap the times you can do',
    body: 'Each box is a 2-hour slot. Tap to tick it (green). Tap a date to fill the whole day, or a time at the top to fill that time every day. Use “Copy to all” to repeat a weekday.' },
  { on: hostTab('availability'), go: toHost('availability'), target: 'avail-save', title: 'Save',
    body: 'Press Save availability when you’re done. You can come back and change it until the ops team locks the month.' },
  { on: hostTab('schedule'), go: toHost('schedule'), target: 'host-schedule', title: 'Your schedule',
    body: 'Once the ops team confirms the schedule, your streams appear here with date, time, brand, platform and room. Switch between List and Calendar. That’s it!' },
];

export default function Tour({ role }: { role: 'admin' | 'host' }) {
  const steps = role === 'admin' ? ADMIN_STEPS : HOST_STEPS;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  const save = (v: number | null) => {
    setI(v);
    try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify({ role, i: v })); } catch { /* storage unavailable */ }
  };

  // Restore an in-progress tour after navigation; listen for "start" requests from other buttons.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.role === role && Number.isInteger(saved.i) && saved.i < steps.length) setI(saved.i);
    } catch { /* ignore */ }
    const start = () => goTo(0);
    window.addEventListener('start-tour', start);
    return () => window.removeEventListener('start-tour', start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loc: Loc = { pathname, params: new URLSearchParams(params.toString()) };
  const step = i == null ? null : steps[i];
  const onPage = !!step && step.on(loc);

  const goTo = useCallback((n: number) => {
    if (n < 0 || n >= steps.length) { save(null); return; }
    const here: Loc = { pathname: window.location.pathname, params: new URLSearchParams(window.location.search) };
    const target = steps[n];
    if (!target.on(here)) {
      const url = target.go(here);
      if (url) router.push(url);
    }
    save(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, steps]);

  // Find and follow the highlighted element.
  useEffect(() => {
    setRect(null);
    setMissing(false);
    if (!step || !onPage) return;
    if (!step.target) { setMissing(true); return; }
    let scrolled = false, tries = 0;
    const tick = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
      if (!el) { if (++tries > 12) setMissing(true); return; }
      if (!scrolled) {
        scrolled = true;
        const r = el.getBoundingClientRect();
        const top = r.height > window.innerHeight - 260 ? r.top + window.scrollY - 80 : r.top + window.scrollY - (window.innerHeight - r.height) / 3;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
      setMissing(false);
      setRect(el.getBoundingClientRect());
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, onPage, pathname, params]);

  const startButton = (
    <button type="button" className="link" onClick={() => goTo(0)} title="A step-by-step walkthrough of the app">Tour</button>
  );
  if (i == null || !step) return startButton;

  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const w = Math.min(360, vw - 24);
  const h = card.current?.offsetHeight ?? 200;
  let pos: React.CSSProperties = { left: (vw - w) / 2, top: Math.max(12, (vh - h) / 2), width: w };
  if (rect && onPage) {
    const below = rect.bottom + h + 16 < vh;
    const above = rect.top - h - 16 > 0;
    const top = below ? rect.bottom + 12 : above ? rect.top - h - 12 : vh - h - 12;
    pos = { left: Math.min(Math.max(12, rect.left), vw - w - 12), top: Math.min(Math.max(12, top), vh - h - 12), width: w };
  }
  const pad = 6;

  // Rendered into <body> so the top bar's styles and stacking don't affect the overlay.
  return (
    <>
      {startButton}
      {createPortal(<>
      {rect && onPage
        ? <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div ref={card} className="tour-card" style={pos} role="dialog" aria-label={step.title}>
        <div className="tour-head">
          <span className="small muted">Step {i + 1} of {steps.length}</span>
          <button type="button" className="link" aria-label="Close tour" onClick={() => save(null)}>{'×'}</button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {!onPage && (
          <p className="small muted">This step is on another page.{' '}
            <button type="button" className="link" onClick={() => goTo(i)}>Take me there</button>
          </p>
        )}
        {onPage && missing && step.target && <p className="small muted">(That part isn&rsquo;t on this page right now, e.g. because there&rsquo;s no data yet.)</p>}
        <div className="tour-actions">
          <button type="button" onClick={() => goTo(i - 1)} disabled={i === 0}>Back</button>
          <button type="button" className="primary" onClick={() => goTo(i + 1)}>{i === steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>
      </>, document.body)}
    </>
  );
}
