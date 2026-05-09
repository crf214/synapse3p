// src/app/api/purchase-orders/[id]/submit/route.ts
// POST — submit a DRAFT PO for approval.
//
// Flow:
//   1. Validate PO is DRAFT and has line items
//   2. Find best-matching active ApprovalWorkflow
//   3. Parse steps JSON → create POApproval records
//   4. Set PO status = PENDING_APPROVAL
//   5. Notify first-step approver via Resend (respects NotificationPreference)
//   6. Log EntityActivityLog

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sendPOSubmittedEmail } from '@/lib/resend'
import { writeAuditEvent } from '@/lib/audit'

const SUBMIT_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface WorkflowStep { step: number; role: string; label: string }

// ---------------------------------------------------------------------------
// Match best ApprovalWorkflow for the PO
// ---------------------------------------------------------------------------

async function findWorkflow(orgId: string, totalAmount: number, spendCategory: string | null, department: string | null) {
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { orgId, isActive: true },
    orderBy: { thresholdMin: 'desc' },
  })

  for (const wf of workflows) {
    const amountOk = totalAmount >= wf.thresholdMin &&
                     (wf.thresholdMax === null || totalAmount <= wf.thresholdMax)
    if (!amountOk) continue

    const catOk = wf.spendCategories.length === 0 ||
                  (spendCategory && wf.spendCategories.includes(spendCategory))
    if (!catOk) continue

    const deptOk = wf.departments.length === 0 ||
                   (department && wf.departments.includes(department))
    if (!deptOk) continue

    return wf
  }
  return null
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

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

    // Find matching workflow
    const workflow = await findWorkflow(session.orgId, po.totalAmount, po.spendCategory, po.department)

    let steps: WorkflowStep[] = []
    if (workflow) {
      steps = workflow.steps as unknown as WorkflowStep[]
    } else {
      // No matching workflow — fall back to first CONTROLLER or CFO in org
      const fallbackMember = await prisma.orgMember.findFirst({
        where:   { orgId: session.orgId, role: { in: ['CONTROLLER', 'CFO'] as never[] }, status: 'active' },
        include: { user: { select: { id: true } } },
        orderBy: { createdAt: 'asc' },
      })
      if (!fallbackMember) {
        throw new ValidationError(
          'No approval workflow found for this PO and no CONTROLLER or CFO exists in the organisation. ' +
          'Please configure an approval workflow in Settings → Approval Workflows before submitting.'
        )
      }
      steps = [{ step: 1, role: fallbackMember.role, label: 'Approval' }]
    }

    if (steps.length === 0) throw new ValidationError('Approval workflow has no steps configured')

    // For each step, find the first org member with that role
    const approvalData: { poId: string; workflowId?: string; step: number; approverId: string; status: string }[] = []
    for (const s of steps) {
      const member = await prisma.orgMember.findFirst({
        where:   { orgId: session.orgId, role: s.role as never, status: 'active' },
        include: { user: { select: { id: true } } },
        orderBy: { createdAt: 'asc' },
      })
      if (!member) {
        throw new ValidationError(
          `Cannot submit: no active user with role ${s.role} found for step ${s.step} "${s.label}". ` +
          'Ensure at least one user holds this role before submitting.'
        )
      }
      approvalData.push({
        poId:       id,
        workflowId: workflow?.id,
        step:       s.step,
        approverId: member.userId,
        status:     s.step === 1 ? 'PENDING' : 'PENDING',  // all PENDING initially; only step 1 is actionable
      })
    }

    // Atomic: create approval records + advance PO status together.
    await prisma.$transaction(async (tx) => {
      await tx.pOApproval.createMany({ data: approvalData as never[] })
      await tx.purchaseOrder.update({
        where: { id },
        data:  {
          status:             'PENDING_APPROVAL' as never,
          approvalWorkflowId: workflow?.id ?? null,
        },
      })
      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'SUBMIT',
        objectType: 'PURCHASE_ORDER',
        objectId:   id,
      })
    }, { timeout: 15000 })

    // Audit log — non-critical follow-up write, outside transaction.
    await prisma.entityActivityLog.create({
      data: {
        entityId:    po.entityId,
        orgId:       session.orgId!,
        activityType: 'STATUS_CHANGE' as never,
        title:       `PO submitted for approval: ${po.poNumber}`,
        description: `${po.title} — ${po.totalAmount} ${po.currency}`,
        referenceId:   id,
        referenceType: 'PurchaseOrder',
        performedBy:   session.userId,
      },
    }).catch(e => console.error('[po-submit] audit log failed:', e))

    // Notify first-step approver (outside transaction — email failure should not roll back)
    const firstApproval = approvalData[0]
    if (firstApproval) {
      const approver = await prisma.user.findUnique({
        where:  { id: firstApproval.approverId },
        select: { id: true, name: true, email: true },
      })
      const pref = approver
        ? await prisma.notificationPreference.findUnique({ where: { userId: approver.id } })
        : null

      if (approver && (!pref || pref.emailOnInvoiceRouted)) {
        await sendPOSubmittedEmail({
          to:          approver.email,
          assigneeName: approver.name ?? approver.email,
          poNumber:    po.poNumber,
          vendorName:  po.entity.name,
          totalAmount: po.totalAmount,
          currency:    po.currency,
          poId:        id,
          stepLabel:   steps[0]?.label ?? 'Approval',
        }).catch(e => console.error('[po-submit] email failed:', e))
      }
    }

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        lineItems:   { orderBy: { lineNo: 'asc' } },
        approvals:   { orderBy: { step: 'asc' } },
        approvalWorkflow: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ purchaseOrder: updated })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/submit')
  }
}
