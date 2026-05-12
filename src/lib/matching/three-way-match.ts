// src/lib/matching/three-way-match.ts
// Three-way match: Purchase Order → Goods Receipt → Invoice validation

import type { PrismaClient } from '@prisma/client'

interface GrLineItem {
  poLineItemId:     string
  description?:     string
  quantityOrdered:  number
  quantityReceived: number
  unitPrice:        number
}

export interface MatchChecks {
  poExists:           boolean
  poApproved:         boolean
  entityMatch:        boolean
  amountWithinBudget: boolean
  grExists:           boolean
  quantityCovered:    boolean
}

export interface ThreeWayMatchResult {
  passed:          boolean
  matchType:       'THREE_WAY' | 'NONE'
  checks:          MatchChecks
  po?:             { id: string; poNumber: string; totalAmount: number; amountSpent: number; remainingBudget: number }
  grCount:         number
  failureReason?:  string
}

const EMPTY_CHECKS: MatchChecks = {
  poExists:           false,
  poApproved:         false,
  entityMatch:        false,
  amountWithinBudget: false,
  grExists:           false,
  quantityCovered:    false,
}

export async function performThreeWayMatch(
  purchaseOrderId: string,
  invoiceId:       string,
  prisma:          PrismaClient,
): Promise<ThreeWayMatchResult> {
  const invoice = await prisma.invoice.findUnique({
    where:  { id: invoiceId },
    select: { id: true, entityId: true, amount: true },
  })
  if (!invoice) {
    return { passed: false, matchType: 'NONE', checks: { ...EMPTY_CHECKS }, grCount: 0, failureReason: 'Invoice not found' }
  }

  const po = await prisma.purchaseOrder.findUnique({
    where:   { id: purchaseOrderId },
    include: { lineItems: { select: { id: true, quantity: true } } },
  })

  const checks: MatchChecks = { ...EMPTY_CHECKS }

  if (!po) {
    return { passed: false, matchType: 'NONE', checks, grCount: 0, failureReason: 'Purchase order not found' }
  }
  checks.poExists = true

  if (po.status !== 'APPROVED') {
    return { passed: false, matchType: 'NONE', checks, grCount: 0, failureReason: `PO status is ${po.status} — must be APPROVED` }
  }
  checks.poApproved = true

  if (po.entityId !== invoice.entityId) {
    return { passed: false, matchType: 'NONE', checks, grCount: 0, failureReason: 'Invoice entity does not match PO entity' }
  }
  checks.entityMatch = true

  const remainingBudget = po.totalAmount - po.amountSpent
  const poSummary = {
    id:              po.id,
    poNumber:        po.poNumber,
    totalAmount:     po.totalAmount,
    amountSpent:     po.amountSpent,
    remainingBudget,
  }

  // Allow a 0.5-cent float tolerance
  if (invoice.amount > remainingBudget + 0.005) {
    return {
      passed:        false,
      matchType:     'NONE',
      checks,
      po:            poSummary,
      grCount:       0,
      failureReason: `Invoice amount ${invoice.amount.toFixed(2)} exceeds PO remaining budget ${remainingBudget.toFixed(2)}`,
    }
  }
  checks.amountWithinBudget = true

  // Fetch non-rejected GoodsReceipts
  const goodsReceipts = await prisma.goodsReceipt.findMany({
    where:  { poId: purchaseOrderId, status: { not: 'REJECTED' } },
    select: { id: true, status: true, lineItems: true },
  })

  if (goodsReceipts.length === 0) {
    return {
      passed:        false,
      matchType:     'NONE',
      checks,
      po:            poSummary,
      grCount:       0,
      failureReason: 'No goods receipts found for this PO',
    }
  }
  checks.grExists = true

  // Quantity coverage per PO line item
  const poLineItems = po.lineItems
  if (poLineItems.length === 0) {
    // No PO line items to validate against — presence of GR is sufficient
    checks.quantityCovered = true
  } else {
    const allCovered = poLineItems.every(li => {
      const received = goodsReceipts.reduce((sum, gr) => {
        const grLines = (gr.lineItems ?? []) as unknown as GrLineItem[]
        const line = grLines.find(l => l.poLineItemId === li.id)
        return sum + (line?.quantityReceived ?? 0)
      }, 0)
      // Allow 0.005 float tolerance
      return received >= li.quantity - 0.005
    })
    checks.quantityCovered = allCovered
  }

  if (!checks.quantityCovered) {
    return {
      passed:        false,
      matchType:     'NONE',
      checks,
      po:            poSummary,
      grCount:       goodsReceipts.length,
      failureReason: 'Received quantities do not fully cover all PO line items',
    }
  }

  return {
    passed:    true,
    matchType: 'THREE_WAY',
    checks,
    po:        poSummary,
    grCount:   goodsReceipts.length,
  }
}
