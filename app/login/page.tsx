import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { one } from '@/lib/db';
import { createSession, getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const u = await one('SELECT id, role, password_hash FROM users WHERE email = $1', [email]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) redirect('/login?error=1');
  await createSession(u.id);
  redirect(u.role === 'admin' ? '/admin' : '/host');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUser()) redirect('/');
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card login">
        <h1>Livestream Scheduler</h1>
        <p className="muted">Sign in to continue</p>
        {error && <div className="notice bad">Wrong email or password.</div>}
        <form action={login}>
          <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
          <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}
