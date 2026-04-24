// src/app/api/purchase-orders/[id]/goods-receipt/route.ts
// POST — record a goods/services receipt against a PO.
// Updates PO amountSpent and status (PARTIALLY_RECEIVED or FULLY_RECEIVED).

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { Prisma } from '@prisma/client'

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
    if (!session.role || !GR_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: session.orgId },
      include: {
        lineItems: true,
        entity:   { select: { id: true } },
      },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (!GR_ELIGIBLE.has(po.status)) {
      throw new ValidationError(`Cannot record a goods receipt for a PO with status ${po.status}`)
    }

    const body = await req.json() as {
      receivedAt: string
      status:     'PARTIAL' | 'FULL' | 'REJECTED'
      lineItems:  GRLineItem[]
      notes?:     string
    }

    if (!body.receivedAt) throw new ValidationError('receivedAt is required')
    if (!['PARTIAL', 'FULL', 'REJECTED'].includes(body.status)) {
      throw new ValidationError('status must be PARTIAL, FULL, or REJECTED')
    }
    if (!body.lineItems?.length) throw new ValidationError('At least one line item is required')

    // Validate received quantities
    for (const item of body.lineItems) {
      if (Number(item.quantityReceived) < 0) {
        throw new ValidationError(`quantityReceived cannot be negative for line item: ${item.description}`)
      }
    }

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

    const gr = await prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceipt.create({
        data: {
          poId:       id,
          orgId:      session.orgId!,
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

      await tx.entityActivityLog.create({
        data: {
          entityId:    po.entityId,
          orgId:       session.orgId!,
          activityType: 'PAYMENT' as never,
          title:       `Goods receipt recorded (${body.status}): ${po.poNumber}`,
          description: `${body.lineItems.length} line item(s) · received value ${receivedAmount.toFixed(2)} ${po.currency}`,
          referenceId:   created.id,
          referenceType: 'GoodsReceipt',
          performedBy:   session.userId,
        },
      })

      return created
    })

    return NextResponse.json({ goodsReceipt: gr }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/goods-receipt')
  }
}
