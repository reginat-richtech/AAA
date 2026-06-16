# AAA_Database

A secure, multi-tenant **PostgreSQL 16** database for four business domains —
**invoicing**, **CRM (HubSpot mirror)**, **HR / working-time**, **inventory** —
plus **legal agreements** for customer deals. Security (tenant isolation,
encryption, audit, and privacy controls) is built into the schema itself, not
bolted on afterward.

> Status: **schema + full security layer complete and validated** against real
> PostgreSQL 16 (all migrations `0001`–`0120` load clean; verify with
> [`db/validate.sh`](db/validate.sh)). Remaining work is documentation and ops
> hardening — see [Roadmap](#roadmap).

## Architecture at a glance

One database, **one schema per domain** for clean isolation and per-domain access control:

| Schema | Purpose | Tables |
|--------|---------|-------:|
| `core` | Shared foundation: organizations (tenants), application users, roles, country/currency reference data | 6 |
| `audit` | Append-only change history (`activity_log`, partitioned by time) + point-in-time history for pay & invoices | 5 |
| `crm` | **Read-only mirror** of HubSpot contacts / companies / deals + consent + sync tracking | 7 |
| `hr` | Employees, employment, departments, working-time (timesheets, shifts, attendance, leave), compensation | 11 |
| `inventory` | Products, categories, warehouses/locations, stock levels, stock movements, suppliers, purchase orders | 10 |
| `invoicing` | Invoices, line items, tax, **tokenized** payments, payment allocations, credit notes | 8 |
| `legal` | Customer deal agreements, versions, signatories, parties, **document metadata** (files live in object storage), access log | 8 |
| `sec` | Column-encryption / blind-index helper **functions** (no tables — keys are injected from your KMS per session) | 0 |
| `privacy` | GDPR/CCPA governance: data-classification catalog, retention policy, right-to-erasure & DSAR tracking | 5 |

**60 tables total; 47 have row-level security enabled.** The domains connect:
`legal.agreement_link → invoicing.invoice`, `invoicing.invoice_line_item → inventory.product`,
and CRM links are intentionally *loose* (stored HubSpot IDs, no hard FK) because the mirror can be re-synced.

## How security is built in

| Control | How it works here | Why |
|---|---|---|
| **Tenant isolation** | Row-level security (RLS) on 46 tables; every query is scoped to the caller's `organization_id` via a session setting. Cross-tenant inserts are rejected. | One tenant can never see or write another's data, even with a query bug. |
| **No raw payment data** | `invoicing.payment` stores only a processor **token + brand + last4** — never card/bank numbers. | Keeps the database out of PCI-DSS scope entirely. |
| **Column encryption** | Sensitive HR fields (national ID, bank, salary) are stored encrypted (`bytea` via pgcrypto); keys come from an external KMS, never the DB. | A database dump alone does not expose the most sensitive fields. |
| **Audit trail** | A trigger writes before/after row images (with sensitive values redacted) to append-only `audit.activity_log`. App roles cannot modify history. | Tamper-evident record of who changed what, when. |
| **Privacy / GDPR** | PII tables carry `pseudonymized_at`; erasure overwrites identifiers while preserving financial/legal records. CRM consent is tracked. | Right-to-erasure without breaking referential integrity. |
| **No ID enumeration** | Internal `bigint` keys never leave the system; external references use random `public_id` UUIDs. | Sequential IDs don't leak business volume (invoice counts, customer counts). |
| **Least privilege** | Distinct database roles (`app_readwrite`, `app_readonly`, `crm_sync`, `app_migrator`) + application RBAC roles in `core.role`. | Each component gets only the access it needs. |
| **Soft delete** | `deleted_at` tombstones instead of hard deletes on the request path. | Accidental/ malicious deletes are recoverable; history stays intact. |

### Security functions (built and validated — migrations `0100`–`0120`)

The controls above are implemented as callable SQL in the `sec`, `audit`, and `privacy` schemas:

| Function | What it does |
|---|---|
| `sec.encrypt` / `sec.decrypt` | Column encryption (pgcrypto). Fails **closed** if the per-session KMS key (`app.enc_key`) is absent. |
| `sec.blind_index` | Deterministic keyed HMAC for equality lookups on encrypted columns *without* decrypting them. |
| `audit.if_modified` | Audit trigger: redact **or** keyed-hash sensitive columns, stamp actor/tenant, maintain a tamper-evident hash chain. |
| `audit.verify_activity_log_chain` | Detects any tampering with the append-only audit log. |
| `audit.compensation_as_of` / `audit.invoice_as_of` | Point-in-time reconstruction of pay and invoice records. |
| `privacy.erase_person` | Right-to-erasure: pseudonymizes a person while preserving required financial/legal records and honoring `legal_hold`. |
| `privacy.run_retention_purge` | Policy-driven retention purge, with a per-run audit log. |
| `privacy.export_subject_data` | DSAR: gathers everything held about a person into one JSON document. |
| `crm.has_marketing_consent` / `crm.assert_marketing_consent` | Enforce marketing consent before a contact is messaged. |

A consolidated `docs/security-model.md` (full role matrix + policy catalog) is still pending — see [Roadmap](#roadmap).

## Repository layout

```
db/
  migrations/      0001..0050 domain schema + 0100..0120 security layer (apply in order) + README
  seeds/           0001_reference_data.sql (countries, currencies, system roles)
  examples/        usage_walkthrough.sql (runnable end-to-end store/read + encryption demo)
  run_local.sh     start a persistent local PostgreSQL 16 (Docker) and apply everything
  validate.sh      spins up a throwaway PostgreSQL 16 and verifies everything loads
deploy/            deploy.sh + roles.sql — apply schema + login roles to a managed cloud DB
docs/              usage.md (done); data-model / security-model / operations (pending)
README.md          this file
```

## Getting started

**Prerequisites:** just **Docker** (Docker Desktop running). No local `psql`/PostgreSQL install needed.

```bash
# Start a persistent local database (creates it, applies all migrations + seeds):
./db/run_local.sh

# Open an interactive SQL shell:
./db/run_local.sh psql

# Run the end-to-end store/read demo:
./db/run_local.sh demo

# Stop / resume / wipe:
docker stop aaa_db        # stop (data kept in a Docker volume)
docker start aaa_db       # resume
./db/run_local.sh --reset # wipe and rebuild clean
```

Other helpers:

```bash
./db/validate.sh          # verify everything loads cleanly in a throwaway container (no data kept)
```

If you later install a PostgreSQL client and want to apply the migrations to your own server,
see `db/migrations/README.md` for the plain `psql` loop. Day-to-day usage (storing/reading data,
the security rules) is documented in `docs/usage.md`.

At runtime your application connects as `app_readwrite` and sets the tenant
context per transaction so RLS can isolate data:

```sql
SET LOCAL app.current_organization_id = '<organization id>';
SET LOCAL app.current_user_id        = '<app_user public_id>';  -- for audit attribution
```

## Roadmap

Complete and validated:
- [x] Foundation: schemas, core identity/tenant tables, audit, roles, reference data
- [x] All four domains + legal agreements — load clean in dependency order
- [x] RLS, audit triggers, payment tokenization, encrypted columns, soft-delete
- [x] **Cross-cutting security layer (`0100`–`0120`):** column encryption + blind index (`sec.*`); tamper-evident hash-chained audit + point-in-time history (`audit.*`); privacy/retention/erasure/DSAR with `legal_hold` override + CRM consent enforcement (`privacy.*`, `crm.*`); least-privilege grants
- [x] Reference seed data + reusable validation script (`db/validate.sh`) + cloud deploy script (`deploy/`)

In progress / next:
- [ ] `docs/data-model.md` (ER diagram), `docs/security-model.md` (role matrix + policy catalog), `docs/operations.md`
- [ ] Standalone hardened `postgresql.conf` / `pg_hba.conf` samples (inline guidance currently lives in `0110`)
- [ ] Down/rollback scripts + `schema_migrations` ledger for production

> Defaults chosen for you (all changeable): PostgreSQL 16, one DB with a schema
> per domain, GDPR-style privacy + SOC 2-style access control, payment data
> tokenized (out of PCI scope), HubSpot treated as a read-only source of truth.
