import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../lib/access';
import { query, BROWSABLE_SCHEMAS } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lists the browsable tables (grouped by schema) with exact row counts.
// Admin-only. Counts reflect what the app's DB role (app_rw) can see.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  // Tables (and partitioned parents, but not individual partitions). Names come
  // from the catalog, so they are safe to interpolate (quoted) into the count query.
  const { rows: tables } = await query(
    `select n.nspname as schema, c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p') and not c.relispartition and n.nspname = any($1)
      order by n.nspname, c.relname`,
    [BROWSABLE_SCHEMAS]
  );
  if (!tables.length) return NextResponse.json({ schemas: [] });

  // One round-trip for all counts.
  const sql = tables
    .map((t) => `select '${t.schema}.${t.name}' as rel, (select count(*) from "${t.schema}"."${t.name}") as n`)
    .join(' union all ');
  const { rows: counts } = await query(sql);
  const byRel = {};
  for (const r of counts) byRel[r.rel] = Number(r.n);

  // Only surface tables that actually hold data. This hides the empty schema
  // scaffolding (crm / hr / invoicing / legal / workflow, and unused core/privacy
  // tables) so the browser lists just the tables worth opening. A schema left
  // with no non-empty tables drops out of the list entirely.
  const grouped = {};
  for (const t of tables) {
    const rows = byRel[`${t.schema}.${t.name}`] ?? 0;
    if (rows <= 0) continue;
    (grouped[t.schema] = grouped[t.schema] || []).push({ name: t.name, rows });
  }
  return NextResponse.json({
    schemas: Object.entries(grouped).map(([schema, tbls]) => ({ schema, tables: tbls })),
  });
}
