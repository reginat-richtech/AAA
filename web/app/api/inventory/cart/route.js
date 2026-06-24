import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/access';
import { query, mutateAs } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-project "inventory needed" carts. Each project carries its form info (robot
// types/count from the agreement) so the inventory team knows what it needs; the
// cart itself reuses inventory.project_allocation (same data the Task Tracker shows).
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const canEdit = user.isAdmin || user.department === 'inventory';

  const projects = (await query(
    `select id::text as id, project_number, title, counterparty, agreement_type, robot_types, robot_count, created_at
       from ops.legal_agreement order by created_at desc limit 500`,
  )).rows;

  let carts = [], inventory = [];
  try {
    carts = (await query(
      `select id, project_id, cn_sku_id, sku, product_name, quantity, note, added_by, created_at
         from inventory.project_allocation order by created_at`,
    )).rows;
    inventory = (await query(
      `select id, sku, product_name, quantity, category, product_line, item_class
         from inventory.cn_sku order by product_name limit 1000`,
    )).rows;
  } catch { carts = []; inventory = []; }

  return NextResponse.json({ canEdit, projects, carts, inventory });
}

// Remove one item from a project's cart (admins + inventory department).
export async function DELETE(req) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!(user.isAdmin || user.department === 'inventory')) {
    return NextResponse.json({ error: 'Only admins or the inventory team can edit the cart.' }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await mutateAs(user.email, (q) => q('delete from inventory.project_allocation where id = $1::bigint', [id]));
  return NextResponse.json({ ok: true });
}
