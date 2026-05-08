// src/app/api/approvals/[id]/decide/route.ts
// Unified decide endpoint — handles PO approvals, invoice approvals, and merged-auth.
// Body: { type: 'PO' | 'INVOICE' | 'MERGED_AUTH', decision: 'APPROVED' | 'REJECTED', comments?: string }

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()

    const { id } = params
    const body = await req.json()
    const { type, decision, comments } = body as {
      type: 'PO' | 'INVOICE' | 'MERGED_AUTH'
      decision: 'APPROVED' | 'REJECTED'
      comments?: string
    }

    if (!['PO', 'INVOICE', 'MERGED_AUTH'].includes(type)) throw new ValidationError('Invalid type')
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new ValidationError('decision must be APPROVED or REJECTED')

    // ── PO approval ───────────────────────────────────────────────────────────
    if (type === 'PO') {
      const approval = await prisma.pOApproval.findFirst({ where: { id, po: { orgId: session.orgId } } })
      if (!approval) throw new NotFoundError('Approval not found')
      if (approval.approverId !== session.userId) throw new ForbiddenError()
      if (approval.status !== 'PENDING') throw new ValidationError('Approval is no longer pending')

      await prisma.pOApproval.update({
        where: { id },
        data: { status: decision, decidedAt: new Date(), comments: comments ?? null },
      })

      // Delegate to existing PO approve logic via internal fetch is heavy; do it inline.
      if (decision === 'APPROVED') {
        // Check if all steps at this step-level are approved
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: approval.poId },
          include: { approvals: true },
        })
        if (!po) throw new NotFoundError('PO not found')

        const currentStepApprovals = po.approvals.filter(a => a.step === approval.step)
        const allApproved = currentStepApprovals.every(a =>
          a.id === id ? true : a.status === 'APPROVED'
        )

        if (allApproved) {
          // Check if there's a next step
          const maxStep = Math.max(...po.approvals.map(a => a.step))
          if (approval.step >= maxStep) {
            await prisma.purchaseOrder.update({
              where: { id: approval.poId },
              data: { status: 'APPROVED' },
            })
          }
          // else: next step approvers will be notified by existing workflow; leave PENDING_APPROVAL
        }
      } else {
        // Rejected — push PO back to DRAFT
        await prisma.purchaseOrder.update({
          where: { id: approval.poId },
          data: { status: 'REJECTED' },
        })
      }

      return NextResponse.json({ ok: true })
    }

    // ── Invoice approval ──────────────────────────────────────────────────────
    if (type === 'INVOICE') {
      const approval = await prisma.invoiceApproval.findFirst({ where: { id, orgId: session.orgId } })
      if (!approval) throw new NotFoundError('Approval not found')
      if (approval.assignedTo !== session.userId) throw new ForbiddenError()
      if (approval.status !== 'PENDING') throw new ValidationError('Approval is no longer pending')

      await prisma.invoiceApproval.update({
        where: { id },
        data: {
          status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          decidedAt: new Date(),
          decision,
          notes: comments ?? null,
        },
      })

      // Update invoice status based on decision
      if (decision === 'APPROVED') {
        const remaining = await prisma.invoiceApproval.count({
          where: { invoiceId: approval.invoiceId, status: 'PENDING' },
        })
        if (remaining === 0) {
          await prisma.invoice.update({
            where: { id: approval.invoiceId },
            data: { status: 'APPROVED' },
          })
        }
      } else {
        await prisma.invoice.update({
          where: { id: approval.invoiceId },
          data: { status: 'REJECTED' },
        })
      }

      return NextResponse.json({ ok: true })
    }

    // ── Merged-auth approval ──────────────────────────────────────────────────
    if (type === 'MERGED_AUTH') {
      const allowed = ['ADMIN', 'CONTROLLER', 'CFO']
      if (!allowed.includes(session.role ?? '')) throw new ForbiddenError()

      const ma = await prisma.mergedAuthorization.findUnique({ where: { id } })
      if (!ma) throw new NotFoundError('Merged authorisation not found')
      if (ma.orgId !== session.orgId) throw new ForbiddenError()
      if (ma.status !== 'PENDING_APPROVAL') throw new ValidationError('Not pending approval')

      const newStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'
      await prisma.mergedAuthorization.update({
        where: { id },
        data: {
          status: newStatus,
          approvedBy: session.userId,
          approvedAt: new Date(),
          notes: comments ? `${ma.notes ?? ''}\n${comments}`.trim() : ma.notes,
        },
      })

      return NextResponse.json({ ok: true })
    }

    throw new ValidationError('Unhandled type')
  } catch (err) {
    return handleApiError(err, "")
  }
}
