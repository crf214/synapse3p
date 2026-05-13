// src/tests/bank-account-rails.test.ts
// Tests for rail-specific bank account validation.
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
    entityBankAccount: {
      findMany: vi.fn(),
      create:   vi.fn(),
      count:    vi.fn(),
      findFirst: vi.fn(),
      delete:   vi.fn(),
    },
  }

  const mockGetSession = vi.fn().mockResolvedValue({
    userId: 'user-admin-1',
    orgId:  'org-1',
    role:   'ADMIN',
  })

  return { mockPrisma, mockGetSession }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/entities/[entityId]/bank-accounts/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/entities/entity-1/bank-accounts', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const ENTITY = { id: 'entity-1' }

const CREATED_ACCOUNT = {
  id:          'acct-1',
  entityId:    'entity-1',
  isPrimary:   true,
  accountName: 'Acme Corp',
  accountNo:   '123456789',
  currency:    'USD',
  paymentRail: 'ACH',
  label:       'Main checking',
  routingNo:   '021000021',
  swiftBic:    null,
  iban:        null,
  status:      'ACTIVE',
  createdAt:   new Date(),
  updatedAt:   new Date(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bank account multi-rail validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Provide a deterministic test key (64 hex chars = 32 bytes AES-256)
    process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64)
    mockPrisma.entity.findFirst.mockResolvedValue(ENTITY)
    mockPrisma.entityBankAccount.count.mockResolvedValue(0)
    mockPrisma.entityBankAccount.create.mockResolvedValue(CREATED_ACCOUNT)
  })

  // ── ACH ───────────────────────────────────────────────────────────────────

  describe('ACH rail', () => {
    it('valid ACH payload → 201', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        currency:    'USD',
        routingNo:   '021000021',
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.bankAccount).toBeDefined()
    })

    it('missing routingNo → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        currency:    'USD',
        // routingNo omitted
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Validation failed')
    })

    it('routingNo wrong length (8 digits) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        currency:    'USD',
        routingNo:   '02100002',  // 8 digits, not 9
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('routingNo with non-digits → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        currency:    'USD',
        routingNo:   '02100002X',  // contains letter
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('missing accountNo → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        currency:    'USD',
        routingNo:   '021000021',
        // accountNo omitted
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })
  })

  // ── SWIFT ──────────────────────────────────────────────────────────────────

  describe('SWIFT rail', () => {
    it('valid SWIFT payload (8-char BIC) → 201', async () => {
      mockPrisma.entityBankAccount.create.mockResolvedValue({ ...CREATED_ACCOUNT, paymentRail: 'SWIFT' })

      const res = await POST(makePost({
        paymentRail: 'SWIFT',
        label:       'HSBC London',
        accountName: 'Acme Corp',
        accountNo:   'GB12345678',
        currency:    'GBP',
        swiftBic:    'HBUKGB4B',  // 8 chars
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(201)
    })

    it('valid SWIFT payload (11-char BIC) → 201', async () => {
      mockPrisma.entityBankAccount.create.mockResolvedValue({ ...CREATED_ACCOUNT, paymentRail: 'SWIFT' })

      const res = await POST(makePost({
        paymentRail: 'SWIFT',
        label:       'HSBC London Canary Wharf',
        accountName: 'Acme Corp',
        accountNo:   'GB12345678',
        currency:    'GBP',
        swiftBic:    'HBUKGB4BXXX',  // 11 chars
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(201)
    })

    it('missing swiftBic → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'SWIFT',
        label:       'HSBC London',
        accountName: 'Acme Corp',
        accountNo:   'GB12345678',
        currency:    'GBP',
        // swiftBic omitted
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('swiftBic wrong length (7 chars) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'SWIFT',
        label:       'HSBC London',
        accountName: 'Acme Corp',
        accountNo:   'GB12345678',
        currency:    'GBP',
        swiftBic:    'HBUKGB4',  // 7 chars — invalid
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })
  })

  // ── SEPA ───────────────────────────────────────────────────────────────────

  describe('SEPA rail', () => {
    it('valid SEPA payload → 201', async () => {
      mockPrisma.entityBankAccount.create.mockResolvedValue({ ...CREATED_ACCOUNT, paymentRail: 'SEPA' })

      const res = await POST(makePost({
        paymentRail: 'SEPA',
        label:       'Deutsche Bank',
        accountName: 'Acme Corp GmbH',
        currency:    'EUR',
        iban:        'DE89370400440532013000',
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(201)
    })

    it('missing iban → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'SEPA',
        label:       'Deutsche Bank',
        accountName: 'Acme Corp GmbH',
        currency:    'EUR',
        // iban omitted
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('invalid IBAN format (starts with digits) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'SEPA',
        label:       'Deutsche Bank',
        accountName: 'Acme Corp GmbH',
        currency:    'EUR',
        iban:        '12DE89370400440532013000',  // starts with digits — invalid
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('invalid IBAN format (no check digits) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'SEPA',
        label:       'Deutsche Bank',
        accountName: 'Acme Corp GmbH',
        currency:    'EUR',
        iban:        'DEXX370400440532013000',  // check digits are not numeric
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })
  })

  // ── Fields common to all rails ─────────────────────────────────────────────

  describe('fields required on all rails', () => {
    it('missing currency → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        routingNo:   '021000021',
        // currency omitted
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('currency wrong format (2 chars) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        accountName: 'Acme Corp',
        accountNo:   '123456789',
        currency:    'US',  // 2 chars — invalid
        routingNo:   '021000021',
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('missing accountName (accountHolderName) → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'ACH',
        label:       'Main checking',
        // accountName omitted
        accountNo:   '123456789',
        currency:    'USD',
        routingNo:   '021000021',
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })

    it('unknown rail → 400', async () => {
      const res = await POST(makePost({
        paymentRail: 'CRYPTO',
        label:       'Bitcoin wallet',
        accountName: 'Acme Corp',
        accountNo:   'bc1q...',
        currency:    'BTC',
      }), { params: Promise.resolve({ entityId: 'entity-1' }) })

      expect(res.status).toBe(400)
    })
  })

  // ── Auth + entity guards ───────────────────────────────────────────────────

  it('returns 401 for unauthenticated request', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: null, orgId: null, role: null })

    const res = await POST(makePost({
      paymentRail: 'ACH',
      label:       'Main',
      accountName: 'Corp',
      accountNo:   '123',
      currency:    'USD',
      routingNo:   '021000021',
    }), { params: Promise.resolve({ entityId: 'entity-1' }) })

    expect(res.status).toBe(401)
  })

  it('returns 404 when entity not found', async () => {
    mockPrisma.entity.findFirst.mockResolvedValueOnce(null)

    const res = await POST(makePost({
      paymentRail: 'ACH',
      label:       'Main',
      accountName: 'Corp',
      accountNo:   '123456789',
      currency:    'USD',
      routingNo:   '021000021',
    }), { params: Promise.resolve({ entityId: 'entity-missing' }) })

    expect(res.status).toBe(404)
  })
})
