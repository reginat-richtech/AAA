-- =====================================================================
-- AAA_Database :: PROPOSAL PROJECT NUMBER
-- Target: PostgreSQL 16+   Depends on 0080_ops_features (project_number_seq)
--                          and 0170_project_proposal (ops.project_proposal).
--
-- A proposal is the first step of a project, but until now it had no project
-- number of its own — the Project Tracker fell back to showing the contract
-- number in the project-number slot. This gives every proposal its own
-- auto-minted PRJ-##### from the SAME sequence agreements use, so proposals and
-- agreements share one numbering scheme. The contract number stays as its own
-- distinct field. Self-contained + idempotent (the runner re-applies every file).
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS ops;

-- 1. Add the column (nullable first so existing rows can be backfilled).
ALTER TABLE ops.project_proposal ADD COLUMN IF NOT EXISTS project_number text;

-- 2. Auto-mint for future inserts (same sequence + format as ops.legal_agreement).
ALTER TABLE ops.project_proposal
  ALTER COLUMN project_number
  SET DEFAULT ('PRJ-' || lpad(nextval('ops.project_number_seq')::text, 5, '0'));

-- 3. Backfill any rows that don't have a number yet (idempotent: only fills NULLs).
--    nextval() is evaluated per row, so each gets a distinct PRJ number.
UPDATE ops.project_proposal
   SET project_number = 'PRJ-' || lpad(nextval('ops.project_number_seq')::text, 5, '0')
 WHERE project_number IS NULL;

-- 4. Enforce the invariant now that every row has a value.
ALTER TABLE ops.project_proposal ALTER COLUMN project_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_project_proposal_project_number
  ON ops.project_proposal (project_number);
