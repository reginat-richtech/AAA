// PUBLIC, unauthenticated media endpoint — exists ONLY so Instagram's servers can
// fetch a post image when publishing (the Graph API pulls image_url server-side).
// Access is gated by a short-lived HMAC signature (?exp&sig) minted in
// lib/integrations/instagram.js, NOT by login. Exempted in middleware.js.
import crypto from 'crypto';
import { query } from '../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET = () => process.env.SOCIAL_MEDIA_SIGNING_SECRET || process.env.AUTH_SECRET || '';

function validSig(mid, exp, sig) {
  const secret = SECRET();
  if (!secret || !exp || !sig) return false;
  if (Number(exp) * 1000 < Date.now()) return false;        // expired
  const expect = crypto.createHmac('sha256', secret).update(`${mid}.${exp}`).digest('hex');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req, { params }) {
  const { mid } = await params;
  const u = new URL(req.url);
  if (!validSig(mid, u.searchParams.get('exp'), u.searchParams.get('sig'))) {
    return new Response('forbidden', { status: 403 });
  }
  const { rows } = await query(`select content_type, filename, bytes from ext.social_media where id = $1`, [mid]);
  const m = rows[0];
  if (!m) return new Response('not found', { status: 404 });
  return new Response(m.bytes, {
    headers: {
      'Content-Type': m.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(m.filename || 'media').replace(/"/g, '')}"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
