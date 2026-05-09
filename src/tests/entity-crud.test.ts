// src/tests/entity-crud.test.ts
// Smoke tests for entity CRUD + classification routes.
// All Prisma and session calls are mocked — no real DB connection required.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockPrisma, mockGetSession } = vi.hoisted(() => {
  const mockPrisma = {
    entity: {
      findFirst:  vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      findMany:   vi.fn(),
      count:      vi.fn(),
    },
    entityClassification: {
      create:      vi.fn(),
      findFirst:   vi.fn(),
      findMany:    vi.fn(),
      updateMany:  vi.fn(),
      delete:      vi.fn(),
      count:       vi.fn(),
    },
    entityOrgRelationship: {
      create: vi.fn(),
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
    userId: 'user-admin-1',
    orgId:  'org-1',
    role:   'ADMIN',
    name:   'Test Admin',
    email:  'admin@example.com',
  })

  return { mockPrisma, mockGetSession }
})

vi.mock('@/lib/prisma',  () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session', () => ({ getSession: mockGetSession }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST as createEntity, GET as listEntities } from '@/app/api/entities/route'
import { PATCH as patchEntity } from '@/app/api/entities/[entityId]/route'
import { POST as addClassification }    from '@/app/api/entities/[entityId]/classifications/route'
import { DELETE as deleteClassification } from '@/app/api/entities/[entityId]/classifications/[classificationId]/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function makePatch(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function makeDelete(url: string): NextRequest {
  return new NextRequest(url, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTITY = {
  id:             'entity-1',
  masterOrgId:    'org-1',
  name:           'Optimum Cable LLC',
  slug:           'optimum-cable-llc-abc123',
  status:         'ACTIVE',
  legalStructure: 'COMPANY',
  jurisdiction:   'US',
  primaryCurrency: 'USD',
  registrationNo: null,
  incorporationDate: null,
  parentId:       null,
  riskOverride:   false,
  metadata:       {},
}

const CLASSIFICATION = {
  id:        'cls-1',
  entityId:  'entity-1',
  type:      'VENDOR',
  isPrimary: true,
  createdAt: new Date(),
}

// ---------------------------------------------------------------------------
// Utility: make $transaction call the callback with mockPrisma
// ---------------------------------------------------------------------------

function setupTransaction() {
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
    fn(mockPrisma),
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Entity CRUD smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
    // Audit and activity log writes must not throw
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.entityActivityLog.create.mockResolvedValue({})
  })

  // ── Create entity ──────────────────────────────────────────────────────────

  describe('POST /api/entities — create entity', () => {
    it('returns 201 with entity record on valid payload', async () => {
      mockPrisma.entity.create.mockResolvedValue(ENTITY)
      mockPrisma.entityClassification.create.mockResolvedValue(CLASSIFICATION)
      mockPrisma.entityOrgRelationship.create.mockResolvedValue({})

      const req = makeRequest('http://localhost/api/entities', {
        name:            'Optimum Cable LLC',
        legalStructure:  'COMPANY',
        jurisdiction:    'US',
        primaryCurrency: 'USD',
        entityType:      'VENDOR',
      })

      const res = await createEntity(req)
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.entity).toBeDefined()
      expect(json.entity.name).toBe('Optimum Cable LLC')
    })

    it('returns 400 on invalid entityType', async () => {
      const req = makeRequest('http://localhost/api/entities', {
        name:            'Bad Corp',
        legalStructure:  'COMPANY',
        jurisdiction:    'US',
        primaryCurrency: 'USD',
        entityType:      'INVALID_TYPE',
      })

      const res = await createEntity(req)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Validation failed')
    })

    it('returns 400 when required fields are missing', async () => {
      const req = makeRequest('http://localhost/api/entities', {
        name: 'No Currency Corp',
        legalStructure: 'COMPANY',
        // missing jurisdiction and primaryCurrency
      })

      const res = await createEntity(req)
      expect(res.status).toBe(400)
    })
  })

  // ── Update entity ──────────────────────────────────────────────────────────

  describe('PATCH /api/entities/[entityId] — update entity', () => {
    it('returns 200 with updated entity on valid fields', async () => {
      const updated = { ...ENTITY, jurisdiction: 'GB' }
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY)
      mockPrisma.entity.update.mockResolvedValue(updated)

      const req = makePatch('http://localhost/api/entities/entity-1', {
        jurisdiction: 'GB',
      })

      const res = await patchEntity(req, { params: Promise.resolve({ entityId: 'entity-1' }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.entity.jurisdiction).toBe('GB')
    })

    it('returns 200 (no-op) when no fields changed', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(ENTITY)

      const req = makePatch('http://localhost/api/entities/entity-1', {
        jurisdiction: 'US',  // same as existing
      })

      const res = await patchEntity(req, { params: Promise.resolve({ entityId: 'entity-1' }) })
      expect(res.status).toBe(200)
    })

    it('returns 404 when entity not found', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue(null)

      const req = makePatch('http://localhost/api/entities/entity-missing', {
        jurisdiction: 'US',
      })

      const res = await patchEntity(req, { params: Promise.resolve({ entityId: 'entity-missing' }) })
      expect(res.status).toBe(404)
    })
  })

  // ── Add classification ─────────────────────────────────────────────────────

  describe('POST /api/entities/[entityId]/classifications — add classification', () => {
    it('returns 201 with created classification on valid type', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.updateMany.mockResolvedValue({ count: 0 })
      mockPrisma.entityClassification.create.mockResolvedValue({
        id:        'cls-2',
        entityId:  'entity-1',
        type:      'CONTRACTOR',
        isPrimary: false,
        createdAt: new Date(),
      })

      const req = makeRequest('http://localhost/api/entities/entity-1/classifications', {
        type:      'CONTRACTOR',
        isPrimary: false,
      })

      const res = await addClassification(req, { params: Promise.resolve({ entityId: 'entity-1' }) })
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.classification.type).toBe('CONTRACTOR')
    })

    it('returns 400 on invalid classification type', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })

      const req = makeRequest('http://localhost/api/entities/entity-1/classifications', {
        type: 'HACKER',
      })

      const res = await addClassification(req, { params: Promise.resolve({ entityId: 'entity-1' }) })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('Validation failed')
    })

    it('unsets existing primary before setting new primary', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.entityClassification.create.mockResolvedValue({
        id:        'cls-3',
        entityId:  'entity-1',
        type:      'BROKER',
        isPrimary: true,
        createdAt: new Date(),
      })

      const req = makeRequest('http://localhost/api/entities/entity-1/classifications', {
        type:      'BROKER',
        isPrimary: true,
      })

      const res = await addClassification(req, { params: Promise.resolve({ entityId: 'entity-1' }) })
      expect(res.status).toBe(201)
      expect(mockPrisma.entityClassification.updateMany).toHaveBeenCalledWith({
        where: { entityId: 'entity-1', isPrimary: true },
        data:  { isPrimary: false },
      })
    })
  })

  // ── Delete classification ──────────────────────────────────────────────────

  describe('DELETE /api/entities/[entityId]/classifications/[classificationId]', () => {
    it('returns 400 when it is the only classification', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.findFirst.mockResolvedValue(CLASSIFICATION)
      mockPrisma.entityClassification.count.mockResolvedValue(1)

      const req = makeDelete('http://localhost/api/entities/entity-1/classifications/cls-1')
      const res = await deleteClassification(req, {
        params: Promise.resolve({ entityId: 'entity-1', classificationId: 'cls-1' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('at least one classification')
    })

    it('returns 400 when deleting primary with others present', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.findFirst.mockResolvedValue(CLASSIFICATION) // isPrimary: true
      mockPrisma.entityClassification.count.mockResolvedValue(3)

      const req = makeDelete('http://localhost/api/entities/entity-1/classifications/cls-1')
      const res = await deleteClassification(req, {
        params: Promise.resolve({ entityId: 'entity-1', classificationId: 'cls-1' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error.message).toContain('Cannot delete primary classification')
    })

    it('returns 204 on successful deletion of non-primary classification', async () => {
      const nonPrimary = { ...CLASSIFICATION, id: 'cls-2', isPrimary: false }
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.findFirst.mockResolvedValue(nonPrimary)
      mockPrisma.entityClassification.count.mockResolvedValue(2)
      mockPrisma.entityClassification.delete.mockResolvedValue(nonPrimary)

      const req = makeDelete('http://localhost/api/entities/entity-1/classifications/cls-2')
      const res = await deleteClassification(req, {
        params: Promise.resolve({ entityId: 'entity-1', classificationId: 'cls-2' }),
      })

      expect(res.status).toBe(204)
    })

    it('returns 404 when classification not found', async () => {
      mockPrisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' })
      mockPrisma.entityClassification.findFirst.mockResolvedValue(null)

      const req = makeDelete('http://localhost/api/entities/entity-1/classifications/cls-missing')
      const res = await deleteClassification(req, {
        params: Promise.resolve({ entityId: 'entity-1', classificationId: 'cls-missing' }),
      })

      expect(res.status).toBe(404)
    })
  })
})
