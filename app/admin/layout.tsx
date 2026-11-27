import { requireAdmin } from '@/lib/auth';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <AppShell user={user} links={[
      { href: '/admin', label: 'Months', icon: 'calendar' },
      { href: '/admin/hosts', label: 'Hosts', icon: 'users' },
      { href: '/admin/settings', label: 'Brands, rooms & team', icon: 'layers' },
      { href: '/admin/rules', label: 'Planning rules', icon: 'sliders' },
      { href: '/admin/rates', label: 'Payment rates', icon: 'dollar' },
      { href: '/admin/import', label: 'Import', icon: 'upload' },
    ]}>
      {children}
    </AppShell>
  );
}
