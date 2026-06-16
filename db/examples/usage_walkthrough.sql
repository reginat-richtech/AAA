-- =====================================================================
-- AAA_Database :: USAGE WALKTHROUGH  (store & read data, end to end)
-- Run against a database that already has all migrations + seeds applied:
--     psql -v ON_ERROR_STOP=1 -f db/examples/usage_walkthrough.sql
--
-- Shows the patterns THIS database REQUIRES:
--   1. Bootstrap tenants/users as a privileged role (RLS-bypassing).
--   2. App work as app_readwrite with per-session tenant + user context.
--   3. Writing & reading across domains (inventory -> invoicing).
--   4. Encrypted columns (sec.encrypt / sec.decrypt + blind-index lookup).
--   5. Soft delete (rows are tombstoned, never hard-deleted on the app path).
--   6. Proof that row-level security isolates tenants from each other.
-- =====================================================================
\set ON_ERROR_STOP on

\echo ''
\echo '### 1. BOOTSTRAP  (privileged role: superuser or app_migrator -- bypasses RLS)'
-- Tenants live in core.organization. Creating the FIRST org cannot be done by a
-- normal app role (RLS would block it), so bootstrap as a trusted admin.
INSERT INTO core.organization (legal_name, display_name, slug) VALUES
    ('Acme Robotics Inc',  'Acme',   'acme'),
    ('Globex Corporation', 'Globex', 'globex')
ON CONFLICT DO NOTHING;
SELECT id AS org_a FROM core.organization WHERE slug = 'acme'   \gset
SELECT id AS org_b FROM core.organization WHERE slug = 'globex' \gset

-- A login account (NOT an employee) belonging to Acme.
INSERT INTO core.app_user (organization_id, email) VALUES (:org_a, 'ops@acme.example')
ON CONFLICT DO NOTHING;
SELECT public_id AS user_a FROM core.app_user WHERE email = 'ops@acme.example' \gset

-- A global unit of measure (lookup table, not tenant-scoped).
INSERT INTO inventory.unit_of_measure (code, name) VALUES ('EA','Each') ON CONFLICT DO NOTHING;
SELECT id AS uom_ea FROM inventory.unit_of_measure WHERE code = 'EA' \gset
\echo '   bootstrapped tenants Acme + Globex and one app user'

\echo ''
\echo '### 2. ENTER TENANT CONTEXT  (your app does this at the start of every request)'
SET ROLE app_readwrite;                       -- least-privilege application role (RLS enforced)
SET app.current_organization_id = :org_a;     -- REQUIRED: scopes every query to Acme
SET app.current_user_id        = :'user_a';   -- attributes audit-log entries to this user

\echo ''
\echo '### 3. WRITE business data  (organization_id is checked by RLS on every insert)'
INSERT INTO invoicing.bill_to_customer (organization_id, display_name)
VALUES (:org_a, 'Beta Manufacturing LLC');
SELECT id AS cust_a FROM invoicing.bill_to_customer
 WHERE organization_id = :org_a AND display_name = 'Beta Manufacturing LLC' \gset

INSERT INTO inventory.product
    (organization_id, sku, name, unit_of_measure_id, list_price, currency_code, created_by)
VALUES (:org_a, 'WID-001', 'Standard Widget', :uom_ea, 25.00, 'USD', :'user_a');
SELECT id AS prod_a FROM inventory.product WHERE organization_id = :org_a AND sku = 'WID-001' \gset

INSERT INTO invoicing.invoice
    (organization_id, bill_to_customer_id, invoice_number, currency_code, created_by)
VALUES (:org_a, :cust_a, 'INV-1001', 'USD', :'user_a');
SELECT id AS inv_a FROM invoicing.invoice WHERE organization_id = :org_a AND invoice_number = 'INV-1001' \gset

INSERT INTO invoicing.invoice_line_item
    (organization_id, invoice_id, line_number, kind, product_id, description, quantity, unit_price)
VALUES (:org_a, :inv_a, 1, 'product', :prod_a, 'Standard Widget', 10, 25.00);
\echo '   wrote 1 customer, 1 product, 1 invoice + 1 line item'

\echo ''
\echo '### 4. READ data back  (cross-domain join: invoice -> line -> product -> customer)'
SELECT inv.invoice_number, c.display_name AS bill_to, li.line_number,
       p.sku, li.description, li.quantity, li.unit_price, inv.currency_code
FROM invoicing.invoice inv
JOIN invoicing.bill_to_customer  c  ON c.id  = inv.bill_to_customer_id
JOIN invoicing.invoice_line_item li ON li.invoice_id = inv.id
JOIN inventory.product           p  ON p.id  = li.product_id
WHERE inv.deleted_at IS NULL          -- ALWAYS exclude soft-deleted rows
ORDER BY li.line_number;

\echo ''
\echo '### 5. ENCRYPTED COLUMNS  (store a secret, look it up WITHOUT decrypting, then decrypt)'
-- Keys come from your KMS; injected per session, NEVER stored in the database.
SET app.enc_key         = 'demo-data-key--use-kms-in-prod';
SET app.blind_index_key = 'demo-blind-index-key--from-kms';
INSERT INTO hr.employee
    (organization_id, employee_number, legal_first_name, legal_last_name,
     national_id_enc, national_id_hash, national_id_country)
VALUES (:org_a, 'E-1001', 'Dana', 'Lee',
        sec.encrypt('123-45-6789'),        -- stored as ciphertext (bytea)
        sec.blind_index('123-45-6789'),    -- deterministic hash, enables lookup
        'US');

SELECT employee_number, legal_first_name, legal_last_name,
       sec.decrypt(national_id_enc) AS national_id_decrypted
FROM hr.employee
WHERE organization_id = :org_a
  AND national_id_hash = sec.blind_index('123-45-6789')   -- lookup by hash, no decryption
  AND deleted_at IS NULL;

\echo ''
\echo '### 6. SOFT DELETE  (tombstone, not a physical delete)'
UPDATE inventory.product SET deleted_at = now(), updated_by = :'user_a'
WHERE organization_id = :org_a AND sku = 'WID-001';
SELECT count(*) AS live_products FROM inventory.product
WHERE organization_id = :org_a AND deleted_at IS NULL;     -- => 0 (WID-001 now hidden)

\echo ''
\echo '### 7. TENANT ISOLATION  (switch session to Globex; Acme data must be invisible)'
SET app.current_organization_id = :org_b;
SELECT count(*) AS acme_invoices_visible_to_globex FROM invoicing.invoice;   -- => 0

\echo '   -- writing Acme data while in Globex context should be REJECTED by RLS:'
\set ON_ERROR_STOP off
INSERT INTO invoicing.bill_to_customer (organization_id, display_name)
VALUES (:org_a, 'cross-tenant row');     -- expected: new row violates row-level security policy
\set ON_ERROR_STOP on

RESET ROLE;
\echo ''
\echo '### DONE -- all patterns demonstrated.'
