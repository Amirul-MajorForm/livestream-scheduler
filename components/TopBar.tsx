import Link from 'next/link';
import { Suspense } from 'react';
import Tour from './Tour';
import type { SessionUser } from '@/lib/auth';

export default function TopBar({ user, links }: { user: SessionUser; links: { href: string; label: string }[] }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">Livestream Scheduler</Link>
      <nav data-tour="nav">
        {links.map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
      </nav>
      <div className="who">
        <Suspense fallback={null}><Tour role={user.role} /></Suspense>
        <Link href="/account">{user.name || user.email}</Link>
        <form action="/logout" method="post"><button className="link" type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
