// src/tests/po-workflow.test.ts
// Tests for PO submission and approval step creation via the submit route.
// All Prisma, session, and email calls are mocked — no real DB or email required.
//
// Note: Phase 3A removed legacy ApprovalWorkflow lookup.
//       The submit route now falls back directly to the first CONTROLLER/CFO member.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories need these before imports are resolved
// ---------------------------------------------------------------------------

const { mockPrisma, mockGetSession, mockSendPOSubmittedEmail } = vi.hoisted(() => {
  const mockPrisma = {
    purchaseOrder: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      count:      vi.fn(),
    },
    orgMember: {
      findFirst: vi.fn(),
    },
    pOApproval: {
      create:     vi.fn(),
      createMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
    },
    entityActivityLog: {
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  const mockGetSession = vi.fn().mockResolvedValue({
    userId: 'user-ap-1',
    orgId:  'org-1',
    role:   'AP_CLERK',
    name:   'AP Clerk',
    email:  'ap@example.com',
  })

  const mockSendPOSubmittedEmail = vi.fn().mockResolvedValue(undefined)

  return { mockPrisma, mockGetSession, mockSendPOSubmittedEmail }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/resend',  () => ({
  sendPOSubmittedEmail:     mockSendPOSubmittedEmail,
  sendPODecisionEmail:      vi.fn().mockResolvedValue(undefined),
  sendInvoiceDecisionEmail: vi.fn().mockResolvedValue(undefined),
  sendInvoiceReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendInvoiceAssignedEmail: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST as submitPO } from '@/app/api/purchase-orders/[id]/submit/route'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DRAFT_PO = {
  id:           'po-1',
  orgId:        'org-1',
  poNumber:     'PO-2026-000001',
  title:        'Software licences',
  status:       'DRAFT',
  totalAmount:  5000,
  currency:     'USD',
  spendCategory: null,
  department:   null,
  entityId:     'entity-1',
  entity:       { id: 'entity-1', name: 'Optimum LLC' },
  requestedBy:  'user-ap-1',
  lineItems:    [{ id: 'li-1' }],  // at least one item
}

const CFO_MEMBER = {
  userId: 'user-cfo-1',
  role:   'CFO',
  user:   { id: 'user-cfo-1' },
}

const APPROVER_USER = {
  id:    'user-cfo-1',
  name:  'CFO User',
  email: 'cfo@example.com',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePost(): NextRequest {
  return new NextRequest('http://localhost/api/purchase-orders/po-1/submit', {
    method: 'POST',
  })
}

function setupTransaction() {
  mockPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PO submission (submit route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.entityActivityLog.create.mockResolvedValue({})
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null)
    mockPrisma.user.findUnique.mockResolvedValue(APPROVER_USER)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('creates approval step and sets PO to PENDING_APPROVAL', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.orgMember.findFirst.mockResolvedValue(CFO_MEMBER)
    mockPrisma.pOApproval.create.mockResolvedValue({ id: 'appr-1' })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO,
      status: 'PENDING_APPROVAL',
      approvals: [{ id: 'appr-1', step: 1, approverId: 'user-cfo-1', status: 'PENDING' }],
      lineItems: [],
    })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.purchaseOrder.status).toBe('PENDING_APPROVAL')

    // PO status was set to PENDING_APPROVAL
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_APPROVAL' }),
      }),
    )
  })

  it('moves PO to PENDING_APPROVAL (email now handled by workflow engine NOTIFICATION step)', async () => {
    // The submit route no longer directly sends an email — notifications are
    // dispatched via WorkflowEngine NOTIFICATION step instances. This test
    // verifies the PO status transition only.
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.orgMember.findFirst.mockResolvedValue(CFO_MEMBER)
    mockPrisma.pOApproval.create.mockResolvedValue({ id: 'appr-1' })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO, status: 'PENDING_APPROVAL', approvals: [], lineItems: [],
    })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.purchaseOrder.status).toBe('PENDING_APPROVAL')
  })

  // ── No CONTROLLER/CFO in org ──────────────────────────────────────────────
  // The submit route no longer rejects when no approver is found — the workflow
  // engine handles assignment and will set the step to WAITING if none is
  // available. Submit should still succeed and set PO to PENDING_APPROVAL.

  it('returns 200 and PENDING_APPROVAL even when no CONTROLLER or CFO member exists', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.orgMember.findFirst.mockResolvedValue(null)
    mockPrisma.pOApproval.create.mockResolvedValue({ id: 'appr-1' })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO, status: 'PENDING_APPROVAL', approvals: [], lineItems: [],
    })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.purchaseOrder.status).toBe('PENDING_APPROVAL')
  })

  // ── Guard: non-DRAFT PO ────────────────────────────────────────────────────

  it('returns 400 when PO is not DRAFT', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('Only DRAFT')
  })

  // ── Guard: PO with no line items ───────────────────────────────────────────

  it('returns 400 when PO has no line items', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({ ...DRAFT_PO, lineItems: [] })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('no line items')
  })

  // ── Guard: PO not found ─────────────────────────────────────────────────────

  it('returns 404 when PO does not exist', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null)

    const res = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-missing' }) })
    expect(res.status).toBe(404)
  })

  // ── Auth guard ──────────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated request', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: null, orgId: null, role: null })

    const res = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })
})
