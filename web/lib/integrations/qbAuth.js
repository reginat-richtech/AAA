// QuickBooks OAuth + credential store — ported from the old app's
// /quickbooks/oauth/{authorize,callback} flow (admin.py). The connect routes
// (app/api/quickbooks/*) drive the browser consent; the sync job reads the
// stored credential. Refresh tokens persist in ext.integration_credential so
// Intuit's token rotation survives across runs.
import { query, pool } from '../db';
import { ensureExtSchema } from '../ingest/schema';

const CID = process.env.QUICKBOOKS_CLIENT_ID || '';
const CSEC = process.env.QUICKBOOKS_CLIENT_SECRET || '';
const ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'production';
const SCOPES = 'com.intuit.quickbooks.accounting';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';

export function qbConfigured() { return !!(CID && CSEC); }
export function qbEnvironment() { return ENVIRONMENT; }
export function qbApiBase(env = ENVIRONMENT) {
  return env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
}

export function buildAuthorizeUrl(redirectUri, state) {
  const p = new URLSearchParams({ client_id: CID, scope: SCOPES, redirect_uri: redirectUri, response_type: 'code', state });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

async function tokenRequest(body) {
  const basic = Buffer.from(`${CID}:${CSEC}`).toString('base64');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!r.ok) throw new Error(`QuickBooks token ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
export const exchangeCode = (code, redirectUri) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
export const refreshAccessToken = (refreshToken) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

// Stored credential first, then a one-shot env fallback (QUICKBOOKS_REFRESH_TOKEN/REALM_ID).
export async function getQbCredential() {
  try {
    const { rows } = await query(
      `select refresh_token, realm_id, environment, company_name from ext.integration_credential where provider = 'quickbooks'`
    );
    if (rows[0] && rows[0].refresh_token) return rows[0];
  } catch { /* table not created yet */ }
  const rt = process.env.QUICKBOOKS_REFRESH_TOKEN || '';
  const realm = process.env.QUICKBOOKS_REALM_ID || '';
  if (rt && realm) return { refresh_token: rt, realm_id: realm, environment: ENVIRONMENT, company_name: null };
  return null;
}

export async function saveQbCredential({ refresh_token, realm_id, environment, company_name }) {
  await ensureExtSchema();
  await pool.query(
    `insert into ext.integration_credential (provider, refresh_token, realm_id, environment, company_name, updated_at)
     values ('quickbooks', $1, $2, $3, $4, now())
     on conflict (provider) do update set
       refresh_token = excluded.refresh_token, realm_id = excluded.realm_id,
       environment = excluded.environment, company_name = excluded.company_name, updated_at = now()`,
    [refresh_token, realm_id, environment || ENVIRONMENT, company_name || null]
  );
}

export async function qbStatus() {
  const cred = await getQbCredential();
  return { configured: qbConfigured(), connected: !!cred, realm: cred?.realm_id || null, company: cred?.company_name || null };
}
