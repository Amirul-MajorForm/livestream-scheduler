import { getUser } from '@/lib/auth';
import { TEMPLATE_CSV } from '@/lib/preplannedFile';

/** A ready-to-fill CSV with the expected columns and three example rows. */
export async function GET() {
  const user = await getUser();
  if (!user || user.role !== 'admin') return new Response('Not allowed', { status: 403 });
  return new Response(TEMPLATE_CSV, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="pre-planned-streams-template.csv"' },
  });
}
