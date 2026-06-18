import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { travelReview } from '../../../../lib/integrations/navan';
import { runSync } from '../../../../lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Normal load reads from ext.navan_booking. ?sync=1 (Refresh) pulls fresh from
// Navan into the DB first, then recomputes.
export async function GET(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const url = new URL(request.url);
  const days = url.searchParams.get('days') === '30' ? 30 : 7;
  const sync = url.searchParams.get('sync') === '1';
  if (sync) { try { await runSync(['navan']); } catch { /* fall back to last-synced data */ } }
  return NextResponse.json(await travelReview(days));
}
