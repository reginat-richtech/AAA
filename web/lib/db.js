import { Pool } from 'pg';

// Single shared pool across hot-reloads in dev.
const globalForPg = globalThis;
const connectionString = process.env.DATABASE_URL || '';

// Managed Postgres (Azure/RDS/etc.) requires TLS; local Docker does not. Enable
// SSL for any non-local host unless the URL explicitly disables it. rejectUnauthorized
// is false so we don't have to ship the provider's CA bundle — the link is still encrypted.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|::1)[:/]/.test(connectionString);
const ssl = isLocal || /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };

export const pool =
  globalForPg._aaaPool ||
  new Pool({ connectionString, max: 5, ssl, connectionTimeoutMillis: 10000 });
if (!globalForPg._aaaPool) globalForPg._aaaPool = pool;

export async function query(text, params) {
  return pool.query(text, params);
}

// Schemas this admin tool is allowed to read in the DB browser.
export const BROWSABLE_SCHEMAS = [
  'core', 'crm', 'hr', 'inventory', 'invoicing', 'legal', 'ops', 'workflow', 'privacy', 'audit',
];

// Confirm a schema.table really exists (guards the DB-browser against
// arbitrary identifier injection — we only interpolate names the catalog
// confirms, and only within the allow-listed schemas).
export async function resolveTable(schema, table) {
  if (!BROWSABLE_SCHEMAS.includes(schema)) return null;
  const { rows } = await query(
    `select table_schema, table_name,
            exists (select 1 from information_schema.columns c
                    where c.table_schema = t.table_schema
                      and c.table_name = t.table_name
                      and c.column_name = 'organization_id') as has_org
     from information_schema.tables t
     where t.table_schema = $1 and t.table_name = $2 and t.table_type = 'BASE TABLE'`,
    [schema, table]
  );
  return rows[0] || null;
}
