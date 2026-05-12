/**
 * compute-snapshots.ts — DEPRECATED in Phase 4E
 *
 * The ReportSnapshot table was removed. All report queries now run live.
 * This script is retained as a no-op to avoid breaking any scheduled jobs
 * that reference it. It can be deleted once those jobs are updated.
 */

console.log('[compute-snapshots] ReportSnapshot table removed in Phase 4E — nothing to compute. This script is a no-op.')
process.exit(0)
