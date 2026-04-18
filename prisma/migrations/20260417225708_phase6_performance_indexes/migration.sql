-- Phase 6: Performance indexes for high-traffic query patterns
-- These are all partial or composite indexes that cannot be expressed in
-- Prisma schema syntax, so they are managed here as raw SQL.

-- High traffic query indexes
CREATE INDEX IF NOT EXISTS "invoices_org_entity_status" ON invoices ("orgId", "entityId", status);
CREATE INDEX IF NOT EXISTS "invoices_org_due_date" ON invoices ("orgId", "dueDate") WHERE status NOT IN ('PAID', 'CANCELLED');
CREATE INDEX IF NOT EXISTS "payment_instructions_org_status_due" ON payment_instructions ("orgId", status, "dueDate");
CREATE INDEX IF NOT EXISTS "entity_activity_logs_entity_occurred" ON entity_activity_logs ("entityId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "external_signals_entity_severity" ON external_signals ("entityId", severity) WHERE dismissed = false;
CREATE INDEX IF NOT EXISTS "third_party_reviews_next_review" ON third_party_reviews ("nextReviewDate") WHERE status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS "entity_risk_scores_entity_scored" ON entity_risk_scores ("entityId", "scoredAt" DESC);
CREATE INDEX IF NOT EXISTS "erp_transactions_entity_date" ON erp_transactions ("entityId", "transactionDate" DESC);
CREATE INDEX IF NOT EXISTS "recurring_schedules_org_active" ON recurring_schedules ("orgId") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "purchase_orders_org_status" ON purchase_orders ("orgId", status, "createdAt" DESC);