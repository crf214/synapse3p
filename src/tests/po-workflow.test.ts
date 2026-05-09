// src/tests/po-workflow.test.ts
// Tests for PO workflow assignment and approval step creation via the submit route.
// All Prisma, session, and email calls are mocked — no real DB or email required.

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
    approvalWorkflow: {
      findMany: vi.fn(),
    },
    orgMember: {
      findFirst: vi.fn(),
    },
    pOApproval: {
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
  sendPOSubmittedEmail:  mockSendPOSubmittedEmail,
  sendPODecisionEmail:   vi.fn().mockResolvedValue(undefined),
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

const WORKFLOW = {
  id:           'wf-1',
  orgId:        'org-1',
  name:         'Standard PO Approval',
  isActive:     true,
  thresholdMin: 0,
  thresholdMax: null,
  spendCategories: [],
  departments:   [],
  steps: [
    { step: 1, role: 'FINANCE_MANAGER', label: 'Finance Review' },
    { step: 2, role: 'CFO',             label: 'CFO Sign-off'   },
  ],
}

const FINANCE_MEMBER = {
  userId: 'user-fm-1',
  role:   'FINANCE_MANAGER',
  user:   { id: 'user-fm-1' },
}

const CFO_MEMBER = {
  userId: 'user-cfo-1',
  role:   'CFO',
  user:   { id: 'user-cfo-1' },
}

const APPROVER_USER = {
  id:    'user-fm-1',
  name:  'Finance Manager',
  email: 'fm@example.com',
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

describe('PO workflow assignment (submit route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.entityActivityLog.create.mockResolvedValue({})
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null)
    mockPrisma.user.findUnique.mockResolvedValue(APPROVER_USER)
  })

  // ── Happy path: workflow matched ──────────────────────────────────────────

  it('assigns workflow and creates approval steps on submit → PO becomes PENDING_APPROVAL', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([WORKFLOW])
    // orgMember.findFirst called once per workflow step
    mockPrisma.orgMember.findFirst
      .mockResolvedValueOnce(FINANCE_MEMBER)
      .mockResolvedValueOnce(CFO_MEMBER)
    mockPrisma.pOApproval.createMany.mockResolvedValue({ count: 2 })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO,
      status: 'PENDING_APPROVAL',
      approvalWorkflowId: 'wf-1',
      approvals: [
        { id: 'appr-1', step: 1, approverId: 'user-fm-1', status: 'PENDING' },
        { id: 'appr-2', step: 2, approverId: 'user-cfo-1', status: 'PENDING' },
      ],
      lineItems: [],
    })

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.purchaseOrder.status).toBe('PENDING_APPROVAL')

    // Approval records were created for both steps
    expect(mockPrisma.pOApproval.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ step: 1, approverId: 'user-fm-1', status: 'PENDING' }),
          expect.objectContaining({ step: 2, approverId: 'user-cfo-1', status: 'PENDING' }),
        ]),
      }),
    )

    // PO status was set to PENDING_APPROVAL
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_APPROVAL' }),
      }),
    )

    // Workflow was linked
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalWorkflowId: 'wf-1' }),
      }),
    )
  })

  it('notifies the first-step approver by email after submit', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([WORKFLOW])
    mockPrisma.orgMember.findFirst
      .mockResolvedValueOnce(FINANCE_MEMBER)
      .mockResolvedValueOnce(CFO_MEMBER)
    mockPrisma.pOApproval.createMany.mockResolvedValue({ count: 2 })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO, status: 'PENDING_APPROVAL', approvals: [], lineItems: [],
    })

    await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })

    expect(mockSendPOSubmittedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to:       APPROVER_USER.email,
        poNumber: DRAFT_PO.poNumber,
        poId:     'po-1',
      }),
    )
  })

  // ── Fallback: no workflow configured ──────────────────────────────────────

  it('falls back to first CONTROLLER/CFO member when no workflow matches', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([])  // no workflows
    mockPrisma.orgMember.findFirst
      .mockResolvedValueOnce(CFO_MEMBER)   // fallback member search
      .mockResolvedValueOnce(CFO_MEMBER)   // step member resolution
    mockPrisma.pOApproval.createMany.mockResolvedValue({ count: 1 })
    mockPrisma.purchaseOrder.update.mockResolvedValue({ ...DRAFT_PO, status: 'PENDING_APPROVAL' })
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      ...DRAFT_PO, status: 'PENDING_APPROVAL', approvals: [], lineItems: [],
    })

    const res = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)

    // Exactly one approval step was created (the fallback single-step)
    expect(mockPrisma.pOApproval.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ step: 1, status: 'PENDING' }),
        ]),
      }),
    )
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

  // ── Guard: missing approver role in org ────────────────────────────────────

  it('returns 400 when no member holds the required approver role', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(DRAFT_PO)
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([WORKFLOW])
    mockPrisma.orgMember.findFirst.mockResolvedValue(null)  // no member found

    const res  = await submitPO(makePost(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('no active user with role')
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
