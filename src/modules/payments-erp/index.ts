/**
 * Payments & ERP module
 *
 * Owns: payment instructions, payment executions, ERP sync (NetSuite),
 *       bank account reconciliation, FX, payment runs
 *
 * API routes: /api/payment-instructions/**, /api/payment-executions/**,
 *             /api/erp/**, /api/entities/[id]/netsuite-match,
 *             /api/entities/reconciliation
 *
 * Dashboard: /dashboard/payments/**, /dashboard/entities/reconciliation
 *
 * Key lib files (pending migration from src/lib/):
 *   - src/lib/payments/       → migrate to src/modules/payments-erp/lib/payments/
 *   - src/lib/erp/            → migrate to src/modules/payments-erp/lib/erp/
 *   - src/lib/fx/             → migrate to src/modules/payments-erp/lib/fx/
 */

// Domain lib re-exports — add here as logic is migrated into this module
export {}
