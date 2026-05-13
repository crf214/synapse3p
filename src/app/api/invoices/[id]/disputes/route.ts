// src/app/api/invoices/[id]/disputes/route.ts
// GET — list vendor disputes logged against an invoice (internal team view)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const disputes = await prisma.entityActivityLog.findMany({
      where: {
        orgId:         session.orgId,
        referenceId:   id,
        referenceType: 'Invoice',
        activityType:  'NOTE',
        metadata:      { path: ['type'], equals: 'VENDOR_DISPUTE' },
      },
      orderBy: { occurredAt: 'desc' },
    })

    return NextResponse.json({
      disputes: disputes.map(d => ({
        id:          d.id,
        title:       d.title,
        description: d.description,
        occurredAt:  d.occurredAt.toISOString(),
        disputeType: (d.metadata as Record<string, unknown>)?.disputeType as string ?? 'OTHER',
        status:      (d.metadata as Record<string, unknown>)?.status as string ?? 'OPEN',
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/[id]/disputes')
  }
}
