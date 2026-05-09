// src/app/api/approvals/route.ts — unified pending-approvals queue for the current user

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError } from '@/lib/errors'

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()

    const userId = session.userId
    const orgId  = session.orgId!

    // ── PO approvals ──────────────────────────────────────────────────────────
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

    // Collect all requester userIds so we can batch-fetch names
    const requesterIds = new Set<string>()
    for (const a of poApprovals) requesterIds.add(a.po.requestedBy)
    for (const m of mergedAuths) requesterIds.add(m.createdBy)

    const requesterUsers = requesterIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...requesterIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(requesterUsers.map(u => [u.id, u]))

    // ── Shape unified list ────────────────────────────────────────────────────
    const items = [
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
    return handleApiError(err, "")
  }
}
