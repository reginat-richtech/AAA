-- =====================================================================
-- AAA_Database :: invoice — SO (Sales Order) number
-- Target: PostgreSQL 16+   Depends on 0240_invoice.
-- Internal reference number, autofilled on the invoice from the linked
-- project's Technician Request submission. Idempotent.
-- =====================================================================
ALTER TABLE ops.invoice ADD COLUMN IF NOT EXISTS so_number text;
