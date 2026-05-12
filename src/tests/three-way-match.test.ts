// src/tests/three-way-match.test.ts
// Unit tests for three-way match logic.
// Prisma is fully mocked — no real DB required.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories run before any imports
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    invoice: {
      findUnique: vi.fn(),
    },
    purchaseOrder: {
      findUnique: vi.fn(),
    },
    goodsReceipt: {
      findMany: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { performThreeWayMatch } from '@/lib/matching/three-way-match'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INVOICE = {
  id:       'inv-1',
  entityId: 'entity-1',
  amount:   4000,
}

const PO_APPROVED = {
  id:                  'po-1',
  poNumber:            'PO-2026-000001',
  status:              'APPROVED',
  entityId:            'entity-1',
  totalAmount:         10000,
  amountSpent:         0,
  requiresGoodsReceipt: true,
  lineItems: [
    { id: 'li-1', quantity: 10 },
    { id: 'li-2', quantity: 5 },
  ],
}

const GR_FULL = {
  id:     'gr-1',
  status: 'FULL',
  lineItems: [
    { poLineItemId: 'li-1', quantityOrdered: 10, quantityReceived: 10, unitPrice: 100 },
    { poLineItemId: 'li-2', quantityOrdered: 5,  quantityReceived: 5,  unitPrice: 200 },
  ],
}

const GR_PARTIAL = {
  id:     'gr-2',
  status: 'PARTIAL',
  lineItems: [
    { poLineItemId: 'li-1', quantityOrdered: 10, quantityReceived: 6, unitPrice: 100 },
    { poLineItemId: 'li-2', quantityOrdered: 5,  quantityReceived: 2, unitPrice: 200 },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupPrisma(
  invoice:       typeof INVOICE | null,
  po:            typeof PO_APPROVED | null,
  goodsReceipts: typeof GR_FULL[],
) {
  mockPrisma.invoice.findUnique.mockResolvedValue(invoice)
  mockPrisma.purchaseOrder.findUnique.mockResolvedValue(po)
  mockPrisma.goodsReceipt.findMany.mockResolvedValue(goodsReceipts)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performThreeWayMatch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('passes when PO approved, entity matches, amount within budget, and GR covers all quantities', async () => {
    setupPrisma(INVOICE, PO_APPROVED, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(true)
    expect(result.matchType).toBe('THREE_WAY')
    expect(result.checks.poExists).toBe(true)
    expect(result.checks.poApproved).toBe(true)
    expect(result.checks.entityMatch).toBe(true)
    expect(result.checks.amountWithinBudget).toBe(true)
    expect(result.checks.grExists).toBe(true)
    expect(result.checks.quantityCovered).toBe(true)
    expect(result.grCount).toBe(1)
    expect(result.po?.remainingBudget).toBe(10000)
  })

  it('passes when multiple partial GRs together cover all quantities', async () => {
    // Two partial GRs, each covering part of each line item
    const gr1 = { ...GR_PARTIAL }
    const gr2 = {
      id:     'gr-3',
      status: 'PARTIAL',
      lineItems: [
        { poLineItemId: 'li-1', quantityOrdered: 10, quantityReceived: 4, unitPrice: 100 },
        { poLineItemId: 'li-2', quantityOrdered: 5,  quantityReceived: 3, unitPrice: 200 },
      ],
    }
    setupPrisma(INVOICE, PO_APPROVED, [gr1, gr2])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(true)
    expect(result.grCount).toBe(2)
    expect(result.checks.quantityCovered).toBe(true)
  })

  // ── Invoice not found ───────────────────────────────────────────────────────

  it('fails with failureReason when invoice does not exist', async () => {
    setupPrisma(null, PO_APPROVED, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-missing', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.failureReason).toMatch(/invoice not found/i)
    expect(result.checks.poExists).toBe(false)
  })

  // ── PO not found ────────────────────────────────────────────────────────────

  it('fails when PO does not exist', async () => {
    setupPrisma(INVOICE, null, [])

    const result = await performThreeWayMatch('po-missing', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.poExists).toBe(false)
    expect(result.failureReason).toMatch(/purchase order not found/i)
  })

  // ── PO not approved ─────────────────────────────────────────────────────────

  it('fails when PO status is DRAFT', async () => {
    setupPrisma(INVOICE, { ...PO_APPROVED, status: 'DRAFT' }, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.poExists).toBe(true)
    expect(result.checks.poApproved).toBe(false)
    expect(result.failureReason).toMatch(/DRAFT/i)
  })

  // ── Entity mismatch ─────────────────────────────────────────────────────────

  it('fails when invoice entity does not match PO entity', async () => {
    setupPrisma({ ...INVOICE, entityId: 'entity-OTHER' }, PO_APPROVED, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.entityMatch).toBe(false)
    expect(result.failureReason).toMatch(/entity/i)
  })

  // ── Amount exceeds remaining budget ─────────────────────────────────────────

  it('fails when invoice amount exceeds PO remaining budget', async () => {
    const spentPO = { ...PO_APPROVED, amountSpent: 7000 }   // only 3000 remaining
    setupPrisma({ ...INVOICE, amount: 4000 }, spentPO, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.amountWithinBudget).toBe(false)
    expect(result.failureReason).toMatch(/exceeds/i)
    expect(result.po?.remainingBudget).toBe(3000)
  })

  it('passes at the exact remaining budget boundary', async () => {
    const exactPO = { ...PO_APPROVED, amountSpent: 6000 }   // 4000 remaining = invoice amount
    setupPrisma({ ...INVOICE, amount: 4000 }, exactPO, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(true)
    expect(result.checks.amountWithinBudget).toBe(true)
  })

  // ── No goods receipts ──────────────────────────────────────────────────────

  it('fails when no non-rejected GoodsReceipts exist', async () => {
    setupPrisma(INVOICE, PO_APPROVED, [])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.grExists).toBe(false)
    expect(result.failureReason).toMatch(/no goods receipts/i)
  })

  // ── Quantity not fully covered ──────────────────────────────────────────────

  it('fails when GR quantities do not cover all PO line items', async () => {
    setupPrisma(INVOICE, PO_APPROVED, [GR_PARTIAL])  // only partial coverage

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(false)
    expect(result.checks.grExists).toBe(true)
    expect(result.checks.quantityCovered).toBe(false)
    expect(result.failureReason).toMatch(/quantities/i)
  })

  // ── No PO line items ────────────────────────────────────────────────────────

  it('passes quantity check when PO has no line items (GR presence is sufficient)', async () => {
    const poNoLines = { ...PO_APPROVED, lineItems: [] }
    setupPrisma(INVOICE, poNoLines, [GR_FULL])

    const result = await performThreeWayMatch('po-1', 'inv-1', mockPrisma as never)

    expect(result.passed).toBe(true)
    expect(result.checks.quantityCovered).toBe(true)
  })
})
