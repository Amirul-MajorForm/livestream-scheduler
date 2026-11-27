import type { NavLink } from '@/components/AppShell';

/** The host's left-hand menu: scheduling and earnings are separate pages. */
export const HOST_LINKS: NavLink[] = [
  { href: '/host', label: 'My schedule', icon: 'calendar', exact: true },
  { href: '/host/earnings', label: 'My earnings', icon: 'dollar' },
];
