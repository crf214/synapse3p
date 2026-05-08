// src/app/api/invoices/[id]/approve/route.ts
// POST — route invoice to approver (creates InvoiceApproval + sends notification)
// PATCH — record an approver decision (approve/reject/escalate)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { sendInvoiceAssignedEmail } from '@/lib/resend'

const ROUTE_ROLES   = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const APPROVE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const VALID_DECISIONS = new Set(['APPROVED', 'REJECTED', 'ESCALATED'])

// ---------------------------------------------------------------------------
// POST — route to approver
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ROUTE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as { assignedTo: string; notes?: string }
    if (!body.assignedTo) throw new ValidationError('assignedTo is required')

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where:   { id, orgId: session.orgId },
      include: { entity: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.status === 'DUPLICATE') {
      throw new ValidationError('Cannot route a quarantined duplicate invoice')
    }

    // Validate assignee exists in org and has appropriate role
    const assignee = await prisma.orgMember.findFirst({
      where:   { orgId: session.orgId, userId: body.assignedTo, status: 'active' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    })
    if (!assignee) throw new NotFoundError('Approver not found in this organisation')
    if (!APPROVE_ROLES.has(assignee.role)) {
      throw new ValidationError(`User with role ${assignee.role} cannot approve invoices`)
    }

    const approval = await prisma.invoiceApproval.create({
      data: {
        invoiceId:  invoice.id,
        orgId:      session.orgId,
        assignedTo: body.assignedTo,
        assignedBy: session.userId!,
        role:       assignee.role,
        status:     'PENDING',
        notes:      body.notes ? sanitiseString(body.notes, 1000) : null,
      },
    })

    // Update invoice status
    await prisma.invoice.update({
      where: { id: invoice.id },
      data:  { status: 'PENDING_REVIEW' },
    })

    // Send email notification if preference allows
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: body.assignedTo },
    })
    const emailEnabled = pref === null ? true : pref.emailOnInvoiceRouted  // default on

    if (emailEnabled && assignee.user.email) {
      sendInvoiceAssignedEmail({
        to:           assignee.user.email,
        assigneeName: assignee.user.name ?? assignee.user.email,
        invoiceNo:    invoice.invoiceNo,
        vendorName:   invoice.entity.name,
        amount:       invoice.amount,
        currency:     invoice.currency,
        invoiceId:    invoice.id,
      }).catch(err => console.error('[approve/POST] email error:', err))
    }

    return NextResponse.json({ approval: { id: approval.id, status: approval.status } }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/[id]/approve')
  }
}

// ---------------------------------------------------------------------------
// PATCH — record approver decision
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !APPROVE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as {
      decision:    string
      notes?:      string
      escalateTo?: string   // userId, required when decision = ESCALATED
    }

    if (!body.decision || !VALID_DECISIONS.has(body.decision)) {
      throw new ValidationError(`decision must be one of: ${[...VALID_DECISIONS].join(', ')}`)
    }
    if (body.decision === 'ESCALATED' && !body.escalateTo) {
      throw new ValidationError('escalateTo is required when decision is ESCALATED')
    }

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where:   { id, orgId: session.orgId },
      include: { entity: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    // Find the pending approval for this user
    const approval = await prisma.invoiceApproval.findFirst({
      where: { invoiceId: invoice.id, assignedTo: session.userId, status: 'PENDING' },
    })
    if (!approval) throw new NotFoundError('No pending approval found for your user on this invoice')

    const approvalStatus =
      body.decision === 'APPROVED'  ? 'APPROVED'  :
      body.decision === 'REJECTED'  ? 'REJECTED'  : 'DELEGATED'

    // Collect latest risk score for context snapshot
    const latestRisk = await prisma.riskEvaluation.findFirst({
      where:   { invoiceId: invoice.id },
      orderBy: { evaluatedAt: 'desc' },
      include: { signals: true },
    })

    await prisma.$transaction(async tx => {
      // Update the approval
      await tx.invoiceApproval.update({
        where: { id: approval.id },
        data:  {
          status:     approvalStatus,
          decision:   body.decision,
          decidedAt:  new Date(),
          notes:      body.notes ? sanitiseString(body.notes, 2000) : null,
          delegatedTo: body.escalateTo ?? null,
        },
      })

      // Record decision with context snapshot for long-term audit integrity
      const decisionType =
        body.decision === 'APPROVED'  ? 'APPROVE' :
        body.decision === 'REJECTED'  ? 'REJECT'  : 'ESCALATE'

      await tx.invoiceDecision.upsert({
        where:  { invoiceId: invoice.id },
        create: {
          invoiceId:  invoice.id,
          decision:   decisionType as never,
          riskScore:  latestRisk?.overallScore ?? 0,
          reasoning:  {
            decidedBy:  session.userId,
            decision:   body.decision,
            notes:      body.notes ?? null,
            escalateTo: body.escalateTo ?? null,
            riskSnapshot: latestRisk ? {
              tier:   latestRisk.tier,
              score:  latestRisk.overallScore,
              flags:  latestRisk.flags,
              signals: latestRisk.signals.map(s => ({ type: s.signalType, triggered: s.triggered, detail: s.detail })),
            } : null,
          },
          decidedAt:  new Date(),
          decidedBy:  session.userId!,
        },
        update: {
          decision:    decisionType as never,
          riskScore:   latestRisk?.overallScore ?? 0,
          reasoning:   {
            decidedBy:  session.userId,
            decision:   body.decision,
            notes:      body.notes ?? null,
            escalateTo: body.escalateTo ?? null,
            riskSnapshot: latestRisk ? {
              tier:   latestRisk.tier,
              score:  latestRisk.overallScore,
              flags:  latestRisk.flags,
              signals: latestRisk.signals.map(s => ({ type: s.signalType, triggered: s.triggered, detail: s.detail })),
            } : null,
          },
          overriddenBy: session.userId,
          overriddenAt: new Date(),
        },
      })

      // Update invoice status
      const newStatus =
        body.decision === 'APPROVED' ? 'APPROVED' :
        body.decision === 'REJECTED' ? 'REJECTED' : 'PENDING_REVIEW'
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: newStatus as never } })

      // If escalated, create a new approval for the escalation target
      if (body.decision === 'ESCALATED' && body.escalateTo) {
        const escalatee = await tx.orgMember.findFirst({
          where:   { orgId: session.orgId!, userId: body.escalateTo },
          include: { user: true },
        })
        if (escalatee) {
          await tx.invoiceApproval.create({
            data: {
              invoiceId:  invoice.id,
              orgId:      session.orgId!,
              assignedTo: body.escalateTo,
              assignedBy: session.userId!,
              role:       escalatee.role,
              status:     'PENDING',
              notes:      `Escalated from ${session.userId}. ${body.notes ?? ''}`.trim(),
            },
          })

          // Notify escalation target
          const pref = await tx.notificationPreference.findUnique({ where: { userId: body.escalateTo } })
          if ((pref === null ? true : pref.emailOnInvoiceRouted) && escalatee.user.email) {
            sendInvoiceAssignedEmail({
              to:          escalatee.user.email,
              assigneeName: escalatee.user.name ?? escalatee.user.email,
              invoiceNo:   invoice.invoiceNo,
              vendorName:  invoice.entity.name,
              amount:      invoice.amount,
              currency:    invoice.currency,
              invoiceId:   invoice.id,
            }).catch(err => console.error('[approve/PATCH] escalation email error:', err))
          }
        }
      }
    }, { timeout: 15000 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/invoices/[id]/approve')
  }
}
