import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

// All valid EntityType values (must stay in sync with prisma/schema.prisma EntityType enum)
const ENTITY_TYPE_VALUES = ['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER'] as const
type EntityTypeValue = typeof ENTITY_TYPE_VALUES[number]

const CreateEntitySchema = z.object({
  name:              z.string().min(1),
  legalStructure:    z.string().min(1),
  jurisdiction:      z.string().min(1),
  primaryCurrency:   z.string().min(1),
  registrationNo:    z.string().optional(),
  notes:             z.string().optional(),
  parentId:          z.string().optional().nullable(),
  incorporationDate: z.string().optional().nullable(),
  // Optional primary classification — validated against the enum to prevent stale values
  entityType:        z.enum(ENTITY_TYPE_VALUES).optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit    = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const search      = sanitiseString(searchParams.get('search') ?? '', 200).trim()
    const status      = sanitiseString(searchParams.get('status') ?? '', 50).trim() || null
    const entityTypes = searchParams.get('types')?.split(',').filter(Boolean) ?? []
    const highRisk    = searchParams.get('highRisk') === 'true'

    const where = {
      masterOrgId: session.orgId,
      ...(status ? { status: status as never } : {}),
      ...(entityTypes.length > 0 ? { classifications: { some: { type: { in: entityTypes as never[] }, isPrimary: true } } } : {}),
      ...(highRisk ? { riskScore: { gte: 7 } } : {}),
      ...(search ? {
        OR: [
          { name:         { contains: search, mode: 'insensitive' as const } },
          { jurisdiction: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    }

    const [total, entities] = await Promise.all([
      prisma.entity.count({ where }),
      prisma.entity.findMany({
        where,
        orderBy: { name: 'asc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          classifications: {
            where:   { isPrimary: true },
            take:    1,
            select:  { type: true },
          },
          riskScores: {
            orderBy: { scoredAt: 'desc' },
            take:    1,
            select:  { computedScore: true, scoredAt: true },
          },
          orgRelationships: {
            where:  { orgId: session.orgId },
            take:   1,
            select: { onboardingStatus: true, activeForBillPay: true, approvedSpendLimit: true },
          },
          _count: {
            select: { bankAccounts: true, serviceEngagements: true },
          },
        },
      }),
    ])

    const data = entities.map(e => ({
      id:               e.id,
      name:             e.name,
      slug:             e.slug,
      status:           e.status,
      legalStructure:   e.legalStructure,
      jurisdiction:     e.jurisdiction,
      primaryCurrency:  e.primaryCurrency,
      riskScore:        e.riskScore,
      primaryType:      e.classifications[0]?.type ?? null,
      latestRiskScore:  e.riskScores[0] ?? null,
      orgRelationship:  e.orgRelationships[0] ?? null,
      bankAccountCount: e._count.bankAccounts,
      engagementCount:  e._count.serviceEngagements,
    }))

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      entities: data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateEntitySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const name              = sanitiseString(body.name            ?? '', 200)
    const legalStructure    = sanitiseString(body.legalStructure  ?? '', 50)
    const jurisdiction      = sanitiseString(body.jurisdiction    ?? '', 10)
    const primaryCurrency   = sanitiseString(body.primaryCurrency ?? '', 10)
    const registrationNo    = sanitiseString(body.registrationNo  ?? '', 100)
    const notes             = sanitiseString(body.notes           ?? '', 2000)
    const parentId          = body.parentId          ? sanitiseString(body.parentId, 100) : null
    const incorporationDate = body.incorporationDate ? new Date(body.incorporationDate) : null

    const VALID_STRUCTURES = ['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER']
    if (!VALID_STRUCTURES.includes(legalStructure)) throw new ValidationError('invalid legalStructure')

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
      + '-' + Date.now().toString(36)

    const entity = await prisma.$transaction(async (tx) => {
      const created = await tx.entity.create({
        data: {
          masterOrgId:    session.orgId!,
          name,
          slug,
          legalStructure: legalStructure as never,
          jurisdiction,
          primaryCurrency,
          registrationNo: registrationNo || null,
          incorporationDate,
          parentId:       parentId || null,
          status:         'ACTIVE',
          metadata:       notes ? { notes } : {},
        },
      })

      // Create initial classification if entityType provided
      if (body.entityType) {
        await tx.entityClassification.create({
          data: {
            entityId:  created.id,
            type:      body.entityType as EntityTypeValue,
            isPrimary: true,
          },
        })
      }

      await tx.entityOrgRelationship.create({
        data: {
          entityId:        created.id,
          orgId:           session.orgId!,
          onboardingStatus: 'NOT_STARTED',
          activeForBillPay: false,
          portalAccess:    false,
        },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'CREATE',
        objectType: 'ENTITY',
        objectId:   created.id,
      })

      return created
    })

    return NextResponse.json({ entity }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities')
  }
}
