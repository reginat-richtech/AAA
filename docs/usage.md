# Using AAA_Database — storing and reading data

Every interaction follows **three steps**: connect as a role → set the tenant
context → run your queries. The context step is mandatory here; skip it and
row-level security (RLS) shows you **zero rows** and rejects your writes.

> A complete, runnable version of everything below lives in
> [`db/examples/usage_walkthrough.sql`](../db/examples/usage_walkthrough.sql)
> (verified end-to-end). Run it with `psql -f db/examples/usage_walkthrough.sql`.

## 1. Connect as the right role

| Role | Use it for |
|------|-----------|
| `app_readwrite` | Normal application reads **and** writes. RLS enforced. **This is your default.** |
| `app_readonly` | Reporting / dashboards. Read-only. RLS enforced. |
| `crm_sync` | The **only** writer to `crm.*` (the HubSpot mirror). Used by your sync job. |
| `app_migrator` / superuser | Bootstrapping tenants and running migrations only. **Bypasses RLS** — never use for normal app traffic. |

## 2. Set the session context (required, every request)

```sql
SET app.current_organization_id = 42;                          -- which tenant you are acting as
SET app.current_user_id        = '7f3c...uuid...';             -- app_user.public_id, for audit trail
-- only needed when touching encrypted columns (keys come from your KMS):
SET app.enc_key         = '...data key...';
SET app.blind_index_key = '...separate hash key...';
```

Use `SET LOCAL` (instead of `SET`) inside a transaction so the context is scoped
to that one transaction — ideal for a per-request connection from a pool.

**Why:** every tenant-scoped table filters rows by `organization_id` automatically.
The value comes from `app.current_organization_id`. No context = no rows, and any
`INSERT` for another tenant is blocked.

## 3. Store data

```sql
-- A customer to bill (organization_id is validated by RLS):
INSERT INTO invoicing.bill_to_customer (organization_id, display_name)
VALUES (42, 'Beta Manufacturing LLC');

-- A product:
INSERT INTO inventory.product (organization_id, sku, name, unit_of_measure_id, list_price, currency_code)
VALUES (42, 'WID-001', 'Standard Widget', 1, 25.00, 'USD');

-- An invoice + line item (amounts default to 0; status defaults to 'draft'):
INSERT INTO invoicing.invoice (organization_id, bill_to_customer_id, invoice_number, currency_code)
VALUES (42, 100, 'INV-1001', 'USD');

INSERT INTO invoicing.invoice_line_item
       (organization_id, invoice_id, line_number, kind, product_id, description, quantity, unit_price)
VALUES (42, 500, 1, 'product', 200, 'Standard Widget', 10, 25.00);
```

## 4. Read data

```sql
-- Always exclude soft-deleted rows with: WHERE ... deleted_at IS NULL
SELECT inv.invoice_number, c.display_name AS bill_to,
       li.description, li.quantity, li.unit_price, inv.currency_code
FROM invoicing.invoice inv
JOIN invoicing.bill_to_customer  c  ON c.id = inv.bill_to_customer_id
JOIN invoicing.invoice_line_item li ON li.invoice_id = inv.id
JOIN inventory.product           p  ON p.id = li.product_id
WHERE inv.deleted_at IS NULL
ORDER BY li.line_number;
```

You never write `WHERE organization_id = 42` for security — RLS adds that filter
for you. (You may still add it as an index hint / for clarity.)

## 5. Encrypted columns (sensitive HR data, etc.)

Store ciphertext with `sec.encrypt()`, store a deterministic `sec.blind_index()`
hash alongside it so you can search without decrypting, and decrypt on read with
`sec.decrypt()`:

```sql
INSERT INTO hr.employee (organization_id, employee_number, legal_first_name, legal_last_name,
                         national_id_enc, national_id_hash, national_id_country)
VALUES (42, 'E-1001', 'Dana', 'Lee',
        sec.encrypt('123-45-6789'), sec.blind_index('123-45-6789'), 'US');

-- Find by national id WITHOUT decrypting, then decrypt the match:
SELECT employee_number, sec.decrypt(national_id_enc) AS national_id
FROM hr.employee
WHERE organization_id = 42
  AND national_id_hash = sec.blind_index('123-45-6789')
  AND deleted_at IS NULL;
```

If `app.enc_key` is not set, these functions fail closed (raise an error) rather
than write unusable data.

## The rules to remember

| Rule | Why |
|------|-----|
| Set `app.current_organization_id` before any query | RLS isolates tenants; no context = no data |
| Connect as `app_readwrite` / `app_readonly`, **not** superuser | Superuser bypasses all RLS |
| Always filter `WHERE deleted_at IS NULL` | Deletes are soft (tombstones), not physical |
| Use `public_id` (UUID) in URLs/APIs, never the internal `id` | `id` is internal; sequential ids leak business volume |
| Money is `numeric` + a `currency_code`; never floats | Avoids rounding errors |
| Payments store only a processor **token + last4** | No raw card/bank numbers — keeps you out of PCI scope |
| `crm.*` is read-only except for the `crm_sync` job | It mirrors HubSpot; HubSpot is the source of truth |
| Inject encryption keys from your KMS per session | Keys are never stored in the database |

## Verify it yourself

```bash
./db/validate.sh                                   # rebuild the whole schema in a throwaway DB
psql -f db/examples/usage_walkthrough.sql          # run the full store/read demo (needs migrations applied)
```
