import { NextResponse } from 'next/server';
import { requireUser } from '../../../lib/access';
import { query, mutateAs } from '../../../lib/db';
import { ensureExtSchema } from '../../../lib/ingest/schema';
import { xConfigured, getAccount } from '../../../lib/integrations/x';
import { instagramConfigured, getAccount as getIgAccount } from '../../../lib/integrations/instagram';
import { capFor, normalizePlatform } from '../../../lib/socialPlatforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, platform, author_email, author_name, content, image_url, scheduled_at,
  status, reviewer_email, reviewer_note, published_at, x_post_id, created_at, updated_at`;

// Admins see every post (the review queue); everyone else sees only their own.
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  // Each post carries its media metadata (bytes are streamed separately).
  const SEL = `p.id, p.platform, p.author_email, p.author_name, p.content, p.image_url, p.scheduled_at,
    p.status, p.reviewer_email, p.reviewer_note, p.published_at, p.x_post_id, p.created_at, p.updated_at,
    coalesce((select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'content_type', m.content_type, 'filename', m.filename) order by m.created_at)
      from ext.social_media m where m.post_id = p.id), '[]'::json) as media`;
  const { rows } = user.isAdmin
    ? await query(`select ${SEL} from ext.social_post p order by p.created_at desc limit 500`)
    : await query(`select ${SEL} from ext.social_post p where lower(p.author_email) = lower($1) order by p.created_at desc limit 200`, [user.email]);
  // Identify the connected accounts posts go out as (for accurate previews).
  let xAccount = null;
  if (xConfigured()) { try { xAccount = await getAccount(); } catch { xAccount = null; } }
  let igAccount = null;
  if (instagramConfigured()) { try { igAccount = await getIgAccount(); } catch { igAccount = null; } }
  return NextResponse.json({ isAdmin: user.isAdmin, email: user.email, posts: rows, xAccount, igAccount });
}

// Create a draft.
export async function POST(req) {
  const { user, response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  const body = await req.json().catch(() => ({}));
  const platform = normalizePlatform(body.platform);
  const content = String(body.content || '').slice(0, capFor(platform));
  const image_url = body.image_url ? String(body.image_url).slice(0, 500) : null;
  const scheduled_at = body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
  const row = await mutateAs(user.email, async (q) => {
    const { rows } = await q(
      `insert into ext.social_post (id, author_email, author_name, platform, content, image_url, scheduled_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'draft') returning ${COLS}`,
      [crypto.randomUUID(), user.email, user.name || null, platform, content, image_url, scheduled_at],
    );
    return rows[0];
  });
  return NextResponse.json(row);
}
