import { destroySession } from '@/lib/auth';

/**
 * Signs out and returns to the login page. The redirect is relative ("/login") so it works behind
 * Railway's proxy, where the server's own request URL points at an internal address.
 */
export async function POST() {
  await destroySession();
  return new Response(null, { status: 303, headers: { Location: '/login' } });
}

// Visiting /logout directly also signs out.
export const GET = POST;
