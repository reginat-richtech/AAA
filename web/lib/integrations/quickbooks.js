// QuickBooks finance review — computed from the DB (ext.quickbooks_invoice), NOT
// the live API. Invoices are pulled into Postgres by lib/ingest/quickbooks.js
// (sync job). Surfaces open/overdue receivables + A/R aging for the Finance AI tab.
import { query } from '../db';

function bucketOf(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}
function sevFor(days) {
  if (days > 60) return { sev: 'fail', icon: '🔴' };
  if (days > 0) return { sev: 'warn', icon: '🟠' };
  return { sev: 'info', icon: '📄' };
}

export async function financeReview() {
  let rows;
  try {
    ({ rows } = await query(
      `select doc_number, customer, due_date, balance from ext.quickbooks_invoice`
    ));
  } catch {
    // table not created / no DB → treat as "not synced yet" (friendly, not an error)
    return { ok: false, pending: true, count: null, error: 'No QuickBooks data yet — add credentials and run the sync.' };
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const open = rows.filter((r) => Number(r.balance) > 0.005);
  const cnt = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const amt = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let outstanding = 0, overdueAmt = 0;
  const overdue = [];

  for (const r of open) {
    const bal = Number(r.balance) || 0;
    const days = r.due_date ? Math.floor((today - new Date(String(r.due_date).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000) : 0;
    const b = bucketOf(days);
    cnt[b]++; amt[b] += bal; outstanding += bal;
    if (days > 0) { overdueAmt += bal; overdue.push({ doc: r.doc_number, customer: r.customer, due: r.due_date, bal, days }); }
  }
  overdue.sort((a, b) => b.bal - a.bal);

  const cards = overdue.slice(0, 25).map((r) => {
    const s = sevFor(r.days);
    return {
      id: String(r.doc || `${r.customer}-${r.due}`),
      sev: s.sev, icon: s.icon,
      title: `INV ${r.doc || '—'} · ${r.customer || 'Unknown'}`,
      detail: `${r.days} day${r.days === 1 ? '' : 's'} overdue · due ${String(r.due || '—').slice(0, 10)}`,
      amount: Math.round(r.bal),
    };
  });

  const aging = ['current', '1-30', '31-60', '61-90', '90+'].map((k) => ({ bucket: k, count: cnt[k], amount: Math.round(amt[k]) }));

  return {
    ok: true,
    count: overdue.length,
    brief: { invoices: rows.length, open: open.length, overdue: overdue.length, outstanding: Math.round(outstanding), overdueAmt: Math.round(overdueAmt) },
    aging, cards, error: null,
  };
}

export async function financeCount() {
  const r = await financeReview();
  return r.ok ? r.count : null;
}
