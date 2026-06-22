// Instagram (Business) integration — publishes to the Instagram Business/Creator
// account linked to the company's Facebook Page, via the Facebook Graph API.
// Reuses the same Page access token as lib/integrations/facebook.js.
//
// Two hard Instagram rules shape this:
//   1. A post MUST have at least one image (or video) — text-only is rejected.
//   2. The image is fetched by Instagram's servers from a PUBLIC url. Our media
//      lives behind auth, so we hand IG a short-lived HMAC-signed public url
//      (see app/api/social/media-public/[mid]) built from SOCIAL_PUBLIC_BASE
//      (or AUTH_URL). Without a public base, publishing degrades gracefully.
import crypto from 'crypto';
import { query } from '../db';

const GRAPH = process.env.FB_GRAPH_VERSION || 'v23.0';
const BASE = `https://graph.facebook.com/${GRAPH}`;

const PAGE_ID = () => process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '';
const PAGE_TOKEN = () => process.env.FB_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
const IG_ID_ENV = () => process.env.IG_USER_ID || process.env.INSTAGRAM_USER_ID || '';
const PUBLIC_BASE = () => (process.env.SOCIAL_PUBLIC_BASE || process.env.AUTH_URL || '').replace(/\/+$/, '');
const SIGN_SECRET = () => process.env.SOCIAL_MEDIA_SIGNING_SECRET || process.env.AUTH_SECRET || '';

// Configured once we have a Page token plus a way to resolve the IG account.
export function instagramConfigured() {
  return !!(PAGE_TOKEN() && (IG_ID_ENV() || PAGE_ID()));
}
// Alias for callers that prefer the longer name.
export const igConfigured = instagramConfigured;

async function graph(method, path, params = {}) {
  const token = PAGE_TOKEN();
  if (!token) throw new Error('Instagram not configured (need FB_PAGE_ACCESS_TOKEN).');
  const url = new URL(`${BASE}${path}`);
  const init = { method };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', token);
  } else {
    init.body = new URLSearchParams({ ...params, access_token: token });
  }
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const e = data.error || {};
    const err = new Error(`Instagram ${method} ${path} → ${e.message || ('HTTP ' + r.status)}`);
    err.status = r.status; err.fbCode = e.code; err.data = data;
    throw err;
  }
  return data;
}

// Resolve + cache the IG Business account id linked to the Page (or IG_USER_ID
// env). Caches the null result too, so an unlinked Page isn't re-queried hourly.
let _igId; let _igIdAt = 0;
export async function getIgUserId() {
  const envId = IG_ID_ENV();
  if (envId) return envId;
  if (_igIdAt && Date.now() - _igIdAt < 30 * 60 * 1000) return _igId || null;
  try {
    const d = await graph('GET', `/${PAGE_ID()}`, { fields: 'instagram_business_account' });
    _igId = d.instagram_business_account?.id || null;
  } catch { _igId = null; }
  _igIdAt = Date.now();
  return _igId || null;
}

// Cached IG identity (username + avatar) for the live UI preview.
let _acct = null; let _acctAt = 0;
export async function getAccount() {
  if (_acct && Date.now() - _acctAt < 30 * 60 * 1000) return _acct;
  const igId = await getIgUserId();
  if (!igId) return null;
  const d = await graph('GET', `/${igId}`, { fields: 'username,name,profile_picture_url,followers_count' });
  _acct = { id: igId, username: d.username || null, name: d.name || null, picture: d.profile_picture_url || null, followers: d.followers_count ?? null };
  _acctAt = Date.now();
  return _acct;
}

// Short-lived signed public url IG can fetch the image bytes from.
function signedMediaUrl(mid) {
  const base = PUBLIC_BASE();
  const secret = SIGN_SECRET();
  if (!base || !secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const sig = crypto.createHmac('sha256', secret).update(`${mid}.${exp}`).digest('hex');
  return `${base}/api/social/media-public/${mid}?exp=${exp}&sig=${sig}`;
}

// Image media ids for a post, in upload order (videos handled separately later).
async function imageIds(postId) {
  if (!postId) return [];
  try {
    const { rows } = await query(
      `select id from ext.social_media where post_id = $1 and kind = 'image' order by created_at`,
      [postId],
    );
    return rows.map((r) => r.id);
  } catch { return []; }
}

// Used by the social-post approval workflow (routes here when platform='instagram').
// Returns { ok, id } or { ok:false, skipped|error } so the route records without throwing.
export async function publishToInstagram(post) {
  if (!instagramConfigured()) return { ok: false, skipped: 'Instagram not configured' };
  if (!PUBLIC_BASE() || !SIGN_SECRET()) {
    return { ok: false, skipped: 'Set SOCIAL_PUBLIC_BASE (or AUTH_URL) and AUTH_SECRET so Instagram can fetch the image' };
  }
  let igId;
  try { igId = await getIgUserId(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  if (!igId) return { ok: false, skipped: 'No Instagram Business account linked to the Page' };

  const imgs = await imageIds(post.id);
  if (!imgs.length) return { ok: false, error: 'Instagram requires at least one image' };
  const caption = String(post.content || '');

  try {
    let creationId;
    if (imgs.length === 1) {
      const c = await graph('POST', `/${igId}/media`, { image_url: signedMediaUrl(imgs[0]), caption });
      creationId = c.id;
    } else {
      // Carousel: one child container per image (max 10), then the parent.
      const children = [];
      for (const mid of imgs.slice(0, 10)) {
        const child = await graph('POST', `/${igId}/media`, { image_url: signedMediaUrl(mid), is_carousel_item: 'true' });
        children.push(child.id);
      }
      const c = await graph('POST', `/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption });
      creationId = c.id;
    }
    const pub = await graph('POST', `/${igId}/media_publish`, { creation_id: creationId });
    return { ok: true, id: pub.id || null, photos: imgs.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function instagramStatus() {
  let igId = null;
  try { igId = await getIgUserId(); } catch { igId = null; }
  return {
    configured: instagramConfigured(),
    linked: !!igId,
    ig_user_id: igId,
    public_base: !!PUBLIC_BASE(),
  };
}
