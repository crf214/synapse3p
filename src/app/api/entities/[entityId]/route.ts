import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'
import { resolveStepDependencies, DependencyType } from '@/lib/workflow/resolve-dependencies'
import { updateEntityRisk } from '@/lib/risk/update-entity-risk'
import { WorkflowEngine, selectTemplate } from '@/lib/workflow-engine'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const LEGAL_STRUCTURES = new Set(['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER'])
const ENTITY_STATUSES  = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_REVIEW', 'OFFBOARDED', 'PROVISIONAL'])
// Must stay in sync with prisma/schema.prisma EntityType enum
const ENTITY_TYPES     = new Set(['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: orgId },
      include: {
        classifications: { orderBy: { isPrimary: 'desc' } },
        bankAccounts:    { orderBy: { isPrimary: 'desc' } },
        dueDiligence:    true,
        financial:       true,
        riskScores: {
          orderBy: { computedAt: 'desc' },
          take:    1,
        },
        orgRelationships: {
          where:  { orgId: orgId },
          take:   1,
        },
        serviceEngagements: {
          include: { serviceCatalogue: { select: { name: true, parentId: true } } },
          orderBy: { createdAt: 'desc' },
        },
        entityActivityLogs: {
          orderBy: { occurredAt: 'desc' },
          take:    100,
        },
        parent:        { select: { id: true, name: true, slug: true } },
      },
    })

    if (!entity) throw new NotFoundError('Entity not found')

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]')
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const existing = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: orgId },
    })
    if (!existing) throw new NotFoundError('Entity not found')

    const body = await req.json() as Record<string, unknown>
    const updates: Record<string, unknown> = {}
    const changedFields: string[] = []

    // ── String fields ────────────────────────────────────────────────────────
    for (const key of ['name', 'jurisdiction', 'registrationNo', 'primaryCurrency', 'stockTicker'] as const) {
      if (!(key in body)) continue
      const v = sanitiseString(body[key] ?? '', 200)
      if (key === 'name' && !v) throw new ValidationError('name cannot be empty')
      const next = v || null
      if (String(existing[key] ?? '') !== String(next ?? '')) {
        updates[key] = next
        changedFields.push(key)
      }
    }

    // ── Date field ───────────────────────────────────────────────────────────
    if ('incorporationDate' in body) {
      const next = body.incorporationDate ? new Date(body.incorporationDate as string) : null
      const prev = existing.incorporationDate?.toISOString().slice(0, 10) ?? null
      const nextStr = next?.toISOString().slice(0, 10) ?? null
      if (prev !== nextStr) {
        updates.incorporationDate = next
        changedFields.push('incorporationDate')
      }
    }

    // ── Enum fields ──────────────────────────────────────────────────────────
    if ('legalStructure' in body) {
      const v = String(body.legalStructure ?? '').toUpperCase()
      if (!LEGAL_STRUCTURES.has(v)) throw new ValidationError('Invalid legalStructure')
      if (existing.legalStructure !== v) {
        updates.legalStructure = v
        changedFields.push('legalStructure')
      }
    }

    if ('status' in body) {
      const v = String(body.status ?? '').toUpperCase()
      if (!ENTITY_STATUSES.has(v)) throw new ValidationError('Invalid status')
      if (existing.status !== v) {
        updates.status = v
        changedFields.push('status')
      }
    }

    // ── EntityType guard — reject stale/invalid values immediately ───────────
    if ('entityType' in body) {
      const v = String(body.entityType ?? '').toUpperCase()
      if (!ENTITY_TYPES.has(v)) {
        throw new ValidationError(
          `Invalid entityType "${body.entityType}". Allowed values: ${[...ENTITY_TYPES].join(', ')}`,
        )
      }
      // Note: classification updates are handled via /api/entities/[entityId]/classifications
      // This guard prevents stale enum values from being submitted; callers should use that endpoint.
    }

    // ── Relation field (parentId) ────────────────────────────────────────────
    for (const key of ['parentId'] as const) {
      if (!(key in body)) continue
      const next = body[key] ? String(body[key]) : null
      if (next && next !== entityId) {
        // Verify the referenced entity belongs to same org
        const ref = await prisma.entity.findFirst({ where: { id: next, masterOrgId: orgId } })
        if (!ref) throw new ValidationError(`Referenced entity for ${key} not found`)
      }
      if ((existing[key] ?? null) !== next) {
        updates[key] = next
        changedFields.push(key)
      }
    }

    // ── Numeric / boolean overrides ──────────────────────────────────────────
    if ('riskOverride' in body) {
      const next = Boolean(body.riskOverride)
      if (existing.riskOverride !== next) {
        updates.riskOverride = next
        changedFields.push('riskOverride')
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ entity: existing })
    }

    const entity = await prisma.$transaction(async (tx) => {
      const updated = await tx.entity.update({
        where: { id: entityId },
        data:  updates,
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'UPDATE',
        objectType: 'ENTITY',
        objectId:   entityId,
        after:      { changedFields },
      })

      return updated
    })

    // ── Resolve step dependencies when PROVISIONAL → confirmed ───────────────
    const statusChanged   = changedFields.includes('status')
    const wasProvisional  = existing.status === 'PROVISIONAL'
    const isNowConfirmed  = statusChanged && entity.status !== 'PROVISIONAL'
    if (wasProvisional && isNowConfirmed) {
      resolveStepDependencies(DependencyType.ENTITY_CONFIRMED, entityId, prisma).catch(err => {
        console.error('[entities/PATCH] resolveStepDependencies failed:', err)
      })
    }

    // ── Advance active workflow approval step when a status decision is made ──
    if (statusChanged) {
      void (async () => {
        try {
          // Determine PASS/FAIL from new status
          const isFailed  = ['INACTIVE', 'SUSPENDED', 'OFFBOARDED'].includes(entity.status)
          const stepResult: 'PASS' | 'FAIL' = isFailed ? 'FAIL' : 'PASS'

          // Find the active WorkflowInstance for this entity
          const activeInstance = await prisma.workflowInstance.findFirst({
            where: {
              targetObjectType: 'ENTITY',
              targetObjectId:   entityId,
              orgId:            orgId,
              status:           'IN_PROGRESS',
            },
            orderBy: { createdAt: 'desc' },
          })
          if (!activeInstance) return

          // Find the active APPROVAL step instance
          const activeApprovalStep = await prisma.workflowStepInstance.findFirst({
            where: {
              workflowInstanceId: activeInstance.id,
              status:             { in: ['IN_PROGRESS', 'PENDING'] },
              stepDefinition:     { stepType: 'APPROVAL' },
            },
            include: { stepDefinition: true },
          })
          if (!activeApprovalStep) return

          const engine = new WorkflowEngine(prisma)
          await engine.completeStep(
            activeApprovalStep.id,
            stepResult,
            session.userId!,
            `Entity status changed to ${entity.status}`,
          )
        } catch (err) {
          console.warn('[entities/PATCH] workflow completeStep non-fatal:', err)
        }
      })()
    }

    // ── Activity log ─────────────────────────────────────────────────────────
    const FIELD_LABEL: Record<string, string> = {
      name: 'Legal name', jurisdiction: 'Jurisdiction', registrationNo: 'Registration No.',
      incorporationDate: 'Incorporation date', legalStructure: 'Legal structure',
      primaryCurrency: 'Primary currency', status: 'Status',
      stockTicker: 'Stock ticker', parentId: 'Parent entity',
      riskOverride: 'Risk override',
    }
    const fieldList = changedFields.map(f => FIELD_LABEL[f] ?? f).join(', ')

    await prisma.entityActivityLog.create({
      data: {
        entityId,
        orgId:        orgId,
        activityType: changedFields.includes('status') ? 'STATUS_CHANGE' : 'NOTE',
        title:        `Entity details updated`,
        description:  `Updated: ${fieldList}`,
        performedBy:  session.name ?? session.email ?? session.userId,
        occurredAt:   new Date(),
      },
    })

    // Recompute risk band asynchronously after entity update
    void updateEntityRisk(entityId, prisma).catch(console.error)

    // Fire-and-forget workflow trigger on status change
    if (changedFields.includes('status')) {
      void (async () => {
        try {
          const engine = new WorkflowEngine(prisma)
          const entityData = { entity: { id: entity.id, name: entity.name, status: entity.status, legalStructure: entity.legalStructure } }
          const templateId = await selectTemplate('STATUS_CHANGED', 'ENTITY', entityData, orgId, prisma)
          if (templateId) {
            await engine.startWorkflow(templateId, 'ENTITY', entity.id, orgId, entityData)
          }
        } catch (err) {
          console.warn('[WorkflowEngine] Failed to start workflow for entity status change:', err)
        }
      })()
    }

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]')
  }
}
