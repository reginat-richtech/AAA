import { NextResponse } from 'next/server';
import { query, mutateAs } from '../../../../lib/db';
import { requireUser } from '../../../../lib/access';
import { qbStatus, qbSearchInvoices, qbGetInvoice } from '../../../../lib/integrations/qbAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Invoices are handled by admins / sales / finance — same gate as the /invoices module.
const canInvoice = (u) => u.isAdmin || ['sales', 'finance'].includes(u.department);

// Total of an invoice's line items (explicit amount, else qty × unit price).
const lineAmt = (l) => (l && l.amount != null && l.amount !== '' ? Number(l.amount) : (Number(l?.quantity) || 0) * (Number(l?.unit_price) || 0));
const totalOf = (lines) => (Array.isArray(lines) ? lines : []).reduce((s, l) => s + lineAmt(l), 0);

// Validate a project id refers to a real agreement or proposal.
async function projectExists(projectId) {
  const r = await query(
    `select 1 from ops.legal_agreement where id::text = $1
      union all select 1 from ops.project_proposal where id::text = $1 limit 1`, [projectId]);
  return r.rows.length > 0;
}

// GET ?q= — picker: invoices to connect. Returns BOTH the app's own ops.invoice rows
// (source:'app') AND live QuickBooks invoices (source:'quickbooks', when QB is
// connected) so a project can be attached to an invoice that already lives in QB.
export async function GET(request) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!canInvoice(user)) return NextResponse.json({ error: 'Invoices are limited to admins, sales and finance.' }, { status: 403 });
  const q = (new URL(request.url).searchParams.get('q') || '').trim();

  const appRows = (await query(
    `select i.id::text as id, i.invoice_number, i.qb_doc_number, i.qb_invoice_id, i.customer_name, i.status, i.lines, i.project_id,
            coalesce(a.project_number, pp.project_number) as project_number
       from ops.invoice i
       left join ops.legal_agreement a on a.id::text = i.project_id
       left join ops.project_proposal pp on pp.id::text = i.project_id
      where ($1 = '' or i.invoice_number ilike $2 or i.customer_name ilike $2 or i.qb_doc_number ilike $2)
      order by i.created_at desc
      limit 30`,
    [q, `%${q}%`],
  )).rows;
  const appInvoices = appRows.map((r) => ({
    id: r.id, source: 'app',
    number: r.invoice_number || r.qb_doc_number || null,
    customer_name: r.customer_name || null,
    status: r.status || 'draft',
    total: totalOf(r.lines),
    project_id: r.project_id || null,
    project_number: r.project_number || null,
    qb_invoice_id: r.qb_invoice_id || null,
  }));

  // Live QuickBooks invoices (best-effort — never block the picker on a QB hiccup).
  let qbInvoices = [];
  const qb = await qbStatus();
  if (qb.connected) {
    const r = await qbSearchInvoices(q);
    if (!r.error) {
      const alreadyImported = new Set(appInvoices.map((a) => a.qb_invoice_id).filter(Boolean));
      qbInvoices = (r.invoices || [])
        .filter((iv) => !alreadyImported.has(iv.qb_invoice_id)) // don't double-list an imported one
        .map((iv) => ({
          id: null, source: 'quickbooks', qb_invoice_id: iv.qb_invoice_id,
          number: iv.doc_number || `QB#${iv.qb_invoice_id}`,
          customer_name: iv.customer_name || null,
          status: iv.balance === 0 ? 'paid · QuickBooks' : 'in QuickBooks',
          total: iv.total, project_id: null, project_number: null,
        }));
    }
  }

  return NextResponse.json({ invoices: [...appInvoices, ...qbInvoices], qb_connected: qb.connected });
}

// POST — link an invoice to this project.
//   { project_id, invoice_id }       link an existing ops.invoice (project_id null → unlink)
//   { project_id, qb_invoice_id }    import a QuickBooks invoice into ops.invoice and link it
// Admin / sales / finance only; audited.
export async function POST(request) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!canInvoice(user)) return NextResponse.json({ error: 'Only an admin, sales or finance can connect an invoice.' }, { status: 403 });

  let body = {};
  try { body = await request.json(); } catch { /* */ }
  const projectId = body.project_id ? String(body.project_id) : null; // null → unlink
  const invoiceId = body.invoice_id ? String(body.invoice_id) : null;
  const qbInvoiceId = body.qb_invoice_id ? String(body.qb_invoice_id) : null;

  if (projectId && !(await projectExists(projectId))) {
    return NextResponse.json({ error: 'unknown project' }, { status: 404 });
  }

  // ── Import a QuickBooks invoice, then link it ──
  if (qbInvoiceId) {
    if (!projectId) return NextResponse.json({ error: 'project_id is required to import a QuickBooks invoice' }, { status: 400 });
    // If we already imported this QB invoice, just (re)link it.
    const existing = (await query('select id::text as id from ops.invoice where qb_invoice_id = $1', [qbInvoiceId])).rows[0];
    if (existing) {
      await mutateAs(user.email, (qfn) => qfn('update ops.invoice set project_id = $2, updated_at = now() where id = $1', [existing.id, projectId]));
      return NextResponse.json({ ok: true, invoice_id: existing.id, imported: false, linked: true });
    }
    const got = await qbGetInvoice(qbInvoiceId);
    if (got.error || !got.invoice) return NextResponse.json({ error: got.error || 'Could not load the QuickBooks invoice.' }, { status: 502 });
    const v = got.invoice;
    const res = await mutateAs(user.email, (qfn) => qfn(
      `insert into ops.invoice
         (project_id, status, currency, lines, tags, customer_name, customer_email, billing_address, shipping_address,
          invoice_number, invoice_date, due_date, qb_invoice_id, qb_doc_number, pushed_at, created_by)
       values ($1,'pushed','USD',$2::jsonb,'[]'::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)
       returning id::text as id`,
      [projectId, JSON.stringify(v.lines || []), v.customer_name, v.customer_email, v.billing_address, v.shipping_address,
        v.qb_doc_number, v.invoice_date || null, v.due_date || null, v.qb_invoice_id, v.qb_doc_number, user.email]));
    return NextResponse.json({ ok: true, invoice_id: res.rows?.[0]?.id || null, imported: true, doc_number: v.qb_doc_number });
  }

  // ── Link / unlink an existing app invoice ──
  if (!invoiceId) return NextResponse.json({ error: 'invoice_id (or qb_invoice_id) is required' }, { status: 400 });
  const inv = (await query('select id from ops.invoice where id = $1', [invoiceId])).rows[0];
  if (!inv) return NextResponse.json({ error: 'invoice not found' }, { status: 404 });
  await mutateAs(user.email, (qfn) => qfn('update ops.invoice set project_id = $2, updated_at = now() where id = $1', [invoiceId, projectId]));
  return NextResponse.json({ ok: true, invoice_id: invoiceId, project_id: projectId, unlinked: !projectId });
}
