import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/access';
import { query, mutateAs } from '../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Allocate an inventory item to a project. Admins + inventory department only.
export async function POST(req, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!(user.isAdmin || user.department === 'inventory')) {
    return NextResponse.json({ error: 'Only admins or the inventory team can allocate inventory.' }, { status: 403 });
  }
  const { id } = await params;
  const item = (await query('select id, sku, product_name from inventory.cn_sku where id = $1::bigint', [id])).rows[0];
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const project_id = b.project_id ? String(b.project_id) : null;
  if (!project_id) return NextResponse.json({ error: 'Pick a project.' }, { status: 400 });
  const proj = (await query('select id from ops.legal_agreement where id::text = $1', [project_id])).rows[0];
  if (!proj) return NextResponse.json({ error: 'Project not found.' }, { status: 400 });

  const qn = Number(String(b.quantity ?? '').trim());
  const quantity = Number.isFinite(qn) ? qn : null;
  const note = b.note ? String(b.note).slice(0, 500) : null;

  const row = await mutateAs(user.email, async (q) => {
    const { rows } = await q(
      `insert into inventory.project_allocation (project_id, cn_sku_id, sku, product_name, quantity, note, added_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, project_id, cn_sku_id, quantity`,
      [project_id, item.id, item.sku, item.product_name, quantity, note, user.email],
    );
    return rows[0];
  });
  return NextResponse.json(row);
}
