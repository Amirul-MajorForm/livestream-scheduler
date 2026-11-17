import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUser } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { monthRange } from '@/lib/data';
import { parseAvailabilityMessage, MissingApiKeyError } from '@/lib/parseAvailability';

export const maxDuration = 120;

/** Ops only: reads a pasted availability message for one host and month and returns proposed slots (nothing is saved). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const hostId = Number(body?.hostId), monthId = Number(body?.monthId);
  const text = String(body?.text ?? '').trim();
  if (!hostId || !monthId || !text) return NextResponse.json({ error: 'Paste a message first.' }, { status: 400 });
  if (text.length > 8000) return NextResponse.json({ error: 'That message is too long (8,000 characters max).' }, { status: 400 });

  const [host, m] = await Promise.all([one('SELECT name FROM hosts WHERE id = $1', [hostId]), one('SELECT * FROM months WHERE id = $1', [monthId])]);
  if (!host || !m) return NextResponse.json({ error: 'Host or month not found' }, { status: 404 });
  const { start, end } = monthRange(m.year, m.month);
  const [saleDays, current] = await Promise.all([
    query('SELECT name, day FROM sale_days WHERE month_id = $1', [monthId]),
    query('SELECT date, slot FROM availability WHERE host_id = $1 AND date BETWEEN $2 AND $3', [hostId, start, end]),
  ]);

  try {
    const result = await parseAvailabilityMessage({
      hostName: host.name, year: m.year, month: m.month, text,
      saleDays: saleDays.map(s => ({ name: s.name, day: s.day })),
      current: current.map(c => ({ date: c.date, slot: c.slot })),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MissingApiKeyError)
      return NextResponse.json({ error: 'Reading messages needs an Anthropic API key. Add ANTHROPIC_API_KEY to the app’s variables in Railway, then redeploy.' }, { status: 503 });
    if (e instanceof Anthropic.AuthenticationError)
      return NextResponse.json({ error: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Railway.' }, { status: 503 });
    if (e instanceof Anthropic.RateLimitError)
      return NextResponse.json({ error: 'Too many requests right now. Wait a minute and try again.' }, { status: 429 });
    if (e instanceof Anthropic.APIError)
      return NextResponse.json({ error: `The AI service returned an error (${e.status}). Try again shortly.` }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message || 'Could not read the message.' }, { status: 500 });
  }
}
