// src/app/api/purchase-orders/[id]/approve/route.ts
// POST — record an approver decision on a PO.
//
// decision: APPROVED | REJECTED | CHANGES_REQUESTED
// CHANGES_REQUESTED maps to POApproval.status = REJECTED but resets PO to DRAFT
// so the requester can edit and re-submit.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sendPODecisionEmail, sendPOSubmittedEmail } from '@/lib/resend'

const APPROVER_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !APPROVER_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const body = await req.json() as {
      decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
      comments?: string
    }

    if (!['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'].includes(body.decision)) {
      throw new ValidationError('decision must be APPROVED, REJECTED, or CHANGES_REQUESTED')
    }
    if ((body.decision === 'REJECTED' || body.decision === 'CHANGES_REQUESTED') && !body.comments?.trim()) {
      throw new ValidationError('comments are required when rejecting or requesting changes')
    }

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: session.orgId },
      include: {
        entity:    { select: { id: true, name: true } },
        approvals: { orderBy: { step: 'asc' } },
        approvalWorkflow: { select: { steps: true } },
      },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (po.status !== 'PENDING_APPROVAL') {
      throw new ValidationError('This PO is not currently pending approval')
    }

    // Find the current pending approval step for this user
    const pendingApproval = po.approvals.find(
      a => a.approverId === session.userId && a.status === 'PENDING'
    )
    if (!pendingApproval) {
      throw new ForbiddenError('You are not an approver for this purchase order, or the PO is waiting on a prior step')
    }

    // Determine the next step (if any)
    const sortedApprovals  = [...po.approvals].sort((a, b) => a.step - b.step)
    const currentStepIndex = sortedApprovals.findIndex(a => a.id === pendingApproval.id)
    const nextApproval     = sortedApprovals[currentStepIndex + 1] ?? null

    const comments    = body.comments?.trim() || null
    const isApproved  = body.decision === 'APPROVED'
    const isChangesReq = body.decision === 'CHANGES_REQUESTED'

    await prisma.$transaction(async (tx) => {
      // Record decision on current approval step
      await tx.pOApproval.update({
        where: { id: pendingApproval.id },
        data:  {
          status:    (isApproved ? 'APPROVED' : 'REJECTED') as never,
          decidedAt: new Date(),
          comments,
        },
      })

      if (isApproved && nextApproval) {
        // More steps to go — next step is already PENDING (created at submit time)
        // No status change needed on the PO itself
      } else if (isApproved && !nextApproval) {
        // Final step approved
        await tx.purchaseOrder.update({
          where: { id },
          data:  { status: 'APPROVED' as never },
        })
      } else if (isChangesReq) {
        // Return to requester for editing
        await tx.purchaseOrder.update({
          where: { id },
          data:  { status: 'DRAFT' as never },
        })
        // Cancel remaining pending approvals
        await tx.pOApproval.updateMany({
          where: { poId: id, status: 'PENDING' as never },
          data:  { status: 'CANCELLED' as never },
        })
      } else {
        // Hard reject
        await tx.purchaseOrder.update({
          where: { id },
          data:  { status: 'REJECTED' as never },
        })
        await tx.pOApproval.updateMany({
          where: { poId: id, status: 'PENDING' as never },
          data:  { status: 'CANCELLED' as never },
        })
      }

      // Audit log
      const actionLabel = isApproved ? 'approved' : isChangesReq ? 'returned for changes' : 'rejected'
      await tx.entityActivityLog.create({
        data: {
          entityId:    po.entityId,
          orgId:       session.orgId!,
          activityType: 'STATUS_CHANGE' as never,
          title:       `PO ${actionLabel}: ${po.poNumber}`,
          description: comments ?? undefined,
          referenceId:   id,
          referenceType: 'PurchaseOrder',
          performedBy:   session.userId,
        },
      })
    })

    // Notifications (outside transaction)
    if (isApproved && nextApproval) {
      // Notify next approver
      const nextApprover = await prisma.user.findUnique({
        where:  { id: nextApproval.approverId },
        select: { id: true, name: true, email: true },
      })
      const pref = nextApprover
        ? await prisma.notificationPreference.findUnique({ where: { userId: nextApprover.id } })
        : null

      if (nextApprover && (!pref || pref.emailOnInvoiceRouted)) {
        const steps = (po.approvalWorkflow?.steps ?? []) as { step: number; label: string }[]
        const stepDef = steps.find(s => s.step === nextApproval.step)
        await sendPOSubmittedEmail({
          to:           nextApprover.email,
          assigneeName: nextApprover.name ?? nextApprover.email,
          poNumber:     po.poNumber,
          vendorName:   po.entity.name,
          totalAmount:  po.totalAmount,
          currency:     po.currency,
          poId:         id,
          stepLabel:    stepDef?.label ?? `Step ${nextApproval.step}`,
        }).catch(e => console.error('[po-approve] next approver email failed:', e))
      }
    } else {
      // Notify PO creator
      const creator = await prisma.user.findUnique({
        where:  { id: po.requestedBy },
        select: { id: true, name: true, email: true },
      })
      if (creator) {
        await sendPODecisionEmail({
          to:          creator.email,
          creatorName: creator.name ?? creator.email,
          poNumber:    po.poNumber,
          vendorName:  po.entity.name,
          totalAmount: po.totalAmount,
          currency:    po.currency,
          poId:        id,
          decision:    body.decision as 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
          comments:    comments ?? undefined,
        }).catch(e => console.error('[po-approve] creator email failed:', e))
      }
    }

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        lineItems:   { orderBy: { lineNo: 'asc' } },
        approvals:   { orderBy: { step: 'asc' } },
      },
    })

    return NextResponse.json({ purchaseOrder: updated })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/approve')
  }
}
