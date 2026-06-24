-- 0150_app_audit.sql
-- ----------------------------------------------------------------------------
-- Bring the web application's working tables under the same tamper-evident,
-- hash-chained audit trail (audit.activity_log via audit.if_modified) as the
-- canonical domain schema. "Who did what, when, and exactly what changed."
--
-- The app's tables live in two ownership domains, so attachment happens in two
-- places by necessity:
--
--   * ext.*  — created at application runtime by the web app's ensureExtSchema()
--              running as the app role (app_rw). Because that role OWNS those
--              tables, the app attaches their audit triggers itself, at runtime,
--              via audit.attach_audit(). This migration only needs to GRANT the
--              app role the EXECUTE it needs to do so (it has none by default).
--
--   * ops.* / inventory.* — created by earlier migrations and owned by the
--              migration admin. The app role cannot run DDL on them, so we
--              attach their audit triggers HERE, as admin.
--
-- The acting user is recorded by the app: lib/db.mutateAs() opens a transaction
-- and sets `app.current_user_id`, which audit.if_modified() reads via
-- core.current_app_user_id() into audit.activity_log.actor_app_user_id.
--
-- Idempotent and safe to re-run (audit.attach_audit drops+recreates; grants are
-- repeatable; missing tables are skipped).
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Let the application role attach audit triggers to the tables it owns
--    (ext.*). Creating a trigger that calls these functions requires EXECUTE on
--    them; the app role is granted none by default. Granted to the app_readwrite
--    group role (app_rw inherits it), matching the existing grant style in 0110.
GRANT EXECUTE ON FUNCTION audit.attach_audit(text, text, text, text) TO app_readwrite;
GRANT EXECUTE ON FUNCTION audit.if_modified()                        TO app_readwrite;
GRANT EXECUTE ON FUNCTION audit.log_truncate()                       TO app_readwrite;

-- 2. Attach the audit trail to the admin-owned tables the app edits. Guarded per
--    table: a not-yet-created table is skipped, and any single failure (e.g. an
--    ownership quirk on a managed provider) is logged and skipped rather than
--    aborting the whole deploy.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
            ('ops',       'legal_agreement'),
            ('ops',       'tech_request_submission'),
            ('inventory', 'project_allocation')
        ) AS x(sch, tbl)
    LOOP
        IF to_regclass(format('%I.%I', t.sch, t.tbl)) IS NULL THEN
            RAISE NOTICE 'audit 0150: %.% absent — skipping', t.sch, t.tbl;
            CONTINUE;
        END IF;
        BEGIN
            PERFORM audit.attach_audit(t.sch, t.tbl);
            RAISE NOTICE 'audit 0150: attached audit to %.%', t.sch, t.tbl;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'audit 0150: could not attach to %.% (%) — skipping', t.sch, t.tbl, SQLERRM;
        END;
    END LOOP;
END
$$;

COMMIT;
