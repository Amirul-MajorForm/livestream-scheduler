import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import AppShell, { type NavLink } from '@/components/AppShell';
import Flash from '@/components/Flash';

export const dynamic = 'force-dynamic';

async function changePassword(f: FormData) {
  'use server';
  const user = await requireUser();
  const current = String(f.get('current') || ''), next = String(f.get('next') || '');
  const row = await one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) redirect('/account?bad=' + encodeURIComponent('Current password is wrong'));
  if (next.length < 8) redirect('/account?bad=' + encodeURIComponent('New password must be at least 8 characters'));
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await bcrypt.hash(next, 10)]);
  redirect('/account?ok=' + encodeURIComponent('Password changed'));
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const links: NavLink[] = user.role === 'admin'
    ? [{ href: '/admin', label: 'Back to admin', icon: 'back' }]
    : [{ href: '/host', label: 'My schedule', icon: 'calendar' }];
  return (
    <AppShell user={user} links={links}>
      <div style={{ maxWidth: 480 }}>
        <h1>Your account</h1>
        <p className="muted">{user.email}</p>
        <Flash sp={sp} />
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Change password</h2>
          <form action={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="field">Current password<input name="current" type="password" autoComplete="current-password" required /></label>
            <label className="field">New password<input name="next" type="password" autoComplete="new-password" minLength={8} required /></label>
            <div><button className="primary" type="submit">Change password</button></div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
