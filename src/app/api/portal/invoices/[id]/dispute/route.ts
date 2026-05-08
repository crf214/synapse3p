// src/app/api/portal/invoices/[id]/dispute/route.ts
// POST — raise a vendor dispute against an invoice
// GET  — list disputes for an invoice (portal-scoped)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const PORTAL_ROLES = new Set(['VENDOR', 'CLIENT'])

const VALID_DISPUTE_TYPES = new Set([
  'INCORRECT_AMOUNT',
  'ALREADY_PAID',
  'NOT_ORDERED',
  'QUALITY_ISSUE',
  'WRONG_VENDOR',
  'OTHER',
])

// Invoices in terminal states cannot be disputed
const NON_DISPUTABLE = new Set(['PAID', 'CANCELLED', 'REJECTED'])

type Params = { params: { id: string } }

// ---------------------------------------------------------------------------
// GET — list disputes for this invoice
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, entityId: rel.entityId, orgId: rel.orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const disputes = await prisma.entityActivityLog.findMany({
      where: {
        orgId:         rel.orgId,
        entityId:      rel.entityId,
        referenceId:   params.id,
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
    return handleApiError(err, `GET /api/portal/invoices/${params.id}/dispute`)
  }
}

// ---------------------------------------------------------------------------
// POST — raise a new dispute
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, entityId: rel.entityId, orgId: rel.orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    if (NON_DISPUTABLE.has(invoice.status)) {
      throw new ValidationError(`Cannot raise a dispute on an invoice with status ${invoice.status}`)
    }

    const body = await req.json() as { disputeType?: string; reason?: string }

    const disputeType = body.disputeType?.toUpperCase() ?? 'OTHER'
    if (!VALID_DISPUTE_TYPES.has(disputeType)) {
      throw new ValidationError(`Invalid dispute type. Must be one of: ${[...VALID_DISPUTE_TYPES].join(', ')}`)
    }

    const reason = sanitiseString(body.reason ?? '', 2000).trim()
    if (!reason || reason.length < 10) {
      throw new ValidationError('Reason must be at least 10 characters')
    }

    const DISPUTE_LABELS: Record<string, string> = {
      INCORRECT_AMOUNT: 'Incorrect amount',
      ALREADY_PAID:     'Already paid',
      NOT_ORDERED:      'Goods/services not ordered',
      QUALITY_ISSUE:    'Quality issue',
      WRONG_VENDOR:     'Wrong vendor',
      OTHER:            'Other',
    }

    const dispute = await prisma.entityActivityLog.create({
      data: {
        entityId:      rel.entityId,
        orgId:         rel.orgId,
        activityType:  'NOTE',
        title:         `Vendor dispute — ${DISPUTE_LABELS[disputeType] ?? disputeType}`,
        description:   reason,
        referenceId:   params.id,
        referenceType: 'Invoice',
        performedBy:   session.userId,
        metadata: {
          type:        'VENDOR_DISPUTE',
          disputeType,
          invoiceId:   params.id,
          status:      'OPEN',
          portalRole:  session.role,
        },
      },
    })

    return NextResponse.json({
      dispute: {
        id:          dispute.id,
        disputeType,
        description: reason,
        status:      'OPEN',
        occurredAt:  dispute.occurredAt.toISOString(),
      },
    }, { status: 201 })
  } catch (err) {
    return handleApiError(err, `POST /api/portal/invoices/${params.id}/dispute`)
  }
}
