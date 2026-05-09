-- Add RECURRING to InvoiceSource enum
ALTER TYPE "InvoiceSource" ADD VALUE IF NOT EXISTS 'RECURRING';

-- Add nextRunAt to recurring_schedules (null = never run, eligible immediately)
ALTER TABLE "recurring_schedules" ADD COLUMN "nextRunAt" TIMESTAMP(3);

-- Index for the cron query: active schedules due to run
CREATE INDEX "recurring_schedules_isActive_nextRunAt_idx" ON "recurring_schedules"("isActive", "nextRunAt");
