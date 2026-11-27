'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Tour from './Tour';
import ThemeToggle from './ThemeToggle';

export type NavIcon = 'calendar' | 'users' | 'layers' | 'sliders' | 'upload' | 'clock' | 'back' | 'dollar';

const PATHS: Record<NavIcon | 'user' | 'logout' | 'menu', React.ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.7 2.5 3 5.2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
  dollar: <><path d="M12 3v18" /><path d="M16.5 7.5c-.6-1.5-2.3-2.5-4.5-2.5-2.6 0-4.5 1.3-4.5 3.3 0 4.6 9.3 2.6 9.3 7.3 0 2-2 3.4-4.8 3.4-2.4 0-4.2-1-4.8-2.7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c.8-4 4-6 8-6s7.2 2 8 6" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export interface NavLink { href: string; label: string; icon: NavIcon; exact?: boolean }

/** MajorView layout: dark left sidebar (a drawer on phones) and the page column. */
export default function AppShell({ user, links, children }: {
  user: { name: string | null; email: string; role: 'admin' | 'host' };
  links: NavLink[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  const isActive = (l: NavLink) => l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(l.href + '/');
  // The most specific matching link wins, so /admin doesn't light up on /admin/hosts.
  const active = links.filter(isActive).sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <div className={'shell' + (open ? ' nav-open' : '')}>
      <aside className="sidebar" aria-label="Main menu">
        <Link href="/" className="sb-logo">
          <span className="sb-mark"><Icon name="clock" /></span>
          <span className="sb-word">Livestream<small>MajorForm scheduler</small></span>
        </Link>
        <div className="sb-label">Main menu</div>
        <nav className="sb-nav" data-tour="nav">
          {links.map(l => (
            <Link key={l.href} href={l.href} className={'sb-item' + (l === active ? ' active' : '')} aria-current={l === active ? 'page' : undefined}>
              <Icon name={l.icon} />{l.label}
            </Link>
          ))}
        </nav>
        <div className="sb-bottom">
          <Suspense fallback={null}><Tour role={user.role} /></Suspense>
          <ThemeToggle />
          <Link href="/account" className={'sb-item' + (pathname === '/account' ? ' active' : '')}><Icon name="user" />Account</Link>
          <form action="/logout" method="post"><button className="sb-item" type="submit"><Icon name="logout" />Sign out</button></form>
          <div className="sb-user" title={user.email}>Signed in as <strong>{user.name || user.email}</strong></div>
        </div>
      </aside>
      <div className="sb-backdrop" onClick={() => setOpen(false)} />
      <div className="main-col">
        <header className="mobile-head">
          <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} style={{ padding: 6 }}><Icon name="menu" /></button>
          <span className="title">{active?.label || 'Livestream'}</span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
