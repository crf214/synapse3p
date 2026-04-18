/**
 * Synapse3P — Control Catalogue Seed
 *
 * Upserts all 20 controls for the acme org. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/seed-controls.ts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import type { ControlDomain, ControlFrequency } from '@prisma/client'

// ---------------------------------------------------------------------------
// Load .env.local in development
// ---------------------------------------------------------------------------
const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
interface ControlDef {
  controlId:        string
  domain:           ControlDomain
  title:            string
  objective:        string
  frequency:        ControlFrequency
  ownerRole:        string
  automatedTestKey: string
  sox:              boolean
  soc2Criteria:     string[]
}

const CONTROLS: ControlDef[] = [
  // Access Controls
  {
    controlId:        'AC-01',
    domain:           'ACCESS_CONTROL',
    title:            'User access review',
    objective:        'All active users have appropriate roles assigned and no excessive privileges exist',
    frequency:        'MONTHLY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'AC-01',
    sox:              true,
    soc2Criteria:     ['CC6.1'],
  },
  {
    controlId:        'AC-02',
    domain:           'ACCESS_CONTROL',
    title:            'Privileged access monitoring',
    objective:        'ADMIN role usage is logged and reviewed — no undocumented privilege escalation',
    frequency:        'WEEKLY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'AC-02',
    sox:              true,
    soc2Criteria:     ['CC6.2'],
  },
  {
    controlId:        'AC-03',
    domain:           'ACCESS_CONTROL',
    title:            'Access termination',
    objective:        'Offboarded users lose system access within 24 hours of status change',
    frequency:        'PER_EVENT',
    ownerRole:        'ADMIN',
    automatedTestKey: 'AC-03',
    sox:              true,
    soc2Criteria:     ['CC6.1'],
  },
  {
    controlId:        'AC-04',
    domain:           'ACCESS_CONTROL',
    title:            'Payment four-eyes enforcement',
    objective:        'No payment instruction is approved by its own creator — segregation of duties enforced',
    frequency:        'CONTINUOUS',
    ownerRole:        'CONTROLLER',
    automatedTestKey: 'AC-04',
    sox:              true,
    soc2Criteria:     ['CC9.1'],
  },

  // Change Management
  {
    controlId:        'CM-01',
    domain:           'CHANGE_MANAGEMENT',
    title:            'Code change control',
    objective:        'All code changes are reviewed via pull request with CI passing before merge to main',
    frequency:        'CONTINUOUS',
    ownerRole:        'ADMIN',
    automatedTestKey: 'CM-01',
    sox:              true,
    soc2Criteria:     ['CC8.1'],
  },
  {
    controlId:        'CM-02',
    domain:           'CHANGE_MANAGEMENT',
    title:            'Database migration control',
    objective:        'All schema changes are tracked as versioned migration files committed to source control',
    frequency:        'PER_EVENT',
    ownerRole:        'ADMIN',
    automatedTestKey: 'CM-02',
    sox:              true,
    soc2Criteria:     ['CC8.1'],
  },
  {
    controlId:        'CM-03',
    domain:           'CHANGE_MANAGEMENT',
    title:            'No unauthorised database changes',
    objective:        'No direct database modifications occur outside the migration process',
    frequency:        'MONTHLY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'CM-03',
    sox:              true,
    soc2Criteria:     ['CC8.1'],
  },

  // Financial Integrity
  {
    controlId:        'FI-01',
    domain:           'FINANCIAL_INTEGRITY',
    title:            'Payment amendment four-eyes',
    objective:        'All amendments to payment instruction amount, vendor, or bank account require a second approver',
    frequency:        'CONTINUOUS',
    ownerRole:        'CONTROLLER',
    automatedTestKey: 'FI-01',
    sox:              true,
    soc2Criteria:     ['CC9.1'],
  },
  {
    controlId:        'FI-02',
    domain:           'FINANCIAL_INTEGRITY',
    title:            'Financial audit trail completeness',
    objective:        'All financial mutations are recorded in the immutable audit log with before and after values',
    frequency:        'DAILY',
    ownerRole:        'CONTROLLER',
    automatedTestKey: 'FI-02',
    sox:              true,
    soc2Criteria:     ['CC7.2'],
  },
  {
    controlId:        'FI-03',
    domain:           'FINANCIAL_INTEGRITY',
    title:            'ERP transaction integrity',
    objective:        'Changes to ERP transactions are detected, versioned, and logged — NetSuite is always master',
    frequency:        'DAILY',
    ownerRole:        'CONTROLLER',
    automatedTestKey: 'FI-03',
    sox:              true,
    soc2Criteria:     ['CC7.2'],
  },
  {
    controlId:        'FI-04',
    domain:           'FINANCIAL_INTEGRITY',
    title:            'Multi-currency integrity',
    objective:        'No financial aggregations cross currency boundaries — all sums are per-currency only',
    frequency:        'CONTINUOUS',
    ownerRole:        'FINANCE_MANAGER',
    automatedTestKey: 'FI-04',
    sox:              true,
    soc2Criteria:     ['CC7.1'],
  },

  // Vendor Risk
  {
    controlId:        'VR-01',
    domain:           'VENDOR_RISK',
    title:            'Vendor onboarding completeness',
    objective:        'All active vendors have completed the required onboarding workflow before payment is enabled',
    frequency:        'MONTHLY',
    ownerRole:        'FINANCE_MANAGER',
    automatedTestKey: 'VR-01',
    sox:              false,
    soc2Criteria:     ['CC9.2'],
  },
  {
    controlId:        'VR-02',
    domain:           'VENDOR_RISK',
    title:            'High-risk vendor review cadence',
    objective:        'Vendors with risk score >= 7 are reviewed within the required interval',
    frequency:        'MONTHLY',
    ownerRole:        'FINANCE_MANAGER',
    automatedTestKey: 'VR-02',
    sox:              false,
    soc2Criteria:     ['CC9.2'],
  },
  {
    controlId:        'VR-03',
    domain:           'VENDOR_RISK',
    title:            'Third-party review documentation',
    objective:        'All completed third-party reviews have scores recorded across cyber, legal, and privacy domains',
    frequency:        'QUARTERLY',
    ownerRole:        'FINANCE_MANAGER',
    automatedTestKey: 'VR-03',
    sox:              false,
    soc2Criteria:     ['CC9.2'],
  },

  // BC/DR
  {
    controlId:        'BC-01',
    domain:           'BC_DR',
    title:            'Backup verification',
    objective:        'Daily database backups are verified as restorable within RPO of 24 hours',
    frequency:        'DAILY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'BC-01',
    sox:              true,
    soc2Criteria:     ['A1.2'],
  },
  {
    controlId:        'BC-02',
    domain:           'BC_DR',
    title:            'RTO/RPO documentation',
    objective:        'Recovery time and recovery point objectives are documented, tested, and achievable within 8 hours RTO and 24 hours RPO',
    frequency:        'QUARTERLY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'BC-02',
    sox:              false,
    soc2Criteria:     ['A1.3'],
  },
  {
    controlId:        'BC-03',
    domain:           'BC_DR',
    title:            'System availability monitoring',
    objective:        'System availability is monitored continuously and any outage is detected within 15 minutes',
    frequency:        'CONTINUOUS',
    ownerRole:        'ADMIN',
    automatedTestKey: 'BC-03',
    sox:              false,
    soc2Criteria:     ['A1.1'],
  },

  // Monitoring
  {
    controlId:        'MO-01',
    domain:           'MONITORING',
    title:            'Nightly health check',
    objective:        'All infrastructure health checks pass nightly — failures trigger immediate alerts',
    frequency:        'DAILY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'MO-01',
    sox:              false,
    soc2Criteria:     ['CC7.1'],
  },
  {
    controlId:        'MO-02',
    domain:           'MONITORING',
    title:            'Security controls verification',
    objective:        'All security controls are verified daily including outbound allowlist, secrets, and dependency audit',
    frequency:        'DAILY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'MO-02',
    sox:              false,
    soc2Criteria:     ['CC7.1'],
  },
  {
    controlId:        'MO-03',
    domain:           'MONITORING',
    title:            'Third-party external signal monitoring',
    objective:        'External signals (news, stock price) are monitored daily for all active third parties',
    frequency:        'DAILY',
    ownerRole:        'ADMIN',
    automatedTestKey: 'MO-03',
    sox:              false,
    soc2Criteria:     ['CC9.2'],
  },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const org = await prisma.organisation.findUnique({ where: { slug: 'acme' } })
  if (!org) {
    throw new Error('acme org not found — run: npx prisma db seed')
  }

  let count = 0
  for (const def of CONTROLS) {
    await prisma.control.upsert({
      where:  { controlId: def.controlId },
      update: {
        orgId:            org.id,
        domain:           def.domain,
        title:            def.title,
        objective:        def.objective,
        frequency:        def.frequency,
        ownerRole:        def.ownerRole,
        automatedTestKey: def.automatedTestKey,
        sox:              def.sox,
        soc2Criteria:     def.soc2Criteria,
        status:           'ACTIVE',
      },
      create: {
        controlId:        def.controlId,
        orgId:            org.id,
        domain:           def.domain,
        title:            def.title,
        objective:        def.objective,
        frequency:        def.frequency,
        ownerRole:        def.ownerRole,
        automatedTestKey: def.automatedTestKey,
        sox:              def.sox,
        soc2Criteria:     def.soc2Criteria,
        status:           'ACTIVE',
      },
    })
    count++
  }

  console.log(`Seeded ${count} controls for org: ${org.name}`)
}

main()
  .catch(e => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
