// src/tests/payment-lifecycle.test.ts
// Full payment instruction lifecycle with mocked Prisma.
// Tests: create → submit → approve → reconcile; cancel guards; amendment creation + conflict.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — make mocks available to vi.mock factories
// ---------------------------------------------------------------------------

const { mockPrisma, mockGetSession } = vi.hoisted(() => {
  const mockPrisma = {
    invoice: {
      findFirst: vi.fn(),
    },
    paymentInstruction: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      count:      vi.fn(),
    },
    paymentInstructionVersion: {
      create: vi.fn(),
    },
    paymentInstructionAmendment: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      count:      vi.fn(),
    },
    entityBankAccount: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
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

  return { mockPrisma, mockGetSession }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST as createPI }    from '@/app/api/payment-instructions/route'
import { POST as submitPI }    from '@/app/api/payment-instructions/[id]/submit/route'
import { POST as approvePI }   from '@/app/api/payment-instructions/[id]/approve/route'
import { POST as reconcilePI } from '@/app/api/payment-instructions/[id]/reconcile/route'
import { POST as cancelPI }    from '@/app/api/payment-instructions/[id]/cancel/route'
import { POST as createAmend } from '@/app/api/payment-instructions/[id]/amendments/route'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INVOICE = {
  id:        'inv-1',
  orgId:     'org-1',
  entityId:  'entity-1',
  amount:    1000,
  currency:  'USD',
  status:    'APPROVED',
  invoiceNo: 'INV-001',
}

const BANK_ACCOUNT = {
  id:       'ba-1',
  currency: 'USD',
}

const BASE_PI = {
  id:             'pi-1',
  orgId:          'org-1',
  invoiceId:      'inv-1',
  entityId:       'entity-1',
  bankAccountId:  'ba-1',
  amount:         1000,
  currency:       'USD',
  status:         'DRAFT',
  currentVersion: 1,
  createdBy:      'user-ap-1',
  approvedBy:     null,
  approvedAt:     null,
  dueDate:        null,
  notes:          null,
  glCode:         null,
  costCentre:     null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJson(url: string, body: Record<string, unknown>, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function makeEmpty(url: string): NextRequest {
  return new NextRequest(url, { method: 'POST' })
}

function setupTransaction() {
  mockPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
  )
}

function cfoSession() {
  return {
    userId: 'user-cfo-1',   // different from creator (four-eyes)
    orgId:  'org-1',
    role:   'CFO',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payment instruction lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.paymentInstructionVersion.create.mockResolvedValue({})
  })

  // ── 1. Create from approved invoice → 201 ─────────────────────────────────

  it('creates a payment instruction from an approved invoice → 201', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(INVOICE)
    mockPrisma.paymentInstruction.findFirst.mockResolvedValue(null)   // no existing PI
    mockPrisma.entityBankAccount.findFirst.mockResolvedValue(BANK_ACCOUNT)
    mockPrisma.paymentInstruction.create.mockResolvedValue(BASE_PI)

    const res = await createPI(makeJson('http://localhost/api/payment-instructions', {
      invoiceId:     'inv-1',
      bankAccountId: 'ba-1',
    }))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.status).toBe('DRAFT')
  })

  // ── 2. Submit → PENDING_APPROVAL ──────────────────────────────────────────

  it('submit transitions DRAFT → PENDING_APPROVAL', async () => {
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(BASE_PI)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...BASE_PI, status: 'PENDING_APPROVAL' })

    const res = await submitPI(makeEmpty('http://localhost/api/payment-instructions/pi-1/submit'), {
      params: Promise.resolve({ id: 'pi-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockPrisma.paymentInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }),
    )
  })

  // ── 3. Approve → APPROVED ─────────────────────────────────────────────────

  it('approve transitions PENDING_APPROVAL → APPROVED', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    const pendingPI = { ...BASE_PI, status: 'PENDING_APPROVAL', createdBy: 'user-ap-1' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(pendingPI)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...pendingPI, status: 'APPROVED' })

    const res = await approvePI(
      makeJson('http://localhost/api/payment-instructions/pi-1/approve', { decision: 'APPROVED' }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('APPROVED')
    expect(mockPrisma.paymentInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
    )
  })

  // ── 4. Reconcile → RECONCILED ─────────────────────────────────────────────

  it('reconcile transitions CONFIRMED → RECONCILED', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    const confirmedPI = { ...BASE_PI, status: 'CONFIRMED' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(confirmedPI)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...confirmedPI, status: 'RECONCILED' })

    const res = await reconcilePI(
      makeEmpty('http://localhost/api/payment-instructions/pi-1/reconcile'),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('RECONCILED')
    expect(mockPrisma.paymentInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RECONCILED' }) }),
    )
  })

  it('reconcile also works from APPROVED (direct reconciliation without ERP)', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    const approvedPI = { ...BASE_PI, status: 'APPROVED' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(approvedPI)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...approvedPI, status: 'RECONCILED' })

    const res = await reconcilePI(
      makeEmpty('http://localhost/api/payment-instructions/pi-1/reconcile'),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(200)
  })

  // ── 5. Cancel PENDING → CANCELLED ────────────────────────────────────────

  it('cancels a PENDING_APPROVAL instruction → CANCELLED', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    const pendingPI = { ...BASE_PI, status: 'PENDING_APPROVAL' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(pendingPI)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...pendingPI, status: 'CANCELLED' })

    const res = await cancelPI(
      makeJson('http://localhost/api/payment-instructions/pi-1/cancel', {
        reason: 'No longer needed',
      }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(200)
    expect(mockPrisma.paymentInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    )
  })

  // ── 6. Cancel APPROVED → 400 ──────────────────────────────────────────────

  it('returns 400 when cancelling an APPROVED instruction', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    const approvedPI = { ...BASE_PI, status: 'APPROVED' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(approvedPI)

    const res = await cancelPI(
      makeJson('http://localhost/api/payment-instructions/pi-1/cancel', {
        reason: 'Changed my mind',
      }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('Cannot cancel a APPROVED')
  })

  // ── 7. Create amendment on APPROVED → 201 with changes Json ───────────────

  it('creates an amendment on APPROVED instruction → 201 with changes Json', async () => {
    const approvedPI = { ...BASE_PI, status: 'APPROVED' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(approvedPI)
    mockPrisma.paymentInstructionAmendment.findFirst.mockResolvedValue(null)  // no existing
    const createdAmendment = {
      id:                   'amend-1',
      paymentInstructionId: 'pi-1',
      changes:              { amount: { from: 1000, to: 1200 } },
      status:               'PENDING',
      requestedBy:          'user-ap-1',
      requestedAt:          new Date(),
      notes:                null,
    }
    mockPrisma.paymentInstructionAmendment.create.mockResolvedValue(createdAmendment)
    mockPrisma.paymentInstruction.update.mockResolvedValue({ ...approvedPI, status: 'AMENDMENT_PENDING' })

    const res = await createAmend(
      makeJson('http://localhost/api/payment-instructions/pi-1/amendments', {
        changes: { amount: { from: 1000, to: 1200 } },
      }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.amendment.changes).toEqual({ amount: { from: 1000, to: 1200 } })
    expect(json.amendment.status).toBe('PENDING')
  })

  // ── 8. Duplicate PENDING amendment → 409 ─────────────────────────────────

  it('returns 409 when a PENDING amendment already exists', async () => {
    const approvedPI = { ...BASE_PI, status: 'APPROVED' }
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(approvedPI)
    // Simulate existing PENDING amendment
    mockPrisma.paymentInstructionAmendment.findFirst.mockResolvedValue({
      id:     'amend-existing',
      status: 'PENDING',
    })

    const res = await createAmend(
      makeJson('http://localhost/api/payment-instructions/pi-1/amendments', {
        changes: { amount: { from: 1000, to: 1500 } },
      }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.message).toContain('pending amendment already exists')
  })

  // ── Additional guards ──────────────────────────────────────────────────────

  it('returns 400 when trying to amend a DRAFT instruction', async () => {
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(BASE_PI)  // DRAFT

    const res = await createAmend(
      makeJson('http://localhost/api/payment-instructions/pi-1/amendments', {
        changes: { amount: { from: 1000, to: 1200 } },
      }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when reconciling a DRAFT instruction', async () => {
    mockGetSession.mockResolvedValueOnce(cfoSession())
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(BASE_PI)  // DRAFT

    const res = await reconcilePI(
      makeEmpty('http://localhost/api/payment-instructions/pi-1/reconcile'),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(400)
  })

  it('returns 403 (four-eyes) when creator tries to approve own PI', async () => {
    // Creator is user-ap-1; session is also user-ap-1
    const pendingPI = { ...BASE_PI, status: 'PENDING_APPROVAL', createdBy: 'user-ap-1' }
    mockGetSession.mockResolvedValueOnce({ userId: 'user-ap-1', orgId: 'org-1', role: 'CFO' })
    mockPrisma.paymentInstruction.findUnique.mockResolvedValue(pendingPI)

    const res = await approvePI(
      makeJson('http://localhost/api/payment-instructions/pi-1/approve', { decision: 'APPROVED' }),
      { params: Promise.resolve({ id: 'pi-1' }) },
    )

    expect(res.status).toBe(403)
  })
})
