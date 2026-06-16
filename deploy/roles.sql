-- =====================================================================
-- AAA_Database :: create application LOGIN users
-- ---------------------------------------------------------------------
-- 0001_foundation.sql created the permission BUNDLES (NOLOGIN group roles:
-- app_readwrite, app_readonly, app_migrator, crm_sync). This script creates
-- the actual LOGIN accounts your application uses, and grants them a bundle.
-- Because INHERIT is the default, a login user automatically gets the
-- privileges of the group role granted to it.
--
-- Passwords are passed in via `psql -v` (never hardcoded). Idempotent:
-- re-running updates the password and re-grants without error.
--   psql ... -v app_rw_password='...' -v app_ro_password='...' -f deploy/roles.sql
-- (deploy/deploy.sh does this for you from your .env file.)
-- =====================================================================
\set ON_ERROR_STOP on

-- Read/WRITE application user — this is the role your app connects as.
-- It is NOT BYPASSRLS, so row-level security (tenant isolation) is enforced.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw LOGIN;
    END IF;
END $$;
ALTER ROLE app_rw WITH PASSWORD :'app_rw_password';
GRANT app_readwrite TO app_rw;

-- Read-ONLY user — for reporting / dashboards / analytics connections.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_ro') THEN
        CREATE ROLE app_ro LOGIN;
    END IF;
END $$;
ALTER ROLE app_ro WITH PASSWORD :'app_ro_password';
GRANT app_readonly TO app_ro;

-- NOTE (advanced, optional):
--   * Migrations are applied by the provider ADMIN user (deploy.sh uses it),
--     which already bypasses RLS — no separate migrator login is required.
--   * The HubSpot sync worker needs cross-tenant writes to crm.*. Create a
--     dedicated login (e.g. crm_svc) and either grant it crm_sync and have it
--     run `SET ROLE crm_sync`, or give it BYPASSRLS (requires elevated
--     privilege on some managed providers). See deploy/README.md.
