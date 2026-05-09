// src/tests/invoice-duplicate.test.ts
// Integration tests for invoice duplicate-detection and override flow.
// All Prisma and session calls are mocked — no real DB connection required.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockPrisma, mockGetSession } = vi.hoisted(() => {
  const mockPrisma = {
    invoice: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    invoiceDuplicateFlag: {
      findFirst: vi.fn(),
      update:    vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  const mockGetSession = vi.fn().mockResolvedValue({
    userId: 'user-controller-1',
    orgId:  'org-1',
    role:   'CONTROLLER',
  })

  return { mockPrisma, mockGetSession }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))

// invoice-pipeline also imports these; mock them so they don't fail at import
vi.mock('@/lib/invoice-ai', () => ({
  extractFromPdf:           vi.fn(),
  extractFromText:          vi.fn(),
  persistExtractionFields:  vi.fn(),
}))
vi.mock('@/lib/resend', () => ({
  sendInvoiceReminderEmail: vi.fn(),
  sendInvoiceAssignedEmail: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkPreExtractionDuplicates } from '@/lib/invoice-pipeline'
import { POST } from '@/app/api/invoices/[id]/override-duplicate/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INVOICE = {
  id:        'invoice-dup-1',
  orgId:     'org-1',
  status:    'DUPLICATE',
  invoiceNo: '07839-385935-03-5',
  amount:    227.50,
  currency:  'USD',
}

const FLAG = {
  id:        'flag-1',
  invoiceId: 'invoice-dup-1',
  status:    'QUARANTINED',
}

function makeRequest(invoiceId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/invoices/${invoiceId}/override-duplicate`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    },
  )
}

// ---------------------------------------------------------------------------
// Part A: Duplicate detection — checkPreExtractionDuplicates
// ---------------------------------------------------------------------------

describe('checkPreExtractionDuplicates', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when no duplicates exist', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null)

    const result = await checkPreExtractionDuplicates({
      orgId: 'org-1', emailMessageId: 'unique-msg-abc', pdfFingerprint: null,
    })

    expect(result).toBeNull()
  })

  it('detects duplicate by emailMessageId and returns its invoice id', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'existing-99' })

    const result = await checkPreExtractionDuplicates({
      orgId: 'org-1', emailMessageId: 'dup-msg-id', pdfFingerprint: null,
    })

    expect(result).toBe('existing-99')
    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailMessageId: 'dup-msg-id' }),
      }),
    )
  })

  it('detects duplicate by pdfFingerprint when emailMessageId is null', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'existing-88' })

    const result = await checkPreExtractionDuplicates({
      orgId: 'org-1', emailMessageId: null, pdfFingerprint: 'sha256fingerprint',
    })

    expect(result).toBe('existing-88')
    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pdfFingerprint: 'sha256fingerprint' }),
      }),
    )
  })

  it('skips DB query entirely when both identifiers are null', async () => {
    const result = await checkPreExtractionDuplicates({
      orgId: 'org-1', emailMessageId: null, pdfFingerprint: null,
    })

    expect(result).toBeNull()
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled()
  })

  it('excludes already-DUPLICATE invoices from the match (no re-flagging)', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null)

    await checkPreExtractionDuplicates({
      orgId: 'org-1', emailMessageId: 'some-id', pdfFingerprint: null,
    })

    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'DUPLICATE' } }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Part B: Override route — POST /api/invoices/[id]/override-duplicate
// ---------------------------------------------------------------------------

describe('POST /api/invoices/[id]/override-duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue({
      userId: 'user-controller-1',
      orgId:  'org-1',
      role:   'CONTROLLER',
    })

    mockPrisma.invoice.findFirst.mockResolvedValue(INVOICE)
    mockPrisma.invoiceDuplicateFlag.findFirst.mockResolvedValue(FLAG)

    // Array-style transaction: execute all ops
    mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops)
      return (ops as (p: unknown) => unknown)(mockPrisma)
    })

    mockPrisma.invoiceDuplicateFlag.update.mockResolvedValue({ id: 'flag-1', status: 'OVERRIDE_APPROVED' })
    mockPrisma.invoice.update.mockResolvedValue({ id: 'invoice-dup-1', status: 'PENDING_REVIEW' })
    mockPrisma.auditEvent.create.mockResolvedValue({})
  })

  it('succeeds with a valid justification (≥ 10 chars)', async () => {
    const res = await POST(
      makeRequest('invoice-dup-1', {
        flagId: 'flag-1',
        justification: 'Confirmed with vendor — not a duplicate.',
      }),
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.newStatus).toBe('OVERRIDE_APPROVED')
  })

  it('rejects an empty justification with 400', async () => {
    const res = await POST(
      makeRequest('invoice-dup-1', { flagId: 'flag-1', justification: '' }),
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it('rejects a justification shorter than 10 chars with 400', async () => {
    const res = await POST(
      makeRequest('invoice-dup-1', { flagId: 'flag-1', justification: 'Too short' }), // 9 chars
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it('returns 404 when invoice not found in org', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null)

    const res = await POST(
      makeRequest('missing-invoice', {
        flagId: 'flag-1', justification: 'Valid justification text here.',
      }),
      { params: Promise.resolve({ id: 'missing-invoice' }) },
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when flag is not in QUARANTINED state', async () => {
    mockPrisma.invoiceDuplicateFlag.findFirst.mockResolvedValue(null)

    const res = await POST(
      makeRequest('invoice-dup-1', {
        flagId: 'already-resolved', justification: 'Valid justification text here.',
      }),
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 for roles not permitted to override (AP_CLERK)', async () => {
    mockGetSession.mockResolvedValueOnce({
      userId: 'user-clerk-1',
      orgId:  'org-1',
      role:   'AP_CLERK',
    })

    const res = await POST(
      makeRequest('invoice-dup-1', {
        flagId: 'flag-1', justification: 'Valid justification text here.',
      }),
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )

    expect(res.status).toBe(403)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: null, orgId: null, role: null })

    const res = await POST(
      makeRequest('invoice-dup-1', {
        flagId: 'flag-1', justification: 'Valid justification text here.',
      }),
      { params: Promise.resolve({ id: 'invoice-dup-1' }) },
    )

    expect(res.status).toBe(401)
  })
})
