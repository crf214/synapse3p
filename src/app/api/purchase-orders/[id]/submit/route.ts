// src/app/api/purchase-orders/[id]/submit/route.ts
// POST — submit a DRAFT PO for approval.
//
// Changes PO status to PENDING_APPROVAL.
// Approval routing is handled by the workflow engine (started on PO creation).
// Legacy hardcoded POApproval record creation has been removed in Phase 3D.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const SUBMIT_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !SUBMIT_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: session.orgId },
      include: {
        lineItems: true,
        entity:    { select: { id: true, name: true } },
      },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (po.status !== 'DRAFT') throw new ValidationError('Only DRAFT purchase orders can be submitted for approval')
    if (po.lineItems.length === 0) throw new ValidationError('Cannot submit a PO with no line items')

    // Advance PO status to PENDING_APPROVAL
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data:  { status: 'PENDING_APPROVAL' as never },
      })
      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'SUBMIT',
        objectType: 'PURCHASE_ORDER',
        objectId:   id,
      })
    }, { timeout: 15000 })

    // Activity log — non-critical
    await prisma.entityActivityLog.create({
      data: {
        entityId:     po.entityId,
        orgId:        session.orgId!,
        activityType: 'STATUS_CHANGE' as never,
        title:        `PO submitted for approval: ${po.poNumber}`,
        description:  `${po.title} — ${po.totalAmount} ${po.currency}`,
        referenceId:   id,
        referenceType: 'PurchaseOrder',
        performedBy:   session.userId,
      },
    }).catch(e => console.error('[po-submit] audit log failed:', e))

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        lineItems: { orderBy: { lineNo: 'asc' } },
        approvals: { orderBy: { step: 'asc' } },
      },
    })

    return NextResponse.json({ purchaseOrder: updated })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/submit')
  }
}
