// Facebook Page integration — publishes to and reads engagement from the
// company's own Facebook Page via the Graph API, using a permanent Page access
// token (derived from a long-lived user token; it does not expire). Free, and
// no App Review for a Page you administer. Mirrors lib/integrations/x.js.
import { query } from '../db';

const GRAPH = process.env.FB_GRAPH_VERSION || 'v23.0';
const BASE = `https://graph.facebook.com/${GRAPH}`;

// Accept either FB_* (what setup stored) or the older FACEBOOK_* names.
const PAGE_ID = () => process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '';
const PAGE_TOKEN = () => process.env.FB_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';

function creds() {
  const pageId = PAGE_ID();
  const token = PAGE_TOKEN();
  if (!pageId || !token) throw new Error('Facebook not configured (need FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN).');
  return { pageId, token };
}

export function fbConfigured() {
  return !!(PAGE_ID() && PAGE_TOKEN());
}
// Alias — some callers use the longer name.
export const facebookConfigured = fbConfigured;

async function fbFetch(method, path, params = {}) {
  const { token } = creds();
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
    const err = new Error(`Facebook ${method} ${path} → ${e.message || ('HTTP ' + r.status)}`);
    err.status = r.status; err.fbCode = e.code; err.data = data;
    throw err;
  }
  return data;
}

// Cached Page identity (name + avatar) for UI previews — rarely changes.
let _pg = null; let _pgAt = 0;
export async function getPage() {
  if (_pg && Date.now() - _pgAt < 30 * 60 * 1000) return _pg;
  const { pageId } = creds();
  const d = await fbFetch('GET', `/${pageId}`, { fields: 'name,username,fan_count,picture{url}' });
  _pg = { id: d.id, name: d.name || null, username: d.username || null, picture: d.picture?.data?.url || null, fan_count: d.fan_count ?? null };
  _pgAt = Date.now();
  return _pg;
}

// Image bytes for a post (videos handled separately; not attached yet).
async function postImages(postId) {
  if (!postId) return [];
  try {
    const { rows } = await query(
      `select content_type, filename, bytes from ext.social_media
       where post_id = $1 and kind = 'image' order by created_at`,
      [postId],
    );
    return rows;
  } catch { return []; }
}

// Facebook's photo endpoint accepts JPEG/PNG/GIF but rejects WebP — normalize
// anything it won't take to JPEG via sharp (bundled with Next).
async function fbFriendly(buffer, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (/(jpe?g|png|gif)/.test(ct)) return { buffer, type: ct, name: 'image' };
  const sharp = (await import('sharp')).default;
  const out = await sharp(buffer).jpeg({ quality: 88 }).toBuffer();
  return { buffer: out, type: 'image/jpeg', name: 'image.jpg' };
}

// Upload one photo as UNPUBLISHED and return its media id (for attached_media).
async function uploadUnpublishedPhoto(buffer, contentType) {
  const { pageId, token } = creds();
  const f = await fbFriendly(buffer, contentType);
  const form = new FormData();
  form.append('published', 'false');
  form.append('access_token', token);
  form.append('source', new Blob([f.buffer], { type: f.type }), f.name);
  const r = await fetch(`${BASE}/${pageId}/photos`, { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`Facebook photo upload → ${data.error?.message || ('HTTP ' + r.status)}`);
  return data.id;
}

// Publish a post to the Page. Attaches images (converted if needed); text-only
// when there are none. Returns the Graph API response ({ id }).
export async function postToPage(message, images = []) {
  const { pageId } = creds();
  const text = String(message || '').trim();
  if (!text && !images.length) throw new Error('Post is empty.');
  if (!images.length) return fbFetch('POST', `/${pageId}/feed`, { message: text });
  const params = { message: text };
  let i = 0;
  for (const img of images) {
    const id = await uploadUnpublishedPhoto(img.bytes, img.content_type);
    params[`attached_media[${i++}]`] = JSON.stringify({ media_fbid: id });
  }
  return fbFetch('POST', `/${pageId}/feed`, params);
}

// Read the Page's recent posts.
export async function getRecentPosts({ limit = 10 } = {}) {
  const { pageId } = creds();
  return fbFetch('GET', `/${pageId}/published_posts`, { fields: 'id,message,created_time,permalink_url', limit: String(limit) });
}

// Read comments + reaction counts on a post (engagement).
export async function getEngagement(postId, { limit = 25 } = {}) {
  return fbFetch('GET', `/${postId}`, {
    fields: `reactions.summary(total_count),comments.summary(true).limit(${limit}){from,message,created_time}`,
  });
}

// Used by the social-post approval workflow (routes here when platform='facebook').
// Returns { ok, id } or { ok:false, skipped|error } so the route records without throwing.
export async function publishToFacebook(post) {
  if (!fbConfigured()) return { ok: false, skipped: 'Facebook not configured' };
  try {
    const images = await postImages(post.id);
    const data = await postToPage(post.content, images);
    return { ok: true, id: data.id || data.post_id || null, photos: images.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
