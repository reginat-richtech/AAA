import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { qbConfigured, buildAuthorizeUrl, qbRedirectUri } from '../../../../lib/integrations/qbAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin clicks "Connect QuickBooks" → we set a one-time state cookie and bounce
// to Intuit's consent screen. Intuit returns to /api/quickbooks/callback.
export async function GET(req) {
  const { response } = await requireAdmin();
  if (response) return response;
  if (!qbConfigured()) {
    return NextResponse.json({ error: 'QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET are not set.' }, { status: 400 });
  }
  const redirectUri = qbRedirectUri(req.url);
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  res.cookies.set('qb_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: redirectUri.startsWith('https'), path: '/', maxAge: 600,
  });
  return res;
}
