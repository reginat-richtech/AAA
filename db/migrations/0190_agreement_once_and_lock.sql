-- =====================================================================
-- AAA_Database :: agreement "submit once" + finalize lock
-- Target: PostgreSQL 16+   Depends on 0080_ops_features (ops.legal_agreement).
--
-- Two additive, idempotent changes to ops.legal_agreement:
--   * contract_number — the proposal's Contract/SO # captured at upload, so an
--     agreement is tied to exactly one proposal. A partial-UNIQUE index enforces
--     at most ONE agreement per contract (proposal-driven uploads only; ad-hoc
--     uploads with no contract are unaffected).
--   * finalized — set true on the first Save; afterward only admins may edit
--     (enforced in /api/data-upload/[id] PATCH, not by the DB).
-- Self-contained + idempotent.
-- =====================================================================
ALTER TABLE ops.legal_agreement ADD COLUMN IF NOT EXISTS contract_number text;
ALTER TABLE ops.legal_agreement ADD COLUMN IF NOT EXISTS finalized boolean NOT NULL DEFAULT false;

-- One agreement per contract/SO (case-insensitive); NULLs (ad-hoc uploads) exempt.
CREATE UNIQUE INDEX IF NOT EXISTS ux_legal_agreement_contract
    ON ops.legal_agreement (lower(contract_number))
    WHERE contract_number IS NOT NULL;
