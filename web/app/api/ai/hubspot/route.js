import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { hubspotBrief } from '../../../../lib/integrations/hubspot';
import { runSync } from '../../../../lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Normal load reads the brief from the DB (fast). ?sync=1 (the Refresh button)
// pulls fresh from HubSpot into the DB first, then recomputes.
export async function GET(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const sync = new URL(request.url).searchParams.get('sync') === '1';
  if (sync) { try { await runSync(['hubspot']); } catch { /* fall back to last-synced data */ } }
  return NextResponse.json(await hubspotBrief({ force: sync }));
}
