import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string; classificationId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId, classificationId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const classification = await prisma.entityClassification.findFirst({
      where: { id: classificationId, entityId },
    })
    if (!classification) throw new NotFoundError('Classification not found')

    const totalCount = await prisma.entityClassification.count({ where: { entityId } })
    if (totalCount <= 1) {
      throw new ValidationError('Entity must have at least one classification')
    }

    if (classification.isPrimary) {
      throw new ValidationError('Cannot delete primary classification — set another as primary first')
    }

    await prisma.$transaction(async (tx) => {
      await tx.entityClassification.delete({ where: { id: classificationId } })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'UPDATE',
        objectType: 'ENTITY',
        objectId:   entityId,
        after:      { removedClassification: classificationId, type: classification.type },
      })
    })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/entities/[entityId]/classifications/[classificationId]')
  }
}
