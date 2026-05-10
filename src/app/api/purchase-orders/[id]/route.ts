// src/app/api/purchase-orders/[id]/route.ts — GET detail + PUT update

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number(),
  unitPrice:   z.number(),
  taxRate:     z.number().optional(),
  glCode:      z.string().optional(),
  costCentre:  z.string().optional(),
  notes:       z.string().optional(),
})

const UpdatePurchaseOrderSchema = z.object({
  title:                z.string().optional(),
  description:          z.string().optional(),
  type:                 z.string().optional(),
  currency:             z.string().optional(),
  spendCategory:        z.string().optional(),
  department:           z.string().optional(),
  costCentre:           z.string().optional(),
  glCode:               z.string().optional(),
  validFrom:            z.string().nullable().optional(),
  validTo:              z.string().nullable().optional(),
  requiresGoodsReceipt: z.boolean().optional(),
  requiresContract:     z.boolean().optional(),
  notes:                z.string().optional(),
  lineItems:            z.array(LineItemSchema).optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

// ---------------------------------------------------------------------------
// GET — full PO detail with vendor context
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, orgId: session.orgId },
      include: {
        entity: {
          select: {
            id: true, name: true, slug: true,
            orgRelationships: {
              where: { orgId: session.orgId },
              select: { approvedSpendLimit: true },
              take: 1,
            },
          },
        },
        lineItems:    { orderBy: { lineNo: 'asc' } },
        approvals:    { orderBy: { step: 'asc' } },
        amendments:   { orderBy: { version: 'asc' } },
        goodsReceipts: { orderBy: { receivedAt: 'desc' } },
      },
    })

    if (!po) throw new NotFoundError('Purchase order not found')

    // Enrich approvals with approver user details
    const approverIds = po.approvals.map(a => a.approverId)
    const approverUsers = approverIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: approverIds } },
          select: { id: true, name: true, email: true, avatar: true },
        })
      : []
    const userMap = Object.fromEntries(approverUsers.map(u => [u.id, u]))

    const approvalsEnriched = po.approvals.map(a => ({
      ...a,
      approver: userMap[a.approverId] ?? null,
    }))

    // Enrich amendments with actor details
    const amendorIds = po.amendments.map(a => a.amendedBy)
    const amendorUsers = amendorIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...new Set(amendorIds)] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const amendorMap = Object.fromEntries(amendorUsers.map(u => [u.id, u]))

    const amendmentsEnriched = po.amendments.map(a => ({
      ...a,
      actor: amendorMap[a.amendedBy] ?? null,
    }))

    // Requestor user details
    const requestor = await prisma.user.findUnique({
      where:  { id: po.requestedBy },
      select: { id: true, name: true, email: true },
    })

    // Vendor context: spend history + recent invoices + open POs + contract
    const [spendHistory, recentInvoices, openPOs] = await Promise.all([
      prisma.vendorSpendSnapshot.findMany({
        where:   { entityId: po.entityId, orgId: session.orgId },
        orderBy: { period: 'desc' },
        take:    12,
      }),
      prisma.invoice.findMany({
        where:   { entityId: po.entityId, orgId: session.orgId },
        orderBy: { invoiceDate: 'desc' },
        take:    5,
        select:  { id: true, invoiceNo: true, amount: true, currency: true, invoiceDate: true, status: true },
      }),
      prisma.purchaseOrder.count({
        where: {
          entityId: po.entityId,
          orgId:    session.orgId,
          status:   { in: ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] as never[] },
          id:       { not: po.id },
        },
      }),
    ])

    const approvedSpendLimit = po.entity.orgRelationships[0]?.approvedSpendLimit ?? null

    return NextResponse.json({
      purchaseOrder: {
        ...po,
        requestor,
        approvals:   approvalsEnriched,
        amendments:  amendmentsEnriched,
        vendorContext: {
          spendHistory:   spendHistory.map(s => ({
            period:       s.period,
            totalAmount:  Number(s.totalAmount),
            avgAmount:    Number(s.avgAmount),
            invoiceCount: s.invoiceCount,
          })),
          recentInvoices,
          openPOCount:    openPOs,
          approvedSpendLimit,
        },
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/purchase-orders/[id]')
  }
}

// ---------------------------------------------------------------------------
// PUT — update purchase order (DRAFT only)
// ---------------------------------------------------------------------------

interface LineItemInput {
  description: string
  quantity:    number
  unitPrice:   number
  taxRate?:    number
  glCode?:     string
  costCentre?: string
  notes?:      string
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const existing = await prisma.purchaseOrder.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Purchase order not found')
    if (existing.status !== 'DRAFT') {
      throw new ValidationError('Only DRAFT purchase orders can be edited. Use the amend endpoint for approved POs.')
    }

    const rawBody = await req.json()
    const parsed = UpdatePurchaseOrderSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const updates: Record<string, unknown> = {}

    if (body.title       !== undefined) updates.title       = sanitiseString(body.title ?? '',       200).trim()
    if (body.description !== undefined) updates.description = sanitiseString(body.description ?? '', 1000).trim() || null
    if (body.type        !== undefined) updates.type        = body.type
    if (body.currency    !== undefined) updates.currency    = sanitiseString(body.currency ?? 'USD', 10).trim().toUpperCase()
    if (body.spendCategory !== undefined) updates.spendCategory = sanitiseString(body.spendCategory ?? '', 100).trim() || null
    if (body.department    !== undefined) updates.department    = sanitiseString(body.department ?? '',    100).trim() || null
    if (body.costCentre    !== undefined) updates.costCentre    = sanitiseString(body.costCentre ?? '',    100).trim() || null
    if (body.glCode        !== undefined) updates.glCode        = sanitiseString(body.glCode ?? '',         50).trim() || null
    if (body.validFrom     !== undefined) updates.validFrom     = body.validFrom ? new Date(body.validFrom) : null
    if (body.validTo       !== undefined) updates.validTo       = body.validTo   ? new Date(body.validTo)   : null
    if (body.requiresGoodsReceipt !== undefined) updates.requiresGoodsReceipt = body.requiresGoodsReceipt
    if (body.requiresContract     !== undefined) updates.requiresContract     = body.requiresContract
    if (body.notes !== undefined) updates.notes = sanitiseString(body.notes ?? '', 2000).trim() || null

    const currency = (updates.currency as string | undefined) ?? existing.currency

    if (body.lineItems !== undefined) {
      if (!body.lineItems.length) throw new ValidationError('At least one line item is required')

      const lineItems: LineItemInput[] = body.lineItems.map((item, i) => {
        const desc  = sanitiseString(item.description ?? '', 500).trim()
        const qty   = Number(item.quantity)
        const price = Number(item.unitPrice)
        const tax   = Number(item.taxRate ?? 0)
        if (!desc) throw new ValidationError(`Line item ${i + 1}: description is required`)
        if (qty   <= 0) throw new ValidationError(`Line item ${i + 1}: quantity must be positive`)
        if (price <  0) throw new ValidationError(`Line item ${i + 1}: unit price cannot be negative`)
        return { ...item, description: desc, quantity: qty, unitPrice: price, taxRate: tax }
      })

      updates.totalAmount = lineItems.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0)))
      }, 0)

      await prisma.$transaction(async (tx) => {
        await tx.pOLineItem.deleteMany({ where: { poId: id } })
        await tx.pOLineItem.createMany({
          data: lineItems.map((item, i) => ({
            poId:        id,
            lineNo:      i + 1,
            description: item.description,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            totalPrice:  item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0)),
            currency,
            taxRate:     item.taxRate ?? 0,
            glCode:      sanitiseString(item.glCode     ?? '', 50).trim()  || null,
            costCentre:  sanitiseString(item.costCentre ?? '', 100).trim() || null,
            notes:       sanitiseString(item.notes      ?? '', 500).trim() || null,
          })),
        })
        await tx.purchaseOrder.update({ where: { id }, data: updates })
        await writeAuditEvent(tx, {
          actorId:    session.userId!,
          orgId:      session.orgId!,
          action:     'UPDATE',
          objectType: 'PURCHASE_ORDER',
          objectId:   id,
          after:      { changedFields: Object.keys(body) },
        })
      }, { timeout: 15000 })
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.purchaseOrder.update({ where: { id }, data: updates })
        await writeAuditEvent(tx, {
          actorId:    session.userId!,
          orgId:      session.orgId!,
          action:     'UPDATE',
          objectType: 'PURCHASE_ORDER',
          objectId:   id,
          after:      { changedFields: Object.keys(body) },
        })
      })
    }

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: { lineItems: { orderBy: { lineNo: 'asc' } } },
    })

    return NextResponse.json({ purchaseOrder: updated })
  } catch (err) {
    return handleApiError(err, 'PUT /api/purchase-orders/[id]')
  }
}
