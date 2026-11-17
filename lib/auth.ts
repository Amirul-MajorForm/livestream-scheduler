import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { one } from './db';

export const SESSION_COOKIE = 'ls_session';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'host';
  hostId: number | null;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set to a long random string');
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const row = await one('SELECT id, email, name, role, host_id FROM users WHERE id = $1', [payload.uid]);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name, role: row.role, hostId: row.host_id };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/host');
  return u;
}

export async function requireHost() {
  const u = await requireUser();
  if (u.role !== 'host' || !u.hostId) redirect(u.role === 'admin' ? '/admin' : '/login');
  return u as SessionUser & { hostId: number };
}
