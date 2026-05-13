// Shared role sets for API route authorization checks.
// Import from here instead of defining inline new Set([...]) in each route.

/** All internal finance roles including read-only auditors. */
export const FINANCE_ROLES = new Set([
  'ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR',
])

/** Roles that can perform write operations on financial records. */
export const WRITE_ROLES = new Set([
  'ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO',
])

/** Roles that can approve financial transactions (no AP_CLERK). */
export const APPROVAL_ROLES = new Set([
  'ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO',
])

/** Roles with access to audit and control data. */
export const AUDIT_ROLES = new Set([
  'ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR',
])

/** Portal-only roles. */
export const PORTAL_ROLES = new Set(['VENDOR', 'CLIENT'])
