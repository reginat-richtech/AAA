import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/access';
import { query } from '../../../../../lib/db';
import { ensureExtSchema } from '../../../../../lib/ingest/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The append-only daily-update log for a task (newest first).
export async function GET(_req, { params }) {
  const { response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  const { id } = await params;
  const { rows } = await query(
    `select id, author, body, created_at from ext.task_update where task_id = $1 order by created_at desc limit 200`,
    [id],
  );
  return NextResponse.json(rows);
}

// Add a daily update. Open to any signed-in user.
export async function POST(req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  const { id } = await params;
  const exists = (await query('select 1 from ext.task where id = $1', [id])).rows[0];
  if (!exists) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const body = String(b.body || '').trim().slice(0, 4000);
  if (!body) return NextResponse.json({ error: 'Update text is required.' }, { status: 400 });
  const { rows } = await query(
    `insert into ext.task_update (id, task_id, author, body) values ($1,$2,$3,$4)
     returning id, author, body, created_at`,
    [crypto.randomUUID(), id, user.email, body],
  );
  return NextResponse.json(rows[0]);
}
