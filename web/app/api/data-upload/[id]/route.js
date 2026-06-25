import { NextResponse } from 'next/server';
import { query, mutateAs } from '../../../../lib/db';
import { headlineFields } from '../../../../lib/extract';
import { requireUser, canSee } from '../../../../lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `id, project_number, filename, status, error, agreement_type, title, counterparty,
  effective_date, execution_date, expiration_date, auto_renewal, contract_value, currency,
  governing_law, termination_notice_days, robot_types, robot_count, summary, salesman_name,
  salesman_email, deal_id, contract_number, finalized, extract_method, created_at`;

export async function GET(_request, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const { rows } = await query(
    `select ${COLS}, uploaded_by, extracted_json as extracted from ops.legal_agreement where id = $1`, [id]
  );
  // 404 (not 403) when it isn't theirs, so we don't reveal that the id exists.
  if (!rows[0] || !canSee(user, rows[0])) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // editable: a finalized agreement is admin-only; non-admins get it read-only.
  return NextResponse.json({ ...rows[0], editable: user.isAdmin || !rows[0].finalized });
}

// Save manual corrections after review.
export async function PATCH(request, { params }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  try {
    const b = await request.json();

    // Merge edited robots into extracted_json and recompute headline robot fields.
    const cur = (await query(
      'select extracted_json, salesman_email, uploaded_by, finalized from ops.legal_agreement where id=$1', [id]
    )).rows[0];
    if (!cur || !canSee(user, cur)) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // Finalized agreements are locked to admins only.
    if (cur.finalized && !user.isAdmin) {
      return NextResponse.json({ error: 'This agreement is finalized — only an admin can edit it.' }, { status: 403 });
    }
    const extracted = { ...(cur.extracted_json || {}) };
    if (Array.isArray(b.robots)) extracted.robots = b.robots;
    const hf = headlineFields(extracted);
    const dn = (v) => (v === '' || v === undefined ? null : v);
    // auto_renewal is a boolean column: only explicit yes/true | no/false set it;
    // anything else (incl. the blank "" select option) must be NULL, never "".
    const yn = (v) => (v === true || v === 'yes' ? true : v === false || v === 'no' ? false : null);

    const row = await mutateAs(user.email, async (q) => {
      const { rows } = await q(
        `update ops.legal_agreement set
           agreement_type = coalesce($2, agreement_type),
           title = $3, counterparty = $4, governing_law = $5,
           effective_date = $6, execution_date = $7, expiration_date = $8,
           auto_renewal = $9, contract_value = $10, currency = coalesce($11, currency),
           termination_notice_days = $12, summary = $13,
           salesman_name = $14, salesman_email = $15, deal_id = $16,
           robot_types = $17, robot_count = $18, extracted_json = $19,
           finalized = true
         where id = $1
         returning ${COLS}, extracted_json as extracted`,
        [
          id, dn(b.agreement_type), dn(b.title), dn(b.counterparty), dn(b.governing_law),
          dn(b.effective_date), dn(b.execution_date), dn(b.expiration_date),
          yn(b.auto_renewal),
          dn(b.contract_value), dn(b.currency), dn(b.termination_notice_days), dn(b.summary),
          dn(b.salesman_name), dn(b.salesman_email), dn(b.deal_id),
          hf.robot_types, hf.robot_count, JSON.stringify(extracted),
        ],
      );
      return rows[0];
    });
    if (!row) return NextResponse.json({ error: 'update matched no row' }, { status: 404 });
    return NextResponse.json({ ...row, editable: user.isAdmin || !row.finalized });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
