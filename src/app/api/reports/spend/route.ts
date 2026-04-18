import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getOrComputeSnapshot, computeAndStoreSnapshot } from '@/lib/reporting/snapshots'
import { getSpendByVendor, type SpendByVendorRow } from '@/lib/reporting/queries'
import { convertToUsd } from '@/lib/fx/FxService'
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/errors'

function defaultPeriodStart(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function defaultPeriodEnd(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

function parseDate(value: string | null, label: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) throw new ValidationError(`Invalid ${label}: "${value}"`)
  return d
}

interface SpendRowWithUsd extends SpendByVendorRow {
  usdEquivalent: number | null
  fxRate:        number | null
  fxRateDate:    Date   | null
}

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const { orgId } = session
    const { searchParams } = new URL(request.url)

    const rawStart = searchParams.get('periodStart')
    const rawEnd   = searchParams.get('periodEnd')

    const customRange = rawStart !== null || rawEnd !== null
    const periodStart = parseDate(rawStart, 'periodStart') ?? defaultPeriodStart()
    const periodEnd   = parseDate(rawEnd,   'periodEnd')   ?? defaultPeriodEnd()

    if (periodStart >= periodEnd) {
      throw new ValidationError('periodStart must be before periodEnd')
    }

    let rows: SpendByVendorRow[]
    let isLive: boolean
    let snapshotAge: number | undefined

    if (customRange) {
      // Custom date range always runs a live query — snapshot covers current month only
      rows   = await getSpendByVendor(orgId, periodStart, periodEnd)
      isLive = true
    } else {
      const snapshot = await getOrComputeSnapshot(orgId, 'SPEND_BY_VENDOR', 30)
      rows        = snapshot.data as SpendByVendorRow[]
      isLive      = snapshot.isLive
      snapshotAge = snapshot.snapshotAge
    }

    // Attach USD equivalents — run conversions in parallel
    const refDate = periodEnd
    const spendWithUsd: SpendRowWithUsd[] = await Promise.all(
      rows.map(async row => {
        const fx = await convertToUsd(row.totalAmount, row.currency, refDate)
        return {
          ...row,
          usdEquivalent: fx.usdAmount,
          fxRate:        fx.rate,
          fxRateDate:    fx.rateDate,
        }
      })
    )

    const currencies = [...new Set(rows.map(r => r.currency))].sort()

    return NextResponse.json({
      spend:       spendWithUsd,
      periodStart: periodStart.toISOString(),
      periodEnd:   periodEnd.toISOString(),
      isLive,
      snapshotAge,
      currencies,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/reports/spend')
  }
}
