-- 20260509000004_simplify_payment_amendment
--
-- 1. Add RECONCILED to PaymentInstructionStatus enum.
-- 2. Simplify PaymentInstructionAmendment: drop field/previousValue/proposedValue,
--    add a single changes JSONB column to store a freeform diff object.
-- 3. Replace the field-scoped partial unique index with an instruction-scoped one
--    (only one PENDING amendment per payment instruction).

-- 1. Add RECONCILED status
ALTER TYPE "PaymentInstructionStatus" ADD VALUE IF NOT EXISTS 'RECONCILED';

-- 2a. Drop the old triple-column unique constraint (paymentInstructionId, field, status)
ALTER TABLE "payment_instruction_amendments"
  DROP CONSTRAINT IF EXISTS "payment_instruction_amendments_paymentInstructionId_field_status_key";

-- 2b. Drop the field-specific partial unique index from migration 000001
DROP INDEX IF EXISTS "payment_instruction_amendments_pending_field_unique";

-- 2c. Drop old per-field columns and add the freeform changes column
ALTER TABLE "payment_instruction_amendments"
  DROP COLUMN IF EXISTS "field",
  DROP COLUMN IF EXISTS "previousValue",
  DROP COLUMN IF EXISTS "proposedValue",
  ADD COLUMN IF NOT EXISTS "changes" JSONB NOT NULL DEFAULT '{}';

-- 2d. Drop the AmendmentField enum (safe now that no column references it)
DROP TYPE IF EXISTS "AmendmentField";

-- 3. New partial unique index: only one PENDING amendment per instruction
CREATE UNIQUE INDEX IF NOT EXISTS "payment_instruction_amendments_pending_unique"
  ON "payment_instruction_amendments" ("paymentInstructionId")
  WHERE "status" = 'PENDING';
