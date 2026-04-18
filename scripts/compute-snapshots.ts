/**
 * Nightly report snapshot computation batch.
 * Runs computeAndStoreSnapshot for all pre-computable report types across all active orgs.
 * PAYMENT_QUEUE is excluded — it is always served live.
 *
 * Usage:
 *   npx tsx scripts/compute-snapshots.ts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import { computeAndStoreSnapshot } from '@/lib/reporting/snapshots'

// Load .env.local in development (before Prisma opens a connection)
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

// PAYMENT_QUEUE is always live — skip pre-computation
const REPORT_TYPES = ['AP_AGING', 'SPEND_BY_VENDOR', 'RISK_DASHBOARD', 'WORKLOAD'] as const

const prisma = new PrismaClient()

async function main() {
  const orgs = await prisma.organisation.findMany({ select: { id: true, name: true } })

  let totalSnapshots = 0
  let totalErrors    = 0

  for (const org of orgs) {
    for (const reportType of REPORT_TYPES) {
      try {
        const snapshot = await computeAndStoreSnapshot(org.id, reportType)
        console.log(`  ✓  ${org.name} / ${reportType} — snapshot ${snapshot.id}`)
        totalSnapshots++
      } catch (err) {
        console.error(
          `  ✗  ${org.name} / ${reportType}: ${err instanceof Error ? err.message : String(err)}`
        )
        totalErrors++
      }
    }
  }

  console.log(
    `\nComputed ${totalSnapshots} snapshots for ${orgs.length} org${orgs.length === 1 ? '' : 's'}` +
    (totalErrors > 0 ? ` (${totalErrors} errors)` : '')
  )
}

main()
  .catch(e => console.error('Unexpected error in compute-snapshots:', e))
  .finally(() => prisma.$disconnect())
