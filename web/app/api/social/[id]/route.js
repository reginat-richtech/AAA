import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/access';
import { query } from '../../../../lib/db';
import { capFor, normalizePlatform } from '../../../../lib/socialPlatforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, platform, author_email, author_name, content, image_url, scheduled_at,
  status, reviewer_email, reviewer_note, published_at, x_post_id, created_at, updated_at`;

async function load(id) {
  const { rows } = await query(`select ${COLS} from ext.social_post where id = $1`, [id]);
  return rows[0] || null;
}
const owns = (user, post) => (post.author_email || '').toLowerCase() === user.email;
// Author may edit their own draft/rejected post; managers (admins) may edit any.
function canEdit(user, post) {
  return user.isAdmin || (owns(user, post) && (post.status === 'draft' || post.status === 'rejected'));
}

export async function PATCH(req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const post = await load(id);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canEdit(user, post)) return NextResponse.json({ error: 'Not allowed to edit this post' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const platform = b.platform ? normalizePlatform(b.platform, post.platform) : post.platform;
  const content = b.content != null ? String(b.content).slice(0, capFor(platform)) : post.content;
  const image_url = b.image_url !== undefined ? (b.image_url ? String(b.image_url).slice(0, 500) : null) : post.image_url;
  const scheduled_at = b.scheduled_at !== undefined ? (b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null) : post.scheduled_at;
  const { rows } = await query(
    `update ext.social_post set platform = $2, content = $3, image_url = $4, scheduled_at = $5, updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, platform, content, image_url, scheduled_at],
  );
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const post = await load(id);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!user.isAdmin && !(owns(user, post) && (post.status === 'draft' || post.status === 'rejected'))) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }
  await query('delete from ext.social_post where id = $1', [id]);
  return NextResponse.json({ ok: true });
}
