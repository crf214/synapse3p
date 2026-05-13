// src/app/api/invoices/[id]/approve/route.ts
// POST — route invoice to approver (creates InvoiceApproval + sends notification)
// PATCH — record an approver decision (approve/reject/escalate)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { sendInvoiceAssignedEmail } from '@/lib/resend'
import { writeAuditEvent } from '@/lib/audit'
import { WorkflowEngine } from '@/lib/workflow-engine'
import { performThreeWayMatch } from '@/lib/matching/three-way-match'

const RouteInvoiceSchema = z.object({
  assignedTo: z.string().min(1),
  notes:      z.string().optional(),
})

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
    const orgId = session.orgId
    if (!session.role || !ROUTE_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = RouteInvoiceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where:   { id, orgId: orgId },
      include: { entity: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.status === 'DUPLICATE') {
      throw new ValidationError('Cannot route a quarantined duplicate invoice')
    }

    // Validate assignee exists in org and has appropriate role
    const assignee = await prisma.orgMember.findFirst({
      where:   { orgId: orgId, userId: body.assignedTo, status: 'active' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    })
    if (!assignee) throw new NotFoundError('Approver not found in this organisation')
    if (!APPROVE_ROLES.has(assignee.role)) {
      throw new ValidationError(`User with role ${assignee.role} cannot approve invoices`)
    }

    const approval = await prisma.$transaction(async (tx) => {
      const created = await tx.invoiceApproval.create({
        data: {
          invoiceId:  invoice.id,
          orgId:      orgId,
          assignedTo: body.assignedTo,
          assignedBy: session.userId!,
          role:       assignee.role,
          status:     'PENDING',
          notes:      body.notes ? sanitiseString(body.notes, 1000) : null,
        },
      })

      // Update invoice status
      await tx.invoice.update({
        where: { id: invoice.id },
        data:  { status: 'PENDING_REVIEW' },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'APPROVE',
        objectType: 'INVOICE',
        objectId:   invoice.id,
      })

      return created
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
    const orgId = session.orgId
    if (!session.role || !APPROVE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as {
      decision:                   string
      notes?:                     string
      escalateTo?:                string   // userId, required when decision = ESCALATED
      matchOverrideJustification?: string  // CONTROLLER/CFO only — bypass failed three-way match
    }

    if (!body.decision || !VALID_DECISIONS.has(body.decision)) {
      throw new ValidationError(`decision must be one of: ${[...VALID_DECISIONS].join(', ')}`)
    }
    if (body.decision === 'ESCALATED' && !body.escalateTo) {
      throw new ValidationError('escalateTo is required when decision is ESCALATED')
    }

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where:   { id, orgId: orgId },
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

    // Collect latest risk score for context snapshot (outside tx — read-only, not time-sensitive)
    const latestRisk = await prisma.riskEvaluation.findFirst({
      where:   { invoiceId: invoice.id },
      orderBy: { evaluatedAt: 'desc' },
      include: { signals: true },
    })

    // H6: matchType determined inside the transaction to prevent budget race conditions.
    // performThreeWayMatch re-reads po.amountSpent fresh from the DB inside the same tx.
    let matchType: 'THREE_WAY' | 'NONE' | null = null
    let preCheckResult: Awaited<ReturnType<typeof performThreeWayMatch>> | null = null

    // Optimistic pre-check outside tx (provides early 422 with full diagnostics before any writes)
    if (body.decision === 'APPROVED' && invoice.poId) {
      preCheckResult = await performThreeWayMatch(invoice.poId, invoice.id, prisma)
      if (!preCheckResult.passed) {
        const canOverride = (session.role === 'CONTROLLER' || session.role === 'CFO' || session.role === 'ADMIN')
        const hasJustification = (body.matchOverrideJustification?.trim().length ?? 0) >= 10
        if (!canOverride || !hasJustification) {
          return NextResponse.json({
            error: {
              code:    'THREE_WAY_MATCH_FAILED',
              message: preCheckResult.failureReason ?? 'Three-way match failed',
              checks:  preCheckResult.checks,
              po:      preCheckResult.po,
              grCount: preCheckResult.grCount,
            },
          }, { status: 422 })
        }
      }
    }

    await prisma.$transaction(async tx => {
      // H6: Atomic re-check inside the transaction — re-reads po.amountSpent fresh so
      // concurrent approvals cannot both pass the same stale budget value.
      if (body.decision === 'APPROVED' && invoice.poId) {
        const matchResult = await performThreeWayMatch(invoice.poId, invoice.id, tx)
        matchType = matchResult.matchType
        if (!matchResult.passed) {
          const canOverride = (session.role === 'CONTROLLER' || session.role === 'CFO' || session.role === 'ADMIN')
          const hasJustification = (body.matchOverrideJustification?.trim().length ?? 0) >= 10
          if (!canOverride || !hasJustification) {
            throw new Error(`THREE_WAY_MATCH_FAILED: ${matchResult.failureReason ?? 'Three-way match failed'}`)
          }
          matchType = 'NONE'
        }
      }

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

      // M3: Prevent upsert from overwriting an existing final decision
      const existingDecision = await tx.invoiceDecision.findUnique({
        where:  { invoiceId: invoice.id },
        select: { decision: true },
      })
      if (existingDecision && ['APPROVE', 'REJECT'].includes(existingDecision.decision as string)) {
        throw new Error('FINAL_DECISION_EXISTS: A final decision has already been recorded for this invoice.')
      }

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

      // Update invoice status (and matchType when approving a PO-linked invoice)
      const newStatus =
        body.decision === 'APPROVED' ? 'APPROVED' :
        body.decision === 'REJECTED' ? 'REJECTED' : 'PENDING_REVIEW'
      await tx.invoice.update({
        where: { id: invoice.id },
        data:  {
          status:    newStatus as never,
          ...(body.decision === 'APPROVED' && matchType !== null ? { matchType: matchType as never } : {}),
        },
      })

      // If escalated, create a new approval for the escalation target
      if (body.decision === 'ESCALATED' && body.escalateTo) {
        // M2: Verify the escalation target is an active org member before assigning
        const escalatee = await tx.orgMember.findFirst({
          where:   { orgId: orgId, userId: body.escalateTo, status: 'active' },
          include: { user: true },
        })
        if (!escalatee) {
          throw new Error('ESCALATION_TARGET_INACTIVE: Escalation target is not an active member of this organisation.')
        }
        if (escalatee) {
          await tx.invoiceApproval.create({
            data: {
              invoiceId:  invoice.id,
              orgId:      orgId,
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

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'APPROVE',
        objectType: 'INVOICE',
        objectId:   invoice.id,
      })
    }, { timeout: 15000 })

    // --- Workflow engine integration ---
    // If there is an active WorkflowInstance for this invoice with an IN_PROGRESS
    // APPROVAL step assigned to the current user, complete it via the engine.
    // This runs after the legacy approval path so backward compat is maintained.
    try {
      const activeInstance = await prisma.workflowInstance.findFirst({
        where: {
          targetObjectType: 'INVOICE',
          targetObjectId:   id,
          orgId:            orgId,
          status:           'IN_PROGRESS',
        },
        include: {
          stepInstances: {
            where:   { status: { in: ['IN_PROGRESS', 'PENDING'] } },
            include: { stepDefinition: { select: { stepType: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (activeInstance) {
        // C3 fix: only match steps explicitly assigned to the current user.
        // Removing the `|| si.assignedTo === null` branch prevents any
        // authenticated user from claiming and completing an unassigned step.
        const approvalStep = activeInstance.stepInstances.find(
          si => si.stepDefinition.stepType === 'APPROVAL' &&
                (si.status === 'IN_PROGRESS' || si.status === 'PENDING') &&
                si.assignedTo === session.userId,
        )

        if (approvalStep) {
          const engineResult: 'PASS' | 'FAIL' =
            body.decision === 'APPROVED' ? 'PASS' : 'FAIL'
          const engine = new WorkflowEngine(prisma)
          await engine.completeStep(
            approvalStep.id,
            engineResult,
            session.userId!,
            body.notes,
          )
        }
      }
    } catch (engineErr) {
      // Non-fatal — log and continue; legacy approval path already succeeded
      console.warn('[approve/PATCH] WorkflowEngine.completeStep failed:', engineErr)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/invoices/[id]/approve')
  }
}
