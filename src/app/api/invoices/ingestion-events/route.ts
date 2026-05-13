// src/app/api/invoices/ingestion-events/route.ts
// GET — paginated list of invoice ingestion events with status/source filters

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AP_CLERK'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    const orgId = session.orgId
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = 50
    const status   = searchParams.get('status') ?? ''
    const source   = searchParams.get('source') ?? ''

    const where = {
      orgId: orgId,
      ...(status ? { processingStatus: status } : {}),
      ...(source ? { source: source as never } : {}),
    }

    const [total, events] = await Promise.all([
      prisma.invoiceIngestionEvent.count({ where }),
      prisma.invoiceIngestionEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          invoice: { select: { id: true, invoiceNo: true, status: true, amount: true, currency: true } },
        },
      }),
    ])

    return NextResponse.json({
      events: events.map(e => ({
        id:               e.id,
        source:           e.source,
        processingStatus: e.processingStatus,
        fromEmail:        e.fromEmail,
        fromName:         e.fromName,
        subject:          e.subject,
        attachmentRefs:   e.attachmentRefs,
        errorDetails:     e.errorDetails,
        receivedAt:       e.receivedAt.toISOString(),
        invoice:          e.invoice,
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/ingestion-events')
  }
}
