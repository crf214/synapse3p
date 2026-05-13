// src/app/api/purchase-orders/[id]/approve/route.ts
// POST — record an approver decision on a PO.
//
// decision: APPROVED | REJECTED | CHANGES_REQUESTED
// CHANGES_REQUESTED resets PO to DRAFT so the requester can edit and re-submit.
//
// Phase 3D: wired to workflow engine — finds the active APPROVAL step instance
// and calls engine.completeStep() to advance the workflow.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sendPODecisionEmail } from '@/lib/resend'
import { writeAuditEvent } from '@/lib/audit'
import { WorkflowEngine } from '@/lib/workflow-engine'

const ApprovePurchaseOrderSchema = z.object({
  decision: z.string().min(1),
  comments: z.string().optional(),
})

const APPROVER_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !APPROVER_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const rawBody = await req.json()
    const parsed = ApprovePurchaseOrderSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    if (!['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'].includes(body.decision)) {
      throw new ValidationError('decision must be APPROVED, REJECTED, or CHANGES_REQUESTED')
    }
    if ((body.decision === 'REJECTED' || body.decision === 'CHANGES_REQUESTED') && !body.comments?.trim()) {
      throw new ValidationError('comments are required when rejecting or requesting changes')
    }

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: orgId },
      include: { entity: { select: { id: true, name: true } } },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (po.status !== 'PENDING_APPROVAL') {
      throw new ValidationError('This PO is not currently pending approval')
    }

    const comments     = body.comments?.trim() || null
    const isApproved   = body.decision === 'APPROVED'
    const isChangesReq = body.decision === 'CHANGES_REQUESTED'
    const actionLabel  = isApproved ? 'approved' : isChangesReq ? 'returned for changes' : 'rejected'

    // Determine new PO status
    const newPoStatus = isApproved ? 'APPROVED' : isChangesReq ? 'DRAFT' : 'REJECTED'

    // Atomic: update PO status + audit event
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data:  { status: newPoStatus as never },
      })
      // Cancel any legacy POApproval records still in PENDING
      await tx.pOApproval.updateMany({
        where: { poId: id, status: 'PENDING' as never },
        data:  { status: 'CANCELLED' as never },
      })
      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'APPROVE',
        objectType: 'PURCHASE_ORDER',
        objectId:   id,
      })
    }, { timeout: 15000 })

    // Advance workflow engine — find active APPROVAL step instance
    void (async () => {
      try {
        const workflowInstance = await prisma.workflowInstance.findFirst({
          where: {
            targetObjectType: 'PURCHASE_ORDER',
            targetObjectId:   id,
            orgId:            orgId,
            status:           { notIn: ['CANCELLED', 'COMPLETED', 'FAILED'] },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            stepInstances: {
              include: { stepDefinition: { select: { stepType: true } } },
              where:   { status: 'IN_PROGRESS' },
            },
          },
        })

        if (workflowInstance) {
          const approvalStep = workflowInstance.stepInstances.find(
            si => si.stepDefinition.stepType === 'APPROVAL',
          )
          if (approvalStep) {
            const engine = new WorkflowEngine(prisma)
            await engine.completeStep(
              approvalStep.id,
              isApproved ? 'PASS' : 'FAIL',
              session.userId!,
              comments ?? undefined,
            )
          }
        }
      } catch (err) {
        console.warn('[WorkflowEngine] Failed to advance PO approval workflow:', err)
      }
    })()

    // Activity log — non-critical
    await prisma.entityActivityLog.create({
      data: {
        entityId:     po.entityId,
        orgId:        orgId,
        activityType: 'STATUS_CHANGE' as never,
        title:        `PO ${actionLabel}: ${po.poNumber}`,
        description:  comments ?? undefined,
        referenceId:   id,
        referenceType: 'PurchaseOrder',
        performedBy:   session.userId,
      },
    }).catch(e => console.error('[po-approve] audit log failed:', e))

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

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        lineItems: { orderBy: { lineNo: 'asc' } },
        approvals: { orderBy: { step: 'asc' } },
      },
    })

    return NextResponse.json({ purchaseOrder: updated })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/approve')
  }
}
