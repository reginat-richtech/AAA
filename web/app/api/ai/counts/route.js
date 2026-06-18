import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { hubspotCount } from '../../../../lib/integrations/hubspot';
import { travelCount } from '../../../../lib/integrations/navan';
import { financeCount } from '../../../../lib/integrations/quickbooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nav badge counts for the AI tabs. null = not wired / unavailable (no badge).
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  const [hubspot, finance, travel] = await Promise.all([
    hubspotCount().catch(() => null),
    financeCount().catch(() => null),
    travelCount(7).catch(() => null),
  ]);
  return NextResponse.json({ hubspot, finance, travel });
}
