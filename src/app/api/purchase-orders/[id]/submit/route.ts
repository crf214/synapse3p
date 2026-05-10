// src/app/api/purchase-orders/[id]/submit/route.ts
// POST — submit a DRAFT PO for approval.
//
// Flow:
//   1. Validate PO is DRAFT and has line items
//   2. Find first active CONTROLLER or CFO in the org to assign approval
//   3. Create POApproval record
//   4. Set PO status = PENDING_APPROVAL
//   5. Notify approver via Resend (respects NotificationPreference)
//   6. Log EntityActivityLog
//
// Note: legacy ApprovalWorkflow lookup removed in Phase 3A.
//       Workflow routing is now handled by the unified workflow engine.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sendPOSubmittedEmail } from '@/lib/resend'
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

    // Find first CONTROLLER or CFO in org as approver
    const fallbackMember = await prisma.orgMember.findFirst({
      where:   { orgId: session.orgId, role: { in: ['CONTROLLER', 'CFO'] as never[] }, status: 'active' },
      include: { user: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    })

    if (!fallbackMember) {
      throw new ValidationError(
        'No approval workflow found for this PO and no CONTROLLER or CFO exists in the organisation. ' +
        'Please ensure at least one user holds the CONTROLLER or CFO role.',
      )
    }

    const approvalData = {
      poId:       id,
      workflowId: null as string | null,
      step:       1,
      approverId: fallbackMember.userId,
      status:     'PENDING',
    }

    // Atomic: create approval record + advance PO status
    await prisma.$transaction(async (tx) => {
      await tx.pOApproval.create({ data: approvalData as never })
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

    // Notify approver (outside transaction)
    const approver = await prisma.user.findUnique({
      where:  { id: fallbackMember.userId },
      select: { id: true, name: true, email: true },
    })
    const pref = approver
      ? await prisma.notificationPreference.findUnique({ where: { userId: approver.id } })
      : null

    if (approver && (!pref || pref.emailOnInvoiceRouted)) {
      await sendPOSubmittedEmail({
        to:           approver.email,
        assigneeName: approver.name ?? approver.email,
        poNumber:     po.poNumber,
        vendorName:   po.entity.name,
        totalAmount:  po.totalAmount,
        currency:     po.currency,
        poId:         id,
        stepLabel:    'Approval',
      }).catch(e => console.error('[po-submit] email failed:', e))
    }

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
