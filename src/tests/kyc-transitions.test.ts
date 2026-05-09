// src/tests/kyc-transitions.test.ts
// Tests for KYC/KYB due diligence status transitions.
// All Prisma and session calls are mocked — no real DB connection required.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — make mocks available to vi.mock factories
// ---------------------------------------------------------------------------

const { mockPrisma, mockGetSession } = vi.hoisted(() => {
  const mockPrisma = {
    entity: {
      findFirst: vi.fn(),
    },
    entityDueDiligence: {
      findUnique: vi.fn(),
      upsert:     vi.fn(),
      update:     vi.fn(),
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
    userId: 'user-legal-1',
    orgId:  'org-1',
    role:   'LEGAL',
    name:   'Legal Reviewer',
    email:  'legal@example.com',
  })

  return { mockPrisma, mockGetSession }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/entities/[entityId]/due-diligence/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/entities/entity-1/due-diligence', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const ENTITY = { id: 'entity-1' }

const BASE_DD = {
  id:             'dd-1',
  entityId:       'entity-1',
  ddLevel:        1,
  kycStatus:      'PENDING',
  kybStatus:      'PENDING',
  sanctionsStatus: 'CLEAR',
  pepStatus:      false,
  reviewedAt:     null,
  reviewedBy:     null,
  nextReviewDate: null,
  internalFactors: {},
  externalFactors: {},
  createdAt:      new Date(),
  updatedAt:      new Date(),
}

function setupTransaction() {
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
    fn(mockPrisma),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KYC/KYB status transition tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
    mockPrisma.entity.findFirst.mockResolvedValue(ENTITY)
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.entityActivityLog.create.mockResolvedValue({})
  })

  // ── Valid transitions ──────────────────────────────────────────────────────

  describe('valid transitions', () => {
    it('PENDING → IN_REVIEW is allowed', async () => {
      const existing = { ...BASE_DD, kycStatus: 'PENDING' }
      const updated  = { ...existing, kycStatus: 'IN_REVIEW' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.dueDiligence.kycStatus).toBe('IN_REVIEW')
    })

    it('IN_REVIEW → APPROVED is allowed and sets reviewedAt', async () => {
      const existing = { ...BASE_DD, kycStatus: 'IN_REVIEW' }
      const now = new Date()
      const updated  = { ...existing, kycStatus: 'APPROVED', reviewedAt: now, reviewedBy: 'user-legal-1' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'APPROVED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.dueDiligence.kycStatus).toBe('APPROVED')
      // reviewedAt is set in the updated record
      expect(json.dueDiligence.reviewedAt).toBeDefined()

      // Confirm update was called with reviewedAt
      expect(mockPrisma.entityDueDiligence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kycStatus: 'APPROVED', reviewedAt: expect.any(Date) }),
        }),
      )
    })

    it('IN_REVIEW → FAILED is allowed', async () => {
      const existing = { ...BASE_DD, kycStatus: 'IN_REVIEW' }
      const updated  = { ...existing, kycStatus: 'FAILED' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'FAILED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
    })

    it('APPROVED → EXPIRED is allowed', async () => {
      const existing = { ...BASE_DD, kycStatus: 'APPROVED' }
      const updated  = { ...existing, kycStatus: 'EXPIRED' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'EXPIRED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
    })

    it('FAILED → IN_REVIEW is allowed (re-submission)', async () => {
      const existing = { ...BASE_DD, kycStatus: 'FAILED' }
      const updated  = { ...existing, kycStatus: 'IN_REVIEW' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
    })

    it('NOT_REQUIRED → PENDING is allowed', async () => {
      const existing = { ...BASE_DD, kycStatus: 'NOT_REQUIRED' }
      const updated  = { ...existing, kycStatus: 'PENDING' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'PENDING' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
    })

    it('can update kycStatus and kybStatus independently in same request', async () => {
      const existing = { ...BASE_DD, kycStatus: 'IN_REVIEW', kybStatus: 'IN_REVIEW' }
      const updated  = { ...existing, kycStatus: 'APPROVED', kybStatus: 'FAILED' }
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(existing)
      mockPrisma.entityDueDiligence.update.mockResolvedValue(updated)

      const res = await PATCH(makePatch({ kycStatus: 'APPROVED', kybStatus: 'FAILED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(200)
    })
  })

  // ── Invalid transitions ────────────────────────────────────────────────────

  describe('invalid transitions → 400', () => {
    it('PENDING → APPROVED is rejected', async () => {
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue({ ...BASE_DD, kycStatus: 'PENDING' })

      const res = await PATCH(makePatch({ kycStatus: 'APPROVED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('Invalid status transition from PENDING to APPROVED')
    })

    it('APPROVED → IN_REVIEW is rejected', async () => {
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue({ ...BASE_DD, kycStatus: 'APPROVED' })

      const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('Invalid status transition from APPROVED to IN_REVIEW')
    })

    it('EXPIRED → PENDING is rejected', async () => {
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue({ ...BASE_DD, kycStatus: 'EXPIRED' })

      const res = await PATCH(makePatch({ kycStatus: 'PENDING' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('Invalid status transition from EXPIRED to PENDING')
    })

    it('IN_REVIEW → PENDING is rejected', async () => {
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue({ ...BASE_DD, kycStatus: 'IN_REVIEW' })

      const res = await PATCH(makePatch({ kycStatus: 'PENDING' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('Invalid status transition from IN_REVIEW to PENDING')
    })

    it('invalid status value returns 400 from Zod', async () => {
      mockPrisma.entityDueDiligence.upsert.mockResolvedValue(BASE_DD)

      const res = await PATCH(makePatch({ kycStatus: 'REJECTED' }), {
        params: Promise.resolve({ entityId: 'entity-1' }),
      })
      expect(res.status).toBe(400)
    })
  })

  // ── Auth guards ────────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated request', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: null, orgId: null, role: null })

    const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
      params: Promise.resolve({ entityId: 'entity-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for role without write access', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: 'u1', orgId: 'org-1', role: 'AP_CLERK' })

    const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
      params: Promise.resolve({ entityId: 'entity-1' }),
    })
    expect(res.status).toBe(403)
  })

  // ── Not found ──────────────────────────────────────────────────────────────

  it('returns 404 for non-existent entity', async () => {
    mockPrisma.entity.findFirst.mockResolvedValueOnce(null)

    const res = await PATCH(makePatch({ kycStatus: 'IN_REVIEW' }), {
      params: Promise.resolve({ entityId: 'entity-missing' }),
    })
    expect(res.status).toBe(404)
  })
})
