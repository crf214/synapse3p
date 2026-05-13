// src/app/api/entities/[entityId]/workflow/route.ts
// GET — return the current workflow state for an entity

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    // Find the most recent non-cancelled WorkflowInstance for this entity
    const instance = await prisma.workflowInstance.findFirst({
      where: {
        targetObjectType: 'ENTITY',
        targetObjectId:   entityId,
        orgId:            session.orgId,
        status:           { notIn: ['CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        template:      { select: { name: true, version: true } },
        stepInstances: {
          include: {
            stepDefinition: {
              select: { name: true, stepType: true, order: true },
            },
            dependencies: {
              select: {
                id:             true,
                dependencyType: true,
                subjectId:      true,
                resolvedAt:     true,
              },
            },
          },
          orderBy: { stepDefinition: { order: 'asc' } },
        },
      },
    })

    // Collect completed step history across all instances for this entity
    const allInstances = await prisma.workflowInstance.findMany({
      where: { targetObjectType: 'ENTITY', targetObjectId: entityId, orgId: session.orgId },
      include: {
        stepInstances: {
          where:   { status: { in: ['COMPLETED', 'FAILED', 'SKIPPED'] } },
          include: { stepDefinition: { select: { name: true, stepType: true } } },
          orderBy: { completedAt: 'desc' },
          take:    50,
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const history = allInstances.flatMap(inst =>
      inst.stepInstances.map(si => ({
        id:          si.id,
        stepName:    si.stepDefinition.name,
        stepType:    si.stepDefinition.stepType,
        result:      si.result ?? null,
        status:      si.status,
        completedAt: si.completedAt?.toISOString() ?? null,
        completedBy: si.completedBy ?? null,
        instanceId:  inst.id,
      }))
    ).filter(h => h.completedAt !== null)

    if (!instance) {
      return NextResponse.json({ workflow: null, history })
    }

    const steps = instance.stepInstances.map(si => ({
      id:          si.id,
      name:        si.stepDefinition.name,
      type:        si.stepDefinition.stepType,
      order:       si.stepDefinition.order,
      status:      si.status,
      result:      si.result ?? null,
      completedAt: si.completedAt ?? null,
      completedBy: si.completedBy ?? null,
      isActive:    si.status === 'IN_PROGRESS',
      isWaiting:   si.status === 'WAITING',
      metadata:    si.metadata,
      dependencies: si.dependencies.map(d => ({
        id:             d.id,
        dependencyType: d.dependencyType,
        subjectId:      d.subjectId,
        resolvedAt:     d.resolvedAt ?? null,
      })),
    }))

    const currentSteps = steps
      .filter(s => s.isActive || s.isWaiting)
      .map(s => s.id)

    return NextResponse.json({
      workflow: {
        id:              instance.id,
        status:          instance.status,
        templateName:    instance.template.name,
        templateVersion: instance.templateVersion,
        startedAt:       instance.startedAt ?? null,
        completedAt:     instance.completedAt ?? null,
        steps,
        currentSteps,
      },
      history,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/workflow')
  }
}
