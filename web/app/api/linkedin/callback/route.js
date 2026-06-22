import { NextResponse } from 'next/server';
import {
  exchangeCode, saveLinkedinCredential, discoverOrganization, linkedinRedirectUri,
} from '../../../../lib/integrations/linkedin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(ok, message) {
  const color = ok ? '#16a34a' : '#dc2626';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>LinkedIn</title>
    <style>body{font:15px/1.5 system-ui,sans-serif;background:#e9f0fb;color:#10243f;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #cddcef;border-radius:12px;padding:28px 32px;max-width:460px;text-align:center;box-shadow:0 12px 28px -16px rgba(16,40,70,.2)}
    .i{font-size:34px;color:${color}}a{color:#1d4ed8}</style></head>
    <body><div class="card"><div class="i">${ok ? '✓' : '✗'}</div><p>${message}</p>
    <p><a href="/linkedin">Back to LinkedIn →</a></p></div></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(req) {
  const u = new URL(req.url);
  const code = u.searchParams.get('code') || '';
  const state = u.searchParams.get('state') || '';
  const error = u.searchParams.get('error') || '';
  const errDesc = u.searchParams.get('error_description') || '';

  if (error) return page(false, `LinkedIn authorization was declined (${error}${errDesc ? `: ${errDesc}` : ''}).`);
  if (!code) return page(false, 'Missing authorization code from LinkedIn.');

  const cookieState = req.cookies.get('li_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return page(false, 'Security check failed (state mismatch). Start again from the LinkedIn page.');
  }

  const redirectUri = linkedinRedirectUri(req.url);
  try {
    const tok = await exchangeCode(code, redirectUri);
    // Discover the Company Page the user administers (best-effort; falls back to LINKEDIN_ORG_ID).
    let org = null;
    try { org = await discoverOrganization(tok.access_token); } catch { /* needs rw_organization_admin */ }
    await saveLinkedinCredential({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_in: tok.expires_in,
      org_id: org?.id || process.env.LINKEDIN_ORG_ID || null,
      company_name: org?.name || null,
    });
    const res = page(true, `LinkedIn connected${org?.name ? ` — ${org.name}` : ''}. You can now compose and schedule Company Page posts.`);
    res.cookies.set('li_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    return page(false, `Token exchange failed: ${String(e?.message || e)}`);
  }
}
