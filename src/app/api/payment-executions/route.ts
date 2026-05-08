// src/app/api/payment-executions/route.ts — GET list + POST batch process trigger

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { processDueScheduledPayments } from '@/lib/payments/execution-runner'

const READ_ROLES    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const PROCESS_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO'])

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

// ---------------------------------------------------------------------------
// GET — list executions
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const sp     = req.nextUrl.searchParams
    const status = sp.get('status') ?? undefined
    const page   = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

    const where = {
      orgId:  session.orgId,
      ...(status ? { status: status as never } : {}),
    }

    const [total, executions] = await Promise.all([
      prisma.paymentExecution.count({ where }),
      prisma.paymentExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          invoice: {
            select: {
              invoiceNo: true,
              entity:    { select: { name: true } },
            },
          },
        },
      }),
    ])

    // Hydrate payment instruction references
    const invoiceIds = executions.map(e => e.invoiceId)
    const piMap = invoiceIds.length > 0
      ? await prisma.paymentInstruction.findMany({
          where:  { invoiceId: { in: invoiceIds } },
          select: { id: true, invoiceId: true, erpReference: true },
        }).then(rows => Object.fromEntries(rows.map(r => [r.invoiceId, r])))
      : {}

    const data = executions.map(e => ({
      id:            e.id,
      invoiceId:     e.invoiceId,
      invoiceNo:     e.invoice?.invoiceNo ?? '—',
      vendorName:    e.invoice?.entity?.name ?? '—',
      amount:        e.amount,
      currency:      e.currency,
      rail:          e.rail,
      status:        e.status,
      scheduledAt:   e.scheduledAt,
      executedAt:    e.executedAt,
      reference:     e.reference,
      reconciled:    e.reconciled,
      reconciledAt:  e.reconciledAt,
      glPosted:      e.glPosted,
      failureReason: e.failureReason,
      retryCount:    e.retryCount,
      createdAt:     e.createdAt,
      piId:          piMap[e.invoiceId]?.id ?? null,
    }))

    return NextResponse.json({
      executions: data,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/payment-executions')
  }
}

// ---------------------------------------------------------------------------
// POST — trigger batch processing of due SCHEDULED executions (cron/admin)
// ---------------------------------------------------------------------------

export async function POST(_req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!PROCESS_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const result = await processDueScheduledPayments()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-executions')
  }
}
