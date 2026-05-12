// ReportSnapshot table removed in Phase 4E — all report queries now run live.
// These wrappers preserve the existing API surface so callers don't change.

import {
  getApAgingData,
  getSpendByVendor,
  getRiskDashboardData,
  getPaymentQueueData,
  getWorkloadData,
} from './queries'

export const REPORT_TYPES = [
  'AP_AGING',
  'SPEND_BY_VENDOR',
  'RISK_DASHBOARD',
  'PAYMENT_QUEUE',
  'WORKLOAD',
] as const

export type ReportType = typeof REPORT_TYPES[number]

interface SnapshotResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data:        any
  isLive:      boolean
  snapshotAge?: number
}

async function runQuery(orgId: string, reportType: string): Promise<unknown> {
  const now   = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  switch (reportType) {
    case 'AP_AGING':        return getApAgingData(orgId)
    case 'SPEND_BY_VENDOR': return getSpendByVendor(orgId, start, end)
    case 'RISK_DASHBOARD':  return getRiskDashboardData(orgId)
    case 'PAYMENT_QUEUE':   return getPaymentQueueData(orgId)
    case 'WORKLOAD':        return getWorkloadData(orgId)
    default:
      throw new Error(`Unknown reportType: ${reportType}`)
  }
}

// Always runs a live query. The maxAgeMinutes parameter is retained for API
// compatibility but no longer has effect — the snapshot cache was removed.
export async function getOrComputeSnapshot(
  orgId:          string,
  reportType:     string,
  _maxAgeMinutes = 60,
): Promise<SnapshotResult> {
  const data = await runQuery(orgId, reportType)
  return { data, isLive: true }
}
