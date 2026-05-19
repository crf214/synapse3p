// src/app/api/approvals/route.ts — unified pending-approvals queue for the current user

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError } from '@/lib/errors'

type ApprovalItem = {
  id:        string
  type:      'PO' | 'INVOICE' | 'ENTITY' | 'MERGED_AUTH'
  subjectId: string
  reference: string
  title:     string
  entityId:  string | null
  entity:    string
  amount:    number
  currency:  string
  step:      number | null
  requester: { id: string; name: string | null; email: string } | null
  createdAt: string
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId) throw new UnauthorizedError('No organisation associated with this session')

    const userId = session.userId
    const orgId  = session.orgId

    // ── PO approvals ──────────────────────────────────────────────────────────
    // Legacy POApproval rows (pre-workflow-engine POs)
    const poApprovals = await prisma.pOApproval.findMany({
      where: { approverId: userId, status: 'PENDING', po: { orgId } },
      include: {
        po: {
          select: {
            id: true,
            poNumber: true,
            title: true,
            totalAmount: true,
            currency: true,
            status: true,
            requestedBy: true,
            createdAt: true,
            entity: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Workflow-engine approval steps across all object types.
    // Steps are created with assignedTo=NULL and a role-based claim rule
    // in stepDefinition.config.requiredRole. ADMIN sees all; other users
    // see steps either explicitly assigned to them OR open to their role.
    const role = session.role ?? ''
    const allWorkflowSteps = await prisma.workflowStepInstance.findMany({
      where: {
        status:         { in: ['IN_PROGRESS', 'PENDING'] },
        stepDefinition: { stepType: 'APPROVAL' },
        workflowInstance: {
          orgId,
          status:           'IN_PROGRESS',
          targetObjectType: { in: ['PURCHASE_ORDER', 'INVOICE', 'ENTITY'] },
        },
      },
      include: {
        stepDefinition:   { select: { config: true, name: true } },
        workflowInstance: { select: { targetObjectId: true, targetObjectType: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const visibleSteps = allWorkflowSteps.filter(step => {
      if (step.assignedTo && step.assignedTo === userId) return true
      if (step.assignedTo && step.assignedTo !== userId) return false
      // assignedTo is null — role-based claim
      if (role === 'ADMIN') return true
      const cfg = step.stepDefinition.config as { requiredRole?: string } | null
      return !!cfg?.requiredRole && cfg.requiredRole === role
    })

    // Batch-fetch related objects per type
    const poIds      = [...new Set(visibleSteps.filter(s => s.workflowInstance.targetObjectType === 'PURCHASE_ORDER').map(s => s.workflowInstance.targetObjectId))]
    const invoiceIds = [...new Set(visibleSteps.filter(s => s.workflowInstance.targetObjectType === 'INVOICE').map(s => s.workflowInstance.targetObjectId))]
    const entityIds  = [...new Set(visibleSteps.filter(s => s.workflowInstance.targetObjectType === 'ENTITY').map(s => s.workflowInstance.targetObjectId))]

    const [workflowPOs, workflowInvoices, workflowEntities] = await Promise.all([
      poIds.length > 0
        ? prisma.purchaseOrder.findMany({
            where:  { id: { in: poIds }, orgId },
            select: {
              id: true, poNumber: true, title: true, totalAmount: true, currency: true,
              status: true, requestedBy: true, createdAt: true,
              entity: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      invoiceIds.length > 0
        ? prisma.invoice.findMany({
            where:  { id: { in: invoiceIds }, orgId },
            select: {
              id: true, invoiceNo: true, amount: true, currency: true, status: true, createdAt: true,
              entity: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      entityIds.length > 0
        ? prisma.entity.findMany({
            where:  { id: { in: entityIds }, masterOrgId: orgId },
            select: { id: true, name: true, slug: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
    ])

    const poById      = Object.fromEntries(workflowPOs.map(po => [po.id, po]))
    const invoiceById = Object.fromEntries(workflowInvoices.map(inv => [inv.id, inv]))
    const entityById  = Object.fromEntries(workflowEntities.map(e => [e.id, e]))

    // De-duplicate invoice workflow steps against the legacy invoiceApproval table:
    // skip a workflow step if the user already has a legacy row for the same invoice.

    // ── Invoice approvals ─────────────────────────────────────────────────────
    const invoiceApprovals = await prisma.invoiceApproval.findMany({
      where: { assignedTo: userId, orgId, status: 'PENDING' },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            amount: true,
            currency: true,
            invoiceDate: true,
            status: true,
            createdAt: true,
            entity: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { assignedAt: 'asc' },
    })

    // ── Merged-auth approvals (CONTROLLER / CFO / ADMIN only) ─────────────────
    const showMergedAuth = ['ADMIN', 'CONTROLLER', 'CFO'].includes(session.role ?? '')
    const mergedAuthsQuery = {
      where: { orgId, status: 'PENDING_APPROVAL' as const },
      include: {
        items: {
          select: {
            id: true,
            invoice: { select: { id: true, invoiceNo: true, amount: true, currency: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    }
    const mergedAuths = showMergedAuth
      ? await prisma.mergedAuthorization.findMany(mergedAuthsQuery)
      : ([] as Awaited<ReturnType<typeof prisma.mergedAuthorization.findMany<typeof mergedAuthsQuery>>>)

    const legacyInvoiceIdsForUser = new Set(invoiceApprovals.map(a => a.invoice.id))

    // Collect all requester userIds so we can batch-fetch names
    const requesterIds = new Set<string>()
    for (const a of poApprovals) requesterIds.add(a.po.requestedBy)
    for (const m of mergedAuths) requesterIds.add(m.createdBy)
    for (const po of workflowPOs) requesterIds.add(po.requestedBy)

    const requesterUsers = requesterIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...requesterIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(requesterUsers.map(u => [u.id, u]))

    // ── Shape unified list ────────────────────────────────────────────────────
    const items: ApprovalItem[] = [
      ...poApprovals.map(a => ({
        id:          a.id,
        type:        'PO' as const,
        subjectId:   a.po.id,
        reference:   a.po.poNumber,
        title:       a.po.title,
        entityId:    a.po.entity.id,
        entity:      a.po.entity.name,
        amount:      Number(a.po.totalAmount),
        currency:    a.po.currency,
        step:        a.step,
        requester:   userMap[a.po.requestedBy] ?? null,
        createdAt:   a.createdAt.toISOString(),
      })),

      ...visibleSteps.flatMap((step): ApprovalItem[] => {
        const targetId = step.workflowInstance.targetObjectId
        const targetType = step.workflowInstance.targetObjectType
        if (targetType === 'PURCHASE_ORDER') {
          const po = poById[targetId]
          if (!po) return []
          return [{
            id:        step.id,
            type:      'PO' as const,
            subjectId: po.id,
            reference: po.poNumber,
            title:     po.title,
            entityId:  po.entity.id,
            entity:    po.entity.name,
            amount:    Number(po.totalAmount),
            currency:  po.currency,
            step:      null as number | null,
            requester: userMap[po.requestedBy] ?? null,
            createdAt: step.createdAt.toISOString(),
          }]
        }
        if (targetType === 'INVOICE') {
          // De-dupe against legacy invoiceApproval rows for the same invoice/user
          if (legacyInvoiceIdsForUser.has(targetId)) return []
          const inv = invoiceById[targetId]
          if (!inv) return []
          return [{
            id:        step.id,
            type:      'INVOICE' as const,
            subjectId: inv.id,
            reference: inv.invoiceNo,
            title:     `Invoice ${inv.invoiceNo}`,
            entityId:  inv.entity.id,
            entity:    inv.entity.name,
            amount:    Number(inv.amount),
            currency:  inv.currency,
            step:      null as number | null,
            requester: null,
            createdAt: step.createdAt.toISOString(),
          }]
        }
        if (targetType === 'ENTITY') {
          const ent = entityById[targetId]
          if (!ent) return []
          return [{
            id:        step.id,
            type:      'ENTITY' as const,
            subjectId: ent.id,
            reference: ent.slug,
            title:     `Entity onboarding: ${ent.name}`,
            entityId:  ent.id,
            entity:    ent.name,
            amount:    0,
            currency:  '',
            step:      null as number | null,
            requester: null,
            createdAt: step.createdAt.toISOString(),
          }]
        }
        return []
      }),

      ...invoiceApprovals.map(a => ({
        id:          a.id,
        type:        'INVOICE' as const,
        subjectId:   a.invoice.id,
        reference:   a.invoice.invoiceNo,
        title:       `Invoice ${a.invoice.invoiceNo}`,
        entityId:    a.invoice.entity.id,
        entity:      a.invoice.entity.name,
        amount:      Number(a.invoice.amount),
        currency:    a.invoice.currency,
        step:        null,
        requester:   null,
        createdAt:   a.assignedAt.toISOString(),
      })),

      ...mergedAuths.map(m => ({
        id:          m.id,
        type:        'MERGED_AUTH' as const,
        subjectId:   m.id,
        reference:   m.reference,
        title:       m.name ?? `Batch ${m.reference}`,
        entityId:    null,
        entity:      `${m.items.length} invoice${m.items.length !== 1 ? 's' : ''}`,
        amount:      Number(m.totalAmount),
        currency:    m.currency,
        step:        null,
        requester:   userMap[m.createdBy] ?? null,
        createdAt:   m.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    return NextResponse.json({ items })
  } catch (err) {
    return handleApiError(err, 'GET /api/approvals')
  }
}
