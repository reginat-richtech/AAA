// Full-history QuickBooks invoices → ext.quickbooks_invoice. Uses the credential
// stored by the Connect-QuickBooks OAuth flow (ext.integration_credential), with
// an env fallback. Refreshes an access token, persists Intuit's rotated refresh
// token, then pages the Invoice query.
import { ensureExtSchema, upsertBatch, num } from './schema';
import { qbConfigured, getQbCredential, refreshAccessToken, saveQbCredential, qbApiBase } from '../integrations/qbAuth';

const COLS = ['id', 'doc_number', 'customer', 'txn_date', 'due_date', 'total_amount', 'balance', 'currency', 'status', 'raw'];

export async function syncQuickbooks() {
  if (!qbConfigured()) {
    return { source: 'quickbooks', ok: false, rows: 0, skipped: 'QUICKBOOKS_CLIENT_ID/SECRET not configured' };
  }
  await ensureExtSchema();
  const cred = await getQbCredential();
  if (!cred) {
    return { source: 'quickbooks', ok: false, rows: 0, skipped: 'QuickBooks not connected — use "Connect QuickBooks"' };
  }

  // Refresh the access token; persist the rotated refresh token if Intuit gave a new one.
  const tok = await refreshAccessToken(cred.refresh_token);
  const at = tok.access_token;
  if (tok.refresh_token && tok.refresh_token !== cred.refresh_token) {
    await saveQbCredential({ refresh_token: tok.refresh_token, realm_id: cred.realm_id, environment: cred.environment, company_name: cred.company_name });
  }

  const base = qbApiBase(cred.environment);
  const realm = cred.realm_id;
  const PAGE = 1000;
  let total = 0, start = 1;
  for (let i = 0; i < 200; i++) {
    const q = encodeURIComponent(`SELECT * FROM Invoice STARTPOSITION ${start} MAXRESULTS ${PAGE}`);
    const r = await fetch(`${base}/v3/company/${realm}/query?query=${q}&minorversion=65`,
      { headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`QuickBooks query ${r.status}`);
    const invoices = (await r.json()).QueryResponse?.Invoice || [];
    if (!invoices.length) break;
    const rows = invoices.map((x) => [
      x.Id, x.DocNumber || null, x.CustomerRef?.name || null,
      x.TxnDate || null, x.DueDate || null, num(x.TotalAmt), num(x.Balance),
      x.CurrencyRef?.value || null, Number(x.Balance) > 0 ? 'open' : 'paid', JSON.stringify(x),
    ]);
    total += await upsertBatch('ext.quickbooks_invoice', COLS, 'id', rows, { jsonCols: ['raw'] });
    start += invoices.length;
    if (invoices.length < PAGE) break;
  }
  return { source: 'quickbooks', ok: true, rows: total };
}
