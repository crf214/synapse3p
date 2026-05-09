// src/app/api/contracts/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateContractSchema = z.object({
  contractNo:       z.string().min(1),
  type:             z.string().min(1),
  entityId:         z.string().min(1),
  docTitle:         z.string().optional(),
  status:           z.string().optional(),
  value:            z.union([z.number(), z.string()]).optional().nullable(),
  currency:         z.string().optional(),
  startDate:        z.string().optional().nullable(),
  endDate:          z.string().optional().nullable(),
  renewalDate:      z.string().optional().nullable(),
  autoRenew:        z.boolean().optional(),
  noticePeriodDays: z.number().optional(),
  linkedPoId:       z.string().optional().nullable(),
  notes:            z.string().optional().nullable(),
})

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])
const READ_ROLES  = new Set([...WRITE_ROLES, 'AP_CLERK', 'AUDITOR'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const orgId    = session.orgId!
    const status   = searchParams.get('status')   ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined
    const type     = searchParams.get('type')     ?? undefined
    const q        = searchParams.get('q')        ?? undefined
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit    = 50

    const where: Record<string, unknown> = { orgId }
    if (status)   where.status   = status
    if (entityId) where.entityId = entityId
    if (type)     where.type     = type
    if (q) {
      where.OR = [
        { contractNo: { contains: q, mode: 'insensitive' } },
        { notes:      { contains: q, mode: 'insensitive' } },
      ]
    }

    const [total, rows] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({
        where,
        skip:  (page - 1) * limit,
        take:  limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:              true,
          contractNo:      true,
          type:            true,
          status:          true,
          value:           true,
          currency:        true,
          startDate:       true,
          endDate:         true,
          renewalDate:     true,
          autoRenew:       true,
          noticePeriodDays:true,
          ownedBy:         true,
          reviewedAt:      true,
          createdAt:       true,
          entityId:        true,
          documentId:      true,
          linkedPoId:      true,
          notes:           true,
        },
      }),
    ])

    // Batch-fetch entity names + owner names
    const entityIds = [...new Set(rows.map(r => r.entityId))]
    const ownerIds  = [...new Set(rows.map(r => r.ownedBy))]

    const [entities, owners] = await Promise.all([
      prisma.entity.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } }),
      prisma.user.findMany({   where: { id: { in: ownerIds   } }, select: { id: true, name: true, email: true } }),
    ])

    const entityMap = Object.fromEntries(entities.map(e => [e.id, e]))
    const ownerMap  = Object.fromEntries(owners.map(u => [u.id, u]))

    const contracts = rows.map(r => ({
      ...r,
      value:      r.value !== null ? Number(r.value) : null,
      startDate:  r.startDate?.toISOString() ?? null,
      endDate:    r.endDate?.toISOString()   ?? null,
      renewalDate:r.renewalDate?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString()  ?? null,
      createdAt:  r.createdAt.toISOString(),
      entity:     entityMap[r.entityId] ?? { id: r.entityId, name: '—' },
      owner:      ownerMap[r.ownedBy]   ?? { id: r.ownedBy, name: null, email: '' },
    }))

    return NextResponse.json({ contracts, total, page, limit })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const orgId = session.orgId!
    const rawBody = await req.json()
    const parsed = CreateContractSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const contractNo = sanitiseString(body.contractNo ?? '')
    const type       = body.type as string
    const entityId   = body.entityId as string
    const docTitle   = sanitiseString(body.docTitle ?? contractNo)

    const VALID_TYPES = ['MASTER','SOW','AMENDMENT','NDA','SLA','FRAMEWORK','OTHER'] as const
    type ValidType = typeof VALID_TYPES[number]
    if (!(VALID_TYPES as readonly string[]).includes(type)) throw new ValidationError('Invalid contract type')
    const contractType = type as ValidType

    // Ensure entity belongs to org
    const entity = await prisma.entity.findFirst({ where: { id: entityId, masterOrgId: orgId } })
    if (!entity) throw new ValidationError('Entity not found')

    // Check contractNo uniqueness
    const exists = await prisma.contract.findFirst({ where: { orgId, contractNo } })
    if (exists) throw new ValidationError(`Contract ${contractNo} already exists`)

    // Create document stub outside any transaction — this is a non-critical pre-write.
    // The contract is the atomic record; the document back-link is a follow-up update.
    const doc = await prisma.document.create({
      data: {
        orgId,
        title:        docTitle,
        docType:      'CONTRACT',
        source:       'INTERNAL',
        storageRef:   '',
        storageBucket:'',
        entityId,
        uploadedBy:   session.userId!,
        metadata:     {},
      },
    })

    // Single atomic write — no interactive transaction needed.
    const contract = await prisma.contract.create({
      data: {
        orgId,
        documentId:      doc.id,
        entityId,
        contractNo,
        type:            contractType,
        status:          (body.status ?? 'DRAFT') as never,
        value:           body.value !== undefined && body.value !== '' ? Number(body.value) : null,
        currency:        sanitiseString(body.currency ?? 'USD'),
        startDate:       body.startDate  ? new Date(body.startDate)  : null,
        endDate:         body.endDate    ? new Date(body.endDate)    : null,
        renewalDate:     body.renewalDate? new Date(body.renewalDate): null,
        autoRenew:       body.autoRenew  ?? false,
        noticePeriodDays:body.noticePeriodDays ? Number(body.noticePeriodDays) : 30,
        ownedBy:         session.userId!,
        linkedPoId:      body.linkedPoId ?? null,
        notes:           body.notes ? sanitiseString(body.notes) : null,
      },
    })

    // Back-link document to contract — follow-up write, outside any transaction.
    await prisma.document.update({ where: { id: doc.id }, data: { contractId: contract.id } })

    return NextResponse.json(contract, { status: 201 })
  } catch (err) {
    return handleApiError(err, "")
  }
}
