import { requireAdmin } from '@/lib/auth';
import TopBar from '@/components/TopBar';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <>
      <TopBar user={user} links={[
        { href: '/admin', label: 'Months' },
        { href: '/admin/hosts', label: 'Hosts' },
        { href: '/admin/settings', label: 'Brands, rooms & team' },
        { href: '/admin/rules', label: 'Planning rules' },
        { href: '/admin/import', label: 'Import' },
      ]} />
      <main>{children}</main>
    </>
  );
}
