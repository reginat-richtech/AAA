import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { linkedinStatus } from '../../../../lib/integrations/linkedin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Connection status for the Social Media page's "Connect LinkedIn" control.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    return NextResponse.json(await linkedinStatus());
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
