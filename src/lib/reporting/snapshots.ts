import type { ReportSnapshot } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  getApAgingData,
  getSpendByVendor,
  getRiskDashboardData,
  getPaymentQueueData,
  getWorkloadData,
} from './queries'

// ---------------------------------------------------------------------------
// Report type registry
// ---------------------------------------------------------------------------

export const REPORT_TYPES = [
  'AP_AGING',
  'SPEND_BY_VENDOR',
  'RISK_DASHBOARD',
  'PAYMENT_QUEUE',
  'WORKLOAD',
] as const

export type ReportType = typeof REPORT_TYPES[number]

function currentPeriod(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

async function runQuery(orgId: string, reportType: string): Promise<unknown> {
  const now   = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  switch (reportType) {
    case 'AP_AGING':       return getApAgingData(orgId)
    case 'SPEND_BY_VENDOR':return getSpendByVendor(orgId, start, end)
    case 'RISK_DASHBOARD': return getRiskDashboardData(orgId)
    case 'PAYMENT_QUEUE':  return getPaymentQueueData(orgId)
    case 'WORKLOAD':       return getWorkloadData(orgId)
    default:
      throw new Error(`Unknown reportType: ${reportType}`)
  }
}

// ---------------------------------------------------------------------------
// computeAndStoreSnapshot
// ---------------------------------------------------------------------------

export async function computeAndStoreSnapshot(
  orgId:      string,
  reportType: string,
): Promise<ReportSnapshot> {
  const startMs = Date.now()
  const data    = await runQuery(orgId, reportType)
  const durationMs = Date.now() - startMs

  const recordCount = Array.isArray(data) ? data.length : 1

  return prisma.reportSnapshot.create({
    data: {
      orgId,
      reportType,
      period:   currentPeriod(),
      data:     data as object,
      metadata: { durationMs, recordCount, computedAt: new Date().toISOString() },
    },
  })
}

// ---------------------------------------------------------------------------
// getLatestSnapshot
// ---------------------------------------------------------------------------

export async function getLatestSnapshot(
  orgId:      string,
  reportType: string,
): Promise<ReportSnapshot | null> {
  return prisma.reportSnapshot.findFirst({
    where:   { orgId, reportType },
    orderBy: { snapshotDate: 'desc' },
  })
}

// ---------------------------------------------------------------------------
// getOrComputeSnapshot
// ---------------------------------------------------------------------------

interface SnapshotResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data:        any
  isLive:      boolean
  snapshotAge?: number   // minutes since snapshot was taken
}

export async function getOrComputeSnapshot(
  orgId:          string,
  reportType:     string,
  maxAgeMinutes = 60,
): Promise<SnapshotResult> {
  // PAYMENT_QUEUE is always live — never serve a stale queue view
  if (maxAgeMinutes === 0 || reportType === 'PAYMENT_QUEUE') {
    const data = await runQuery(orgId, reportType)
    return { data, isLive: true }
  }

  const snapshot = await getLatestSnapshot(orgId, reportType)

  if (snapshot) {
    const ageMs      = Date.now() - snapshot.snapshotDate.getTime()
    const ageMinutes = ageMs / 60_000

    if (ageMinutes <= maxAgeMinutes) {
      return { data: snapshot.data, isLive: false, snapshotAge: Math.round(ageMinutes) }
    }
  }

  // Snapshot missing or stale — compute fresh
  const fresh = await computeAndStoreSnapshot(orgId, reportType)
  return { data: fresh.data, isLive: true }
}
