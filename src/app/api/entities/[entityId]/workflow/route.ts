// src/app/api/entities/[entityId]/workflow/route.ts
// GET — return the current workflow state for an entity

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const READ_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
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

    if (!instance) {
      return NextResponse.json({ workflow: null })
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
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/workflow')
  }
}
