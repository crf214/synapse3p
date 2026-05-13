import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const ENTITY_TYPE_VALUES = ['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER'] as const

const CreateClassificationSchema = z.object({
  type:      z.enum(ENTITY_TYPE_VALUES),
  isPrimary: z.boolean().optional(),
})

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const rawBody = await req.json()
    const parsed = CreateClassificationSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { type, isPrimary = false } = parsed.data

    const classification = await prisma.$transaction(async (tx) => {
      // If setting as primary, unset all other primary classifications first
      if (isPrimary) {
        await tx.entityClassification.updateMany({
          where: { entityId, isPrimary: true },
          data:  { isPrimary: false },
        })
      }

      const created = await tx.entityClassification.create({
        data: { entityId, type, isPrimary },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'UPDATE',
        objectType: 'ENTITY',
        objectId:   entityId,
        after:      { addedClassification: type, isPrimary },
      })

      return created
    })

    return NextResponse.json({ classification }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/classifications')
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const classifications = await prisma.entityClassification.findMany({
      where:   { entityId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ classifications })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/classifications')
  }
}
