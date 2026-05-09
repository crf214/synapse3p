-- Enforces that only one PENDING amendment per (paymentInstructionId, field)
-- can exist at a time. Prisma's @@unique cannot express partial indexes, so
-- this must be maintained as a raw SQL migration.
CREATE UNIQUE INDEX "payment_instruction_amendments_pending_field_unique"
ON "payment_instruction_amendments" ("paymentInstructionId", "field")
WHERE "status" = 'PENDING';
