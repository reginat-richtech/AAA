import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/access';
import { query, mutateAs } from '../../../../lib/db';
import { ensureExtSchema } from '../../../../lib/ingest/schema';
import { normalizeStatus, normalizePriority, normalizeType, normalizeDepartment } from '../../../../lib/orgRoles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, project_id, title, description, note, type, department, assignee_email, created_by,
  status, priority, tags, start_date, end_date, due_date, created_at, updated_at`;

async function load(id) {
  const { rows } = await query(`select ${COLS} from ext.task where id = $1`, [id]);
  return rows[0] || null;
}

// Edit a task — open to any signed-in user (shared tracker). Only fields present
// in the body are changed.
export async function PATCH(req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  const { id } = await params;
  const task = await load(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const title = b.title != null ? (String(b.title).trim().slice(0, 200) || task.title) : task.title;
  const description = b.description !== undefined ? (b.description ? String(b.description).slice(0, 4000) : null) : task.description;
  const note = b.note !== undefined ? (b.note ? String(b.note).slice(0, 4000) : null) : task.note;
  const status = b.status != null ? normalizeStatus(b.status) : task.status;
  const priority = b.priority != null ? normalizePriority(b.priority) : task.priority;
  const type = b.type !== undefined ? (b.type ? normalizeType(b.type) : null) : task.type;
  const start_date = b.start_date !== undefined ? (b.start_date ? String(b.start_date).slice(0, 10) : null) : task.start_date;
  const end_date = b.end_date !== undefined ? (b.end_date ? String(b.end_date).slice(0, 10) : null) : task.end_date;
  const assignee = b.assignee_email !== undefined ? (b.assignee_email ? String(b.assignee_email).trim().toLowerCase() : null) : task.assignee_email;
  let project_id = task.project_id;
  if (b.project_id !== undefined) {
    project_id = b.project_id ? String(b.project_id) : null;
    if (project_id) {
      const proj = (await query('select id from ops.legal_agreement where id::text = $1', [project_id])).rows[0];
      if (!proj) project_id = task.project_id;
    }
  }
  const department = b.department !== undefined ? normalizeDepartment(b.department) : task.department;
  const tags = b.tags !== undefined
    ? (Array.isArray(b.tags) ? b.tags : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30)
    : (task.tags || []);

  const row = await mutateAs(user.email, async (q) => {
    const { rows } = await q(
      `update ext.task set title=$2, description=$3, note=$4, type=$5, status=$6, priority=$7,
         start_date=$8, end_date=$9, assignee_email=$10, project_id=$11, department=$12, tags=$13::jsonb, updated_at=now()
       where id=$1 returning ${COLS}`,
      [id, title, description, note, type, status, priority, start_date, end_date, assignee, project_id, department, JSON.stringify(tags)],
    );
    return rows[0];
  });
  return NextResponse.json(row);
}

// Delete a task — the creator or an admin only.
export async function DELETE(_req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  await ensureExtSchema();
  const { id } = await params;
  const task = await load(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isOwner = (task.created_by || '').toLowerCase() === user.email;
  if (!user.isAdmin && !isOwner) return NextResponse.json({ error: 'Only the creator or an admin can delete this task.' }, { status: 403 });
  await mutateAs(user.email, (q) => q('delete from ext.task where id = $1', [id]));
  return NextResponse.json({ ok: true });
}
