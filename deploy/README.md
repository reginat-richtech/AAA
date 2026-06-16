# Deploying AAA_Database to the cloud

Goal: a managed PostgreSQL 16 instance in the cloud, with the full schema +
roles applied, that your app can write to securely. You only need **Docker**
locally (the deploy script runs `psql` inside a container).

## Step 0 — Pick a managed PostgreSQL (don't self-host)

A *managed* service handles backups, patching, encryption-at-rest, and failover
for you. Any of these work — the schema needs only PostgreSQL **16** with the
`pgcrypto` and `citext` extensions (all of them have these):

| Provider | Good when | Notes |
|---|---|---|
| **Neon** or **Supabase** | You want the simplest start | Generous free tiers, Postgres 16, fast setup |
| **AWS RDS / Aurora PostgreSQL** | You're on AWS | Pair with AWS Secrets Manager + KMS |
| **GCP Cloud SQL** | You're on GCP | Pair with Secret Manager + Cloud KMS |
| **Azure Database for PostgreSQL** | You're on Azure | Pair with Key Vault |

When you create the instance, choose: **PostgreSQL 16**, **storage encryption ON**,
**automated backups / point-in-time-recovery ON**, and **private networking** (no
public IP if your app is in the same cloud; otherwise restrict access to your
app's IP). Create an empty database named `aaa`.

### Azure Database for PostgreSQL (Flexible Server) — required prep

1. **Allow-list the extensions** (or `0001` fails on `CREATE EXTENSION`):
   Portal → your server → **Server parameters** → `azure.extensions` →
   enable **PGCRYPTO** and **CITEXT** → Save.
2. **Open the firewall** to wherever you run the deploy:
   Portal → **Networking** → add your current client IP (or use VNet/private access).
3. **Create the database** named `aaa`.
4. `.env` values: `PGHOST=<name>.postgres.database.azure.com`, `PGPORT=5432`,
   `PGADMIN_USER=<your admin login>` (plain name on Flexible Server — no `@server`
   suffix), `PGADMIN_PASSWORD=<admin password>`, `PGSSLMODE=require` to start
   (Azure enforces TLS; upgrade to `verify-full` with Azure's CA cert later).
   No superuser is needed — the `BYPASSRLS` roles fall back automatically.

## Step 1 — Configure your environment file

```bash
cp .env.example .env.production      # then edit it
```

Fill in the host/port/admin-password your provider shows you, and choose
passwords for `APP_RW_PASSWORD` / `APP_RO_PASSWORD`. For `verify-full` SSL,
download your provider's CA certificate into `deploy/certs/server-ca.pem`
(or set `PGSSLMODE=require` to skip cert verification for a first test).

`.env.production` is gitignored — keep real secrets in your provider's secret
manager and inject them; never commit them.

## Step 2 — Deploy

```bash
./deploy/deploy.sh production
```

This connects as your admin user and, idempotently:
1. applies every migration `0001 … 0120` in order,
2. loads the reference seed data,
3. creates the `app_rw` and `app_ro` **login users** (granted the permission bundles).

Re-running is safe; run it again whenever you add migrations.

## Step 3 — Point your application at it

Your app connects using `APP_DATABASE_URL` (as `app_rw`, over TLS). On every
request/transaction it must set the tenant + user context so row-level security
works, and (when touching encrypted columns) inject the KMS keys:

```sql
SET app.current_organization_id = 42;
SET app.current_user_id        = '<app_user public_id>';
SET app.enc_key                = '<from KMS>';        -- only if reading/writing encrypted columns
SET app.blind_index_key        = '<from KMS>';
```

See `../docs/usage.md` for full insert/select patterns.

## Security checklist (high-security deployment)

- [ ] App connects as **`app_rw`**, never the admin/master user.
- [ ] TLS enforced end-to-end (`sslmode=verify-full` with the provider CA).
- [ ] No public IP, or access restricted to your app's network/IP allowlist.
- [ ] All passwords + the two encryption keys live in a **secret manager**, not in files or code.
- [ ] `APP_ENC_KEY` / `APP_BLIND_INDEX_KEY` come from a **KMS**; rotate on a schedule.
- [ ] Automated backups + point-in-time recovery enabled; test a restore.
- [ ] Audit log (`audit.activity_log`) and provider logs shipped to your monitoring.

## Troubleshooting

- **`must be superuser to create role ... BYPASSRLS`** while applying `0001`:
  some managed providers restrict `BYPASSRLS`. Run the migrations as the
  provider's most-privileged user (e.g. `rds_superuser` on RDS). If still blocked,
  the only affected roles are the cross-tenant `app_migrator` / `crm_sync`
  bundles — your app's `app_rw` path is unaffected; contact me to adjust the
  CRM-sync approach to per-tenant writes instead.
- **`connection ... SSL`** errors: start with `PGSSLMODE=require` to confirm
  connectivity, then upgrade to `verify-full` once the CA cert is in place.
- **`extension "pgcrypto" ... permission denied`**: enable `pgcrypto` and
  `citext` via the provider console/UI first (some require pre-approval), then re-run.
