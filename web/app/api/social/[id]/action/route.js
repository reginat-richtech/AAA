import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/access';
import { query } from '../../../../../lib/db';
import { publishToX } from '../../../../../lib/integrations/x';
import { publishToReddit } from '../../../../../lib/integrations/reddit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, platform, author_email, author_name, content, image_url, title, subreddit, scheduled_at,
  status, reviewer_email, reviewer_note, published_at, x_post_id, created_at, updated_at`;

async function load(id) {
  const { rows } = await query(`select ${COLS} from ext.social_post where id = $1`, [id]);
  return rows[0] || null;
}
const owns = (u, p) => (p.author_email || '').toLowerCase() === u.email;

// State machine: submit (author) · approve/reject (manager) · publish (manager).
export async function POST(req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const post = await load(id);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const action = String(b.action || '');
  // Optional edits a manager applies while reviewing (platform-aware length cap).
  const editContent = b.content != null ? String(b.content).slice(0, post.platform === 'reddit' ? 40000 : 280) : null;
  const editSched = b.scheduled_at !== undefined ? (b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null) : undefined;

  if (action === 'submit') {
    if (!owns(user, post) && !user.isAdmin) return NextResponse.json({ error: 'Not your post' }, { status: 403 });
    if (!['draft', 'rejected'].includes(post.status)) return NextResponse.json({ error: `Cannot submit a ${post.status} post` }, { status: 409 });
    const { rows } = await query(`update ext.social_post set status='submitted', updated_at=now() where id=$1 returning ${COLS}`, [id]);
    return NextResponse.json(rows[0]);
  }

  if (action === 'approve' || action === 'reject') {
    if (!user.isAdmin) return NextResponse.json({ error: 'Managers only' }, { status: 403 });
    if (!['submitted', 'approved'].includes(post.status)) return NextResponse.json({ error: `Cannot ${action} a ${post.status} post` }, { status: 409 });
    const status = action === 'approve' ? 'approved' : 'rejected';
    const content = editContent != null ? editContent : post.content;
    const scheduled_at = editSched !== undefined ? editSched : post.scheduled_at;
    const { rows } = await query(
      `update ext.social_post set status=$2, content=$3, scheduled_at=$4, reviewer_email=$5, reviewer_note=$6, updated_at=now()
       where id=$1 returning ${COLS}`,
      [id, status, content, scheduled_at, user.email, b.note ? String(b.note).slice(0, 500) : null],
    );
    return NextResponse.json(rows[0]);
  }

  if (action === 'publish') {
    if (!user.isAdmin) return NextResponse.json({ error: 'Managers only' }, { status: 403 });
    if (post.status !== 'approved') return NextResponse.json({ error: 'Only approved posts can be published' }, { status: 409 });
    const res = post.platform === 'reddit' ? await publishToReddit(post) : await publishToX(post);
    if (!res.ok) return NextResponse.json({ ok: false, skipped: res.skipped || res.error || 'not published', post });
    const { rows } = await query(
      `update ext.social_post set status='published', x_post_id=$2, published_at=now(), updated_at=now() where id=$1 returning ${COLS}`,
      [id, res.id || null],
    );
    return NextResponse.json({ ok: true, post: rows[0] });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
