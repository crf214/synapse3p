import { PrismaClient } from '@prisma/client'
import type { StepResult } from '../types'
import {
  sendInvoiceAssignedEmail,
  sendInvoiceDecisionEmail,
  sendPOSubmittedEmail,
  sendPODecisionEmail,
} from '@/lib/resend'

// Config shape:
// {
//   templateId: string           — 'invoice_approved' | 'invoice_rejected' | 'invoice_assigned'
//                                   | 'po_submitted' | 'po_approved' | 'po_rejected' | 'po_changes_requested'
//   stepLabel?: string           — display label used in PO approval emails
// }
//
// Context shape (provided by workflow engine):
// {
//   invoiceId?: string
//   purchaseOrderId?: string
//   approverId?: string          — for po_submitted: the approver to notify
//   submitterId?: string         — for invoice decisions: the submitter to notify
//   assigneeId?: string          — for invoice_assigned: the new assignee
//   approverName?: string        — optional display name for invoice decision email
//   reason?: string              — optional reason/comments for decision emails
//   comments?: string            — optional comments for PO decision emails
// }
export async function handleNotificationStep(
  _stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  prisma?: PrismaClient,
): Promise<StepResult> {
  const templateId = typeof config.templateId === 'string' ? config.templateId : ''
  const stepLabel  = typeof config.stepLabel  === 'string' ? config.stepLabel  : 'approval'

  if (!templateId) {
    console.warn('[WorkflowEngine:notification] No templateId in config — skipping email')
    return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no templateId' } }
  }

  if (!prisma) {
    console.warn('[WorkflowEngine:notification] No Prisma client provided — skipping email')
    return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no prisma' } }
  }

  try {
    // -----------------------------------------------------------------------
    // Invoice notifications
    // -----------------------------------------------------------------------
    if (
      templateId === 'invoice_approved' ||
      templateId === 'invoice_rejected' ||
      templateId === 'invoice_assigned'
    ) {
      const invoiceId = typeof context.invoiceId === 'string' ? context.invoiceId : null
      if (!invoiceId) {
        console.warn('[WorkflowEngine:notification] Missing invoiceId in context for template', templateId)
        return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no invoiceId' } }
      }

      const invoice = await prisma.invoice.findUnique({
        where:  { id: invoiceId },
        select: { id: true, invoiceNo: true, amount: true, currency: true, entityId: true },
      })
      if (!invoice) {
        console.warn('[WorkflowEngine:notification] Invoice not found:', invoiceId)
        return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'invoice not found' } }
      }

      const entity = await prisma.entity.findUnique({
        where:  { id: invoice.entityId },
        select: { name: true },
      })
      const vendorName = entity?.name ?? 'Unknown vendor'

      if (templateId === 'invoice_assigned') {
        const assigneeId = typeof context.assigneeId === 'string' ? context.assigneeId : null
        if (!assigneeId) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no assigneeId' } }
        }
        const assignee = await prisma.user.findUnique({
          where:  { id: assigneeId },
          select: { email: true, name: true },
        })
        if (!assignee?.email) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'assignee has no email' } }
        }
        await sendInvoiceAssignedEmail({
          to:           assignee.email,
          assigneeName: assignee.name ?? 'Team member',
          invoiceNo:    invoice.invoiceNo ?? invoiceId,
          vendorName,
          amount:       Number(invoice.amount),
          currency:     invoice.currency,
          invoiceId,
        })

      } else {
        // invoice_approved / invoice_rejected — notify the submitter
        const decision = templateId === 'invoice_approved' ? 'APPROVED' : 'REJECTED'
        const submitterId = typeof context.submitterId === 'string' ? context.submitterId : null
        if (!submitterId) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no submitterId in context' } }
        }

        const submitter = await prisma.user.findUnique({
          where:  { id: submitterId },
          select: { email: true, name: true },
        })
        if (!submitter?.email) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'submitter has no email' } }
        }

        const approverName =
          typeof context.approverName === 'string'
            ? context.approverName
            : 'An approver'

        await sendInvoiceDecisionEmail({
          to:            submitter.email,
          submitterName: submitter.name ?? 'Team member',
          invoiceNo:     invoice.invoiceNo ?? invoiceId,
          vendorName,
          amount:        Number(invoice.amount),
          currency:      invoice.currency,
          invoiceId,
          decision,
          approverName,
          reason: typeof context.reason === 'string' ? context.reason : undefined,
        })
      }

      return { status: 'COMPLETED', result: 'PASS', metadata: { templateId, invoiceId } }
    }

    // -----------------------------------------------------------------------
    // PO notifications
    // -----------------------------------------------------------------------
    if (
      templateId === 'po_submitted' ||
      templateId === 'po_approved' ||
      templateId === 'po_rejected' ||
      templateId === 'po_changes_requested'
    ) {
      const poId = typeof context.purchaseOrderId === 'string' ? context.purchaseOrderId : null
      if (!poId) {
        console.warn('[WorkflowEngine:notification] Missing purchaseOrderId in context for template', templateId)
        return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no purchaseOrderId' } }
      }

      const po = await prisma.purchaseOrder.findUnique({
        where:  { id: poId },
        select: { id: true, poNumber: true, totalAmount: true, currency: true, requestedBy: true, entityId: true },
      })
      if (!po) {
        console.warn('[WorkflowEngine:notification] PO not found:', poId)
        return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'po not found' } }
      }

      const entity = await prisma.entity.findUnique({
        where:  { id: po.entityId },
        select: { name: true },
      })
      const vendorName = entity?.name ?? 'Unknown vendor'

      if (templateId === 'po_submitted') {
        const approverId = typeof context.approverId === 'string' ? context.approverId : null
        if (!approverId) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'no approverId' } }
        }
        const approver = await prisma.user.findUnique({
          where:  { id: approverId },
          select: { email: true, name: true },
        })
        if (!approver?.email) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'approver has no email' } }
        }
        await sendPOSubmittedEmail({
          to:           approver.email,
          assigneeName: approver.name ?? 'Team member',
          poNumber:     po.poNumber,
          vendorName,
          totalAmount:  Number(po.totalAmount),
          currency:     po.currency,
          poId,
          stepLabel,
        })

      } else {
        // po_approved / po_rejected / po_changes_requested — notify the requester
        const decisionMap = {
          po_approved:          'APPROVED',
          po_rejected:          'REJECTED',
          po_changes_requested: 'CHANGES_REQUESTED',
        } as const
        const decision = decisionMap[templateId as keyof typeof decisionMap] ?? 'APPROVED'

        const requester = await prisma.user.findUnique({
          where:  { id: po.requestedBy },
          select: { email: true, name: true },
        })
        if (!requester?.email) {
          return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'requester has no email' } }
        }
        await sendPODecisionEmail({
          to:          requester.email,
          creatorName: requester.name ?? 'Team member',
          poNumber:    po.poNumber,
          vendorName,
          totalAmount: Number(po.totalAmount),
          currency:    po.currency,
          poId,
          decision,
          comments:    typeof context.comments === 'string' ? context.comments : undefined,
        })
      }

      return { status: 'COMPLETED', result: 'PASS', metadata: { templateId, poId } }
    }

    // -----------------------------------------------------------------------
    // Unknown template — log and continue
    // -----------------------------------------------------------------------
    console.warn('[WorkflowEngine:notification] Unknown templateId — no email sent:', templateId)
    return { status: 'COMPLETED', result: 'PASS', metadata: { skipped: true, reason: 'unknown templateId', templateId } }

  } catch (err) {
    // Email failures must never block the workflow step
    console.error('[WorkflowEngine:notification] Email send failed — continuing anyway:', err)
    return {
      status:   'COMPLETED',
      result:   'PASS',
      metadata: { emailError: String(err), templateId },
    }
  }
}
