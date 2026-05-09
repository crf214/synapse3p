// src/app/api/purchase-orders/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { Prisma } from '@prisma/client'
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

const CreatePurchaseOrderSchema = z.object({
  entityId:              z.string().min(1),
  title:                 z.string().min(1),
  description:           z.string().optional(),
  type:                  z.string().optional(),
  currency:              z.string().optional(),
  spendCategory:         z.string().optional(),
  department:            z.string().optional(),
  costCentre:            z.string().optional(),
  glCode:                z.string().optional(),
  validFrom:             z.string().optional(),
  validTo:               z.string().optional(),
  requiresGoodsReceipt:  z.boolean().optional(),
  requiresContract:      z.boolean().optional(),
  notes:                 z.string().optional(),
  contractId:            z.string().optional(),
  lineItems:             z.array(LineItemSchema).min(1),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const VALID_STATUSES = new Set([
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED',
  'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'INVOICED', 'CLOSED', 'CANCELLED',
])

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

// ---------------------------------------------------------------------------
// PO number generator — PO-YYYY-NNNNNN (org-scoped sequence)
// ---------------------------------------------------------------------------

async function generatePoNumber(orgId: string): Promise<string> {
  const year  = new Date().getFullYear()
  const count = await prisma.purchaseOrder.count({ where: { orgId } })
  return `PO-${year}-${String(count + 1).padStart(6, '0')}`
}

// ---------------------------------------------------------------------------
// GET — list purchase orders
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const sp       = req.nextUrl.searchParams
    const page     = Math.max(1, parseInt(sp.get('page')  ?? '1',  10) || 1)
    const limit    = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const status   = sanitiseString(sp.get('status')   ?? '', 50).trim() || null
    const entityId = sanitiseString(sp.get('entityId') ?? '', 50).trim() || null
    const dateFrom = sp.get('dateFrom') || null
    const dateTo   = sp.get('dateTo')   || null

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: { message: 'Invalid status filter', code: 'VALIDATION_ERROR' } }, { status: 400 })
    }

    const where: Prisma.PurchaseOrderWhereInput = {
      orgId: session.orgId,
      ...(status   ? { status:   status   as never } : {}),
      ...(entityId ? { entityId }                    : {}),
      ...(dateFrom || dateTo ? {
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
        },
      } : {}),
    }

    const [total, pos] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          entity: { select: { id: true, name: true, slug: true } },
          approvals: {
            where:   { status: 'PENDING' },
            orderBy: { step: 'asc' },
            take:    1,
            select:  { step: true, approverId: true, status: true },
          },
        },
      }),
    ])

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      purchaseOrders: pos,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/purchase-orders')
  }
}

// ---------------------------------------------------------------------------
// POST — create purchase order (DRAFT)
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreatePurchaseOrderSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const entityId    = sanitiseString(body.entityId ?? '',    50).trim()
    const title       = sanitiseString(body.title ?? '',       200).trim()
    const description = sanitiseString(body.description ?? '', 1000).trim() || null
    const currency    = sanitiseString(body.currency ?? 'USD', 10).trim().toUpperCase()
    const type        = (body.type ?? 'FIXED') as 'FIXED' | 'OPEN' | 'BLANKET'

    // Validate entity belongs to org
    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
      select: { id: true, name: true },
    })
    if (!entity) throw new ValidationError('Entity not found or does not belong to your organisation')

    // Validate line items
    const lineItems: LineItemInput[] = body.lineItems.map((item, i) => {
      const desc  = sanitiseString(item.description ?? '', 500).trim()
      const qty   = Number(item.quantity)
      const price = Number(item.unitPrice)
      const tax   = Number(item.taxRate ?? 0)
      if (!desc)              throw new ValidationError(`Line item ${i + 1}: description is required`)
      if (qty  <= 0)          throw new ValidationError(`Line item ${i + 1}: quantity must be positive`)
      if (price < 0)          throw new ValidationError(`Line item ${i + 1}: unit price cannot be negative`)
      if (tax  < 0 || tax > 1) throw new ValidationError(`Line item ${i + 1}: taxRate must be between 0 and 1`)
      return { ...item, description: desc, quantity: qty, unitPrice: price, taxRate: tax }
    })

    // Calculate totals
    const totalAmount = lineItems.reduce((sum, item) => {
      return sum + (item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0)))
    }, 0)

    const poNumber = await generatePoNumber(session.orgId)

    const po = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          orgId:               session.orgId!,
          poNumber,
          title,
          description,
          type:                type as never,
          track:               'FULL_PO' as never,
          status:              'DRAFT' as never,
          entityId,
          totalAmount,
          currency,
          spendCategory:       sanitiseString(body.spendCategory ?? '', 100).trim() || null,
          department:          sanitiseString(body.department ?? '',    100).trim() || null,
          costCentre:          sanitiseString(body.costCentre ?? '',    100).trim() || null,
          glCode:              sanitiseString(body.glCode ?? '',         50).trim() || null,
          requestedBy:         session.userId!,
          validFrom:           body.validFrom ? new Date(body.validFrom) : null,
          validTo:             body.validTo   ? new Date(body.validTo)   : null,
          requiresGoodsReceipt: body.requiresGoodsReceipt ?? false,
          requiresContract:     body.requiresContract    ?? false,
          notes:               sanitiseString(body.notes ?? '', 2000).trim() || null,
        },
      })

      await tx.pOLineItem.createMany({
        data: lineItems.map((item, i) => ({
          poId:        created.id,
          lineNo:      i + 1,
          description: item.description,
          quantity:    item.quantity,
          unitPrice:   item.unitPrice,
          totalPrice:  item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0)),
          currency,
          taxRate:     item.taxRate ?? 0,
          glCode:      sanitiseString(item.glCode     ?? '', 50).trim() || null,
          costCentre:  sanitiseString(item.costCentre ?? '', 100).trim() || null,
          notes:       sanitiseString(item.notes      ?? '', 500).trim() || null,
        })),
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'CREATE',
        objectType: 'PURCHASE_ORDER',
        objectId:   created.id,
      })

      return created
    }, { timeout: 15000 })

    return NextResponse.json({ purchaseOrder: { ...po, entity } }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders')
  }
}
