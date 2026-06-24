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

// Run write(s) attributed to a known app user, so the tamper-evident audit
// trigger (audit.if_modified) records WHO did it in audit.activity_log.
// Opens ONE transaction on a dedicated connection, resolves the user's stable
// UUID (ext.app_user.id), sets `app.current_user_id` transaction-locally
// (set_config(..., true) never leaks to the next borrower of the pooled
// connection), runs fn(q) with q bound to that same connection, then commits
// (or rolls back on throw). Reads can still use query(); only writes that
// should be attributed need this.
//
//   const row = await mutateAs(user.email, async (q) => {
//     const { rows } = await q('update ext.task set status=$2 where id=$1 returning *', [id, status]);
//     return rows[0];
//   });
export async function mutateAs(actorEmail, fn) {
  const email = String(actorEmail || '').trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (email) {
      let id = (await client.query('select id from ext.app_user where lower(email) = $1', [email])).rows[0]?.id;
      if (!id) {
        // Safety net: user not recorded yet (touchUser normally does this on sign-in).
        id = (await client.query(
          `insert into ext.app_user (email, role) values ($1, 'user')
             on conflict (email) do update set email = excluded.email
           returning id`,
          [email],
        )).rows[0]?.id;
      }
      if (id) await client.query(`select set_config('app.current_user_id', $1, true)`, [String(id)]);
    }
    const result = await fn((text, params) => client.query(text, params));
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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
