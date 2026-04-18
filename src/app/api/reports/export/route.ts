import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getOrComputeSnapshot } from '@/lib/reporting/snapshots'
import { getSpendByVendor } from '@/lib/reporting/queries'
import {
  handleApiError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from '@/lib/errors'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ALLOWED_REPORTS = new Set(['ap-aging', 'spend', 'risk', 'workload'])
const ALLOWED_FORMATS = new Set(['csv', 'json'])
const FINANCE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

// Reports that require elevated roles
const RESTRICTED_REPORTS = new Set(['risk', 'workload'])

// ---------------------------------------------------------------------------
// CSV serialiser — no external deps
// ---------------------------------------------------------------------------

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = value instanceof Date ? value.toISOString() : String(value)
  // Wrap in quotes if value contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCSV(rows: unknown[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return ''

  // For nested objects (e.g. RiskDashboard), flatten top-level keys only
  const first = rows[0]
  if (typeof first !== 'object' || first === null) return rows.join('\n')

  const keys = Object.keys(first as object)
  const header = keys.join(',')
  const body = rows
    .map(row =>
      keys.map(k => escapeCell((row as Record<string, unknown>)[k])).join(',')
    )
    .join('\n')

  return `${header}\n${body}`
}

// For single-object reports (RiskDashboard), pivot to key/value pairs
function pivotToRows(obj: Record<string, unknown>): Array<{ field: string; value: string }> {
  return Object.entries(obj).flatMap(([field, value]) => {
    if (Array.isArray(value)) {
      // Nested array — expand each element
      return value.map((item, i) => ({
        field: `${field}[${i}]`,
        value: typeof item === 'object' ? JSON.stringify(item) : String(item ?? ''),
      }))
    }
    return [{ field, value: String(value ?? '') }]
  })
}

// ---------------------------------------------------------------------------
// Data fetcher
// ---------------------------------------------------------------------------

async function fetchReportData(
  report:      string,
  orgId:       string,
  periodStart?: Date,
  periodEnd?:   Date,
): Promise<{ data: unknown; label: string }> {
  switch (report) {
    case 'ap-aging': {
      const s = await getOrComputeSnapshot(orgId, 'AP_AGING', 30)
      return { data: s.data, label: 'ap_aging' }
    }
    case 'spend': {
      const now   = new Date()
      const start = periodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const end   = periodEnd   ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      const rows  = await getSpendByVendor(orgId, start, end)
      return { data: rows, label: 'spend_by_vendor' }
    }
    case 'risk': {
      const s = await getOrComputeSnapshot(orgId, 'RISK_DASHBOARD', 60)
      return { data: s.data, label: 'risk_dashboard' }
    }
    case 'workload': {
      const s = await getOrComputeSnapshot(orgId, 'WORKLOAD', 30)
      return { data: s.data, label: 'workload' }
    }
    default:
      throw new ValidationError(`Unsupported report: ${report}`)
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const { searchParams } = new URL(request.url)
    const report = searchParams.get('report') ?? ''
    const format = (searchParams.get('format') ?? 'csv').toLowerCase()

    if (!ALLOWED_REPORTS.has(report)) {
      throw new ValidationError(
        `Invalid report. Supported: ${[...ALLOWED_REPORTS].join(', ')}`
      )
    }
    if (!ALLOWED_FORMATS.has(format)) {
      throw new ValidationError(
        `Invalid format. Supported: ${[...ALLOWED_FORMATS].join(', ')}`
      )
    }

    // Restricted reports require finance roles
    if (RESTRICTED_REPORTS.has(report)) {
      if (!session.role || !FINANCE_ROLES.has(session.role)) throw new ForbiddenError()
    }

    // Parse optional date range
    let periodStart: Date | undefined
    let periodEnd:   Date | undefined
    const rawStart = searchParams.get('periodStart')
    const rawEnd   = searchParams.get('periodEnd')
    if (rawStart) {
      periodStart = new Date(rawStart)
      if (isNaN(periodStart.getTime())) throw new ValidationError('Invalid periodStart')
    }
    if (rawEnd) {
      periodEnd = new Date(rawEnd)
      if (isNaN(periodEnd.getTime())) throw new ValidationError('Invalid periodEnd')
    }

    const { data, label } = await fetchReportData(
      report, session.orgId, periodStart, periodEnd
    )

    const timestamp = new Date().toISOString().slice(0, 10)
    const filename  = `synapse_${label}_${timestamp}`

    if (format === 'json') {
      const json = JSON.stringify(data, null, 2)
      return new NextResponse(json, {
        status: 200,
        headers: {
          'Content-Type':        'application/json',
          'Content-Disposition': `attachment; filename="${filename}.json"`,
        },
      })
    }

    // CSV
    let csv: string
    if (Array.isArray(data) && data.length > 0) {
      csv = toCSV(data as unknown[])
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Single-object report (RISK_DASHBOARD) — pivot to field/value rows
      csv = toCSV(pivotToRows(data as Record<string, unknown>))
    } else {
      csv = ''
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/reports/export')
  }
}
