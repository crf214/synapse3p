/**
 * Entity Management module
 *
 * Owns: entities, vendors, onboarding, reviews, contracts, documents, BCDR,
 *       risk scoring, external signals, due diligence
 *
 * API routes: /api/entities/**, /api/onboarding-workflows/**, /api/reviews/**,
 *             /api/contracts/**, /api/review-cadences/**, /api/bcdr/**,
 *             /api/external-signals/**, /api/documents/**
 *
 * Dashboard: /dashboard/entities/**, /dashboard/vendors, /dashboard/reviews/**,
 *            /dashboard/contracts/**, /dashboard/documents, /dashboard/bcdr,
 *            /dashboard/settings/onboarding-workflows/**,
 *            /dashboard/settings/external-signals
 */

// Domain lib re-exports — add here as logic is migrated into this module
export * from './lib/workflow-steps'
