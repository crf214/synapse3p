import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

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
    const search   = sanitiseString(searchParams.get('search') ?? '', 200).trim()
    const status   = sanitiseString(searchParams.get('status') ?? '', 50).trim() || null
    const highRisk = searchParams.get('highRisk') === 'true'

    const where = {
      masterOrgId: session.orgId,
      ...(status ? { status: status as never } : {}),
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

    const body = await req.json() as Record<string, unknown>

    const name              = sanitiseString(body.name            ?? '', 200)
    const legalStructure    = sanitiseString(body.legalStructure  ?? '', 50)
    const jurisdiction      = sanitiseString(body.jurisdiction    ?? '', 10)
    const primaryCurrency   = sanitiseString(body.primaryCurrency ?? '', 10)
    const registrationNo    = sanitiseString(body.registrationNo  ?? '', 100)
    const notes             = sanitiseString(body.notes           ?? '', 2000)
    const parentId          = body.parentId          ? sanitiseString(body.parentId as string, 100) : null
    const incorporationDate = body.incorporationDate ? new Date(body.incorporationDate as string) : null

    if (!name)            throw new ValidationError('name is required')
    if (!legalStructure)  throw new ValidationError('legalStructure is required')
    if (!jurisdiction)    throw new ValidationError('jurisdiction is required')
    if (!primaryCurrency) throw new ValidationError('primaryCurrency is required')

    const VALID_STRUCTURES = ['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER']
    if (!VALID_STRUCTURES.includes(legalStructure)) throw new ValidationError('invalid legalStructure')

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
      + '-' + Date.now().toString(36)

    const entity = await prisma.entity.create({
      data: {
        masterOrgId:    session.orgId,
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

    await prisma.entityOrgRelationship.create({
      data: {
        entityId:        entity.id,
        orgId:           session.orgId,
        onboardingStatus: 'NOT_STARTED',
        activeForBillPay: false,
        portalAccess:    false,
      },
    })

    return NextResponse.json({ entity }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities')
  }
}
