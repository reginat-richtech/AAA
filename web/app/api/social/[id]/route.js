import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/access';
import { query } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, platform, author_email, author_name, content, image_url, title, subreddit, scheduled_at,
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
  const platform = b.platform === 'reddit' ? 'reddit' : (b.platform === 'x' ? 'x' : post.platform);
  const cap = platform === 'reddit' ? 40000 : 280;
  const content = b.content != null ? String(b.content).slice(0, cap) : post.content;
  const image_url = b.image_url !== undefined ? (b.image_url ? String(b.image_url).slice(0, 500) : null) : post.image_url;
  const title = b.title !== undefined ? (b.title ? String(b.title).slice(0, 300) : null) : post.title;
  const subreddit = b.subreddit !== undefined ? (b.subreddit ? String(b.subreddit).replace(/^\/?r\//i, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 100) : null) : post.subreddit;
  const scheduled_at = b.scheduled_at !== undefined ? (b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null) : post.scheduled_at;
  const { rows } = await query(
    `update ext.social_post set platform = $2, content = $3, image_url = $4, title = $5, subreddit = $6, scheduled_at = $7, updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, platform, content, image_url, title, subreddit, scheduled_at],
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
