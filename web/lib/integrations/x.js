// X (Twitter) integration — posts and reads on the company's own account using
// OAuth 1.0a user-context credentials (no login redirect, no token expiry).
// Endpoints are X API v2 (https://api.twitter.com/2/...). Posting works on the
// Free tier; reading timelines/mentions requires a paid (Basic+) tier.
import crypto from 'crypto';

const API = 'https://api.twitter.com';

function creds() {
  const c = {
    key: process.env.X_API_KEY,
    secret: process.env.X_API_SECRET,
    token: process.env.X_ACCESS_TOKEN,
    tokenSecret: process.env.X_ACCESS_SECRET,
  };
  if (!c.key || !c.secret || !c.token || !c.tokenSecret) {
    throw new Error('X API credentials missing (need X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).');
  }
  return c;
}

// True once all four OAuth 1.0a keys are present.
export function xConfigured() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
}

// RFC-3986 percent-encoding — stricter than encodeURIComponent (also escapes !*'()).
const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Build the OAuth 1.0a Authorization header. `params` = the query/form params
// folded into the signature base string. v2 JSON bodies are NOT signed, so pass
// {} for JSON POSTs; pass the query object for GETs.
function authHeader(method, url, params = {}) {
  const c = creds();
  const oauth = {
    oauth_consumer_key: c.key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: c.token,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const baseParams = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join('&');
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(baseParams)}`;
  const signingKey = `${enc(c.secret)}&${enc(c.tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(', ');
}

async function xFetch(method, path, { query = {}, json = null } = {}) {
  const url = `${API}${path}`;
  const sigParams = method.toUpperCase() === 'GET' ? query : {}; // JSON bodies are unsigned
  const qs = Object.keys(query).length
    ? '?' + Object.keys(query).map((k) => `${enc(k)}=${enc(query[k])}`).join('&')
    : '';
  const headers = { Authorization: authHeader(method, url, sigParams) };
  let body;
  if (json != null) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const r = await fetch(url + qs, { method, headers, body });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.detail || data?.title || data?.errors?.[0]?.message || text.slice(0, 200);
    const err = new Error(`X API ${method} ${path} → HTTP ${r.status}: ${msg}`);
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}

// The numeric user id is the prefix of the access token ("<id>-<rest>").
export function ownUserId() {
  return String(process.env.X_ACCESS_TOKEN || '').split('-')[0] || null;
}

// Confirm the credentials work (read-only "who am I"; allowed on the Free tier).
export async function verifyCredentials() {
  return xFetch('GET', '/2/users/me', { query: { 'user.fields': 'username,name,profile_image_url' } });
}

// Reports the token's access level from the `x-access-level` response header
// ("read", "read-write", or "read-write-directmessages") WITHOUT posting — the
// reliable way to tell whether this token can actually publish. A "read" token
// authenticates fine but silently cannot tweet.
export async function accessLevel() {
  const url = `${API}/2/users/me`;
  const r = await fetch(url, { headers: { Authorization: authHeader('GET', url, {}) } });
  return { status: r.status, level: r.headers.get('x-access-level') || null };
}

// Cached connected-account identity (handle/name/avatar) for UI previews. The
// identity rarely changes, so cache it to avoid spending a GET /2/users/me on
// every page load (and to stay under the Free tier's tight rate limits).
let _acct = null; let _acctAt = 0;
export async function getAccount() {
  if (_acct && Date.now() - _acctAt < 30 * 60 * 1000) return _acct;
  const u = (await verifyCredentials())?.data || {};
  _acct = { id: u.id || null, name: u.name || null, username: u.username || null, profile_image_url: u.profile_image_url || null };
  _acctAt = Date.now();
  return _acct;
}

// Post a tweet. Works on the Free tier.
export async function postTweet(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Tweet text is empty.');
  if (t.length > 280) throw new Error(`Tweet is ${t.length} characters (max 280).`);
  return xFetch('POST', '/2/tweets', { json: { text: t } });
}

// Read your most recent posts. NOTE: reading requires a paid (Basic+) tier.
export async function getMyTweets({ max = 10 } = {}) {
  const id = ownUserId();
  return xFetch('GET', `/2/users/${id}/tweets`, {
    query: { max_results: String(Math.min(Math.max(max, 5), 100)), 'tweet.fields': 'created_at,public_metrics' },
  });
}

// Read mentions of your account. NOTE: reading requires a paid (Basic+) tier.
export async function getMentions({ max = 10 } = {}) {
  const id = ownUserId();
  return xFetch('GET', `/2/users/${id}/mentions`, {
    query: { max_results: String(Math.min(Math.max(max, 5), 100)), 'tweet.fields': 'created_at,author_id' },
  });
}

// Used by the social-post approval workflow (app/api/social/[id]/action).
// Returns { ok, id } on success or { ok:false, skipped|error } so the route
// can record the failure without throwing.
export async function publishToX(post) {
  if (!xConfigured()) return { ok: false, skipped: 'X API not configured' };
  try {
    const data = await postTweet(post.content);
    return { ok: true, id: data?.data?.id || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
