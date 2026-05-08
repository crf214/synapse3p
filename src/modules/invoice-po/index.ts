/**
 * Invoice & PO Management module
 *
 * Owns: invoices (ingestion, AI processing, quarantine, recurring), purchase orders,
 *       service engagements, merged authorizations, approvals, service catalogue,
 *       processing rules, approval workflows
 *
 * API routes: /api/invoices/**, /api/purchase-orders/**, /api/service-engagements/**,
 *             /api/service-catalogue/**, /api/merged-authorizations/**,
 *             /api/approvals/**, /api/approval-workflows/**,
 *             /api/auto-approve-policies/**, /api/processing-rules/**
 *
 * Dashboard: /dashboard/invoices/**, /dashboard/purchase-orders/**,
 *            /dashboard/service-engagements/**, /dashboard/approvals,
 *            /dashboard/merged-authorizations/**,
 *            /dashboard/settings/service-catalogue,
 *            /dashboard/settings/processing-rules,
 *            /dashboard/settings/approval-workflows
 *
 * Key lib files (pending migration from src/lib/):
 *   - src/lib/invoice-ai.ts       → migrate to src/modules/invoice-po/lib/invoice-ai.ts
 *   - src/lib/invoice-pipeline.ts → migrate to src/modules/invoice-po/lib/invoice-pipeline.ts
 */

// Domain lib re-exports — add here as logic is migrated into this module
export {}
