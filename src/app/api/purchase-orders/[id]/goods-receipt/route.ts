// src/app/api/purchase-orders/[id]/goods-receipt/route.ts
// POST — record a goods/services receipt against a PO.
// Updates PO amountSpent and status (PARTIALLY_RECEIVED or FULLY_RECEIVED).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { Prisma } from '@prisma/client'

const GoodsReceiptLineItemSchema = z.object({
  poLineItemId:     z.string(),
  description:      z.string(),
  quantityOrdered:  z.number(),
  quantityReceived: z.number(),
  unitPrice:        z.number(),
})

const CreateGoodsReceiptSchema = z.object({
  receivedAt: z.string().min(1),
  status:     z.string().min(1),
  lineItems:  z.array(GoodsReceiptLineItemSchema).min(1),
  notes:      z.string().optional(),
})

const GR_ROLES    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])
const GR_ELIGIBLE = new Set(['APPROVED', 'PARTIALLY_RECEIVED'])

interface GRLineItem {
  poLineItemId:      string
  description:       string
  quantityOrdered:   number
  quantityReceived:  number
  unitPrice:         number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !GR_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: orgId },
      include: {
        lineItems: true,
        entity:   { select: { id: true } },
      },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (!GR_ELIGIBLE.has(po.status)) {
      throw new ValidationError(`Cannot record a goods receipt for a PO with status ${po.status}`)
    }

    const rawBody = await req.json()
    const parsedBody = CreateGoodsReceiptSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsedBody.error.issues },
        { status: 400 },
      )
    }
    const body = parsedBody.data

    if (!['PARTIAL', 'FULL', 'REJECTED'].includes(body.status)) {
      throw new ValidationError('status must be PARTIAL, FULL, or REJECTED')
    }

    // Validate received quantities
    for (const item of body.lineItems) {
      if (Number(item.quantityReceived) < 0) {
        throw new ValidationError(`quantityReceived cannot be negative for line item: ${item.description}`)
      }
    }

    // TODO: TWO_WAY match logic
    // Two-way matching validates the goods receipt against the PO line items to prevent
    // over-receiving and to compute per-line fulfilment status. Implementation should:
    //   1. Load all existing GoodsReceipt records for this PO to sum prior received quantities.
    //   2. For each submitted GR line item, look up the matching POLineItem by poLineItemId.
    //   3. Reject if quantityReceived > (lineItem.quantity - already_received_qty).
    //   4. Derive GR status automatically: if all PO lines are fully received → FULL,
    //      else if any line has quantityReceived > 0 → PARTIAL, else → REJECTED.
    //   5. Update PO status accordingly (FULLY_RECEIVED / PARTIALLY_RECEIVED).
    // Until this is implemented the caller-supplied status and quantities are trusted.

    // Calculate received value
    const receivedAmount = body.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantityReceived) * Number(item.unitPrice))
    }, 0)

    const newAmountSpent = po.amountSpent + receivedAmount

    // Determine new PO status
    let newPoStatus = po.status
    if (body.status === 'FULL') {
      newPoStatus = 'FULLY_RECEIVED'
    } else if (body.status === 'PARTIAL') {
      newPoStatus = 'PARTIALLY_RECEIVED'
    }
    // REJECTED keeps PO status unchanged (the GR is rejected, PO remains APPROVED)

    // Atomic: create GR + update PO spend/status together.
    const gr = await prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceipt.create({
        data: {
          poId:       id,
          orgId:      orgId,
          receivedAt: new Date(body.receivedAt),
          receivedBy: session.userId!,
          status:     body.status as never,
          lineItems:  body.lineItems as unknown as Prisma.InputJsonValue,
          notes:      sanitiseString(body.notes ?? '', 1000).trim() || null,
        },
      })

      if (body.status !== 'REJECTED') {
        await tx.purchaseOrder.update({
          where: { id },
          data:  {
            amountSpent: newAmountSpent,
            status:      newPoStatus as never,
          },
        })
      }

      return created
    }, { timeout: 15000 })

    // Audit log — non-critical follow-up write, outside transaction.
    await prisma.entityActivityLog.create({
      data: {
        entityId:    po.entityId,
        orgId:       orgId,
        activityType: 'PAYMENT' as never,
        title:       `Goods receipt recorded (${body.status}): ${po.poNumber}`,
        description: `${body.lineItems.length} line item(s) · received value ${receivedAmount.toFixed(2)} ${po.currency}`,
        referenceId:   gr.id,
        referenceType: 'GoodsReceipt',
        performedBy:   session.userId,
      },
    }).catch(e => console.error('[goods-receipt] audit log failed:', e))

    return NextResponse.json({ goodsReceipt: gr }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/goods-receipt')
  }
}
