import { NextResponse } from 'next/server';
import { exchangeCode, saveQbCredential, qbApiBase, qbEnvironment, qbRedirectUri } from '../../../../lib/integrations/qbAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(ok, message) {
  const color = ok ? '#16a34a' : '#dc2626';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>QuickBooks</title>
    <style>body{font:15px/1.5 system-ui,sans-serif;background:#e9f0fb;color:#10243f;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #cddcef;border-radius:12px;padding:28px 32px;max-width:460px;text-align:center;box-shadow:0 12px 28px -16px rgba(16,40,70,.2)}
    .i{font-size:34px;color:${color}}a{color:#1d4ed8}</style></head>
    <body><div class="card"><div class="i">${ok ? '✓' : '✗'}</div><p>${message}</p>
    <p><a href="/finance-ai">Back to Finance AI →</a></p></div></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(req) {
  const u = new URL(req.url);
  const code = u.searchParams.get('code') || '';
  const realmId = u.searchParams.get('realmId') || '';
  const state = u.searchParams.get('state') || '';
  const error = u.searchParams.get('error') || '';

  if (error) return page(false, `QuickBooks authorization was declined (${error}).`);
  if (!code || !realmId) return page(false, 'Missing authorization code or realm id from QuickBooks.');

  const cookieState = req.cookies.get('qb_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return page(false, 'Security check failed (state mismatch). Start again from Finance AI.');
  }

  const redirectUri = qbRedirectUri(req.url);
  try {
    const tok = await exchangeCode(code, redirectUri);
    if (!tok.refresh_token) return page(false, 'QuickBooks did not return a refresh token.');

    const environment = qbEnvironment();
    let company = '';
    try {
      const ci = await fetch(`${qbApiBase(environment)}/v3/company/${realmId}/companyinfo/${realmId}`,
        { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' } });
      if (ci.ok) { const j = await ci.json(); company = j.CompanyInfo?.CompanyName || j.CompanyInfo?.LegalName || ''; }
    } catch { /* company name is best-effort */ }

    await saveQbCredential({ refresh_token: tok.refresh_token, realm_id: realmId, environment, company_name: company });

    const res = page(true, `QuickBooks connected${company ? ` — ${company}` : ''}. Now run a QuickBooks sync to load invoices.`);
    res.cookies.set('qb_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    return page(false, `Token exchange failed: ${String(e?.message || e)}`);
  }
}
