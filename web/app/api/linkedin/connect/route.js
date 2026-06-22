import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/access';
import { linkedinConfigured, linkedinRedirectUri, buildAuthorizeUrl } from '../../../../lib/integrations/linkedin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin clicks "Connect LinkedIn" → set a one-time state cookie and bounce to
// LinkedIn's consent screen. LinkedIn returns to /api/linkedin/callback.
export async function GET(req) {
  const { response } = await requireAdmin();
  if (response) return response;
  if (!linkedinConfigured()) {
    return NextResponse.json({ error: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET are not set.' }, { status: 400 });
  }
  const redirectUri = linkedinRedirectUri(req.url);
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  res.cookies.set('li_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: redirectUri.startsWith('https'), path: '/', maxAge: 600,
  });
  return res;
}
