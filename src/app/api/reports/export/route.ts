import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import {
  getSpendExportRows,
  getRiskExportRows,
  getApAgingDetailRows,
} from '@/lib/reporting/queries'
import {
  handleApiError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from '@/lib/errors'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FINANCE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function toCSV(headers: string[], rows: unknown[][]): string {
  const header = headers.join(',')
  const body   = rows.map(r => r.map(cell).join(',')).join('\n')
  return `${header}\n${body}`
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !FINANCE_ROLES.has(session.role)) throw new ForbiddenError()

    const { searchParams } = new URL(request.url)

    // Accept both `type` and legacy `report` param
    const type     = (searchParams.get('type') ?? searchParams.get('report') ?? '').toLowerCase()
    const entityId = searchParams.get('entityId') ?? undefined

    const rawStart = searchParams.get('startDate') ?? searchParams.get('periodStart')
    const rawEnd   = searchParams.get('endDate')   ?? searchParams.get('periodEnd')

    let startDate: Date | undefined
    let endDate:   Date | undefined
    if (rawStart) {
      startDate = new Date(rawStart)
      if (isNaN(startDate.getTime())) throw new ValidationError('Invalid startDate')
    }
    if (rawEnd) {
      endDate = new Date(rawEnd)
      if (isNaN(endDate.getTime())) throw new ValidationError('Invalid endDate')
    }

    const orgId    = session.orgId
    const today    = new Date().toISOString().slice(0, 10)

    let csv:      string
    let filename: string

    switch (type) {
      case 'spend': {
        const rows = await getSpendExportRows(orgId, startDate, endDate, entityId)
        filename = `synapse3p-spend-report-${today}`
        csv = toCSV(
          ['Entity Name', 'Entity Type', 'Risk Band', 'Month', 'Invoice Count', 'Total Amount', 'Currency'],
          rows.map(r => [r.entityName, r.entityType, r.riskBand, r.month, r.invoiceCount, r.totalAmount, r.currency]),
        )
        break
      }

      case 'risk': {
        const rows = await getRiskExportRows(orgId, entityId)
        filename = `synapse3p-risk-report-${today}`
        csv = toCSV(
          ['Entity Name', 'Entity Type', 'Risk Band', 'Risk Score', 'Last Review Date', 'KYC Status', 'Days Since Last Review'],
          rows.map(r => [r.entityName, r.entityType, r.riskBand, r.riskScore, r.lastReviewDate, r.kycStatus, r.daysSinceLastReview ?? '']),
        )
        break
      }

      case 'ap-aging': {
        const rows = await getApAgingDetailRows(orgId, entityId)
        filename = `synapse3p-ap-aging-report-${today}`
        csv = toCSV(
          ['Entity Name', 'Invoice Number', 'Invoice Date', 'Amount', 'Currency', 'Days Outstanding', 'Age Bucket'],
          rows.map(r => [
            r.entityName,
            r.invoiceNo,
            r.invoiceDate instanceof Date ? r.invoiceDate.toISOString().slice(0, 10) : r.invoiceDate,
            r.amount,
            r.currency,
            r.daysOutstanding,
            r.ageBucket,
          ]),
        )
        break
      }

      default:
        throw new ValidationError('Invalid type. Supported: spend, risk, ap-aging')
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
