// GET    — single workflow detail
// PUT    — update workflow (name, description, entityTypes, steps, isActive)
// DELETE — deactivate (soft delete if instances exist, hard delete otherwise)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { VALID_STEP_TYPES, VALID_OPERATORS, type RuleCondition } from '@/lib/workflow-steps'

const UpdateOnboardingWorkflowSchema = z.object({
  name:          z.string().optional(),
  description:   z.string().nullable().optional(),
  entityTypes:   z.array(z.string()).optional(),
  steps:         z.array(z.unknown()).optional(),
  isActive:      z.boolean().optional(),
  workflowType:  z.string().optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const VALID_ENTITY_TYPES = new Set(['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER'])

type RouteParams = { params: Promise<{ id: string }> }

function validateSteps(steps: unknown) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ValidationError('Workflow must have at least one step')
  }
  return steps.map((s: Record<string, unknown>, i: number) => {
    if (!s.title?.toString().trim()) throw new ValidationError(`Step ${i + 1}: title is required`)
    if (!VALID_STEP_TYPES.has(s.type as string)) throw new ValidationError(`Step ${i + 1}: invalid type "${s.type}"`)

    const stepType = s.type as string
    const isAutoStep = stepType === 'PROCESSING_RULE' || stepType === 'SUB_WORKFLOW'

    if (!isAutoStep && !s.ownerRole?.toString().trim()) {
      throw new ValidationError(`Step ${i + 1}: ownerRole is required`)
    }

    const base: Record<string, unknown> = {
      stepNo:        i + 1,
      title:         sanitiseString(s.title as string, 200),
      type:          stepType,
      required:      Boolean(s.required ?? true),
      blocksPayment: Boolean(s.blocksPayment ?? false),
      ownerRole:     isAutoStep ? 'SYSTEM' : sanitiseString(s.ownerRole as string, 50),
      description:   s.description ? sanitiseString(s.description as string, 500) : '',
      parallelGroup: s.parallelGroup != null ? Number(s.parallelGroup) : null,
    }

    if (stepType === 'PROCESSING_RULE') {
      const rules = Array.isArray(s.rules) ? s.rules : []
      const validatedRules: RuleCondition[] = rules.map((r: Record<string, unknown>, ri: number) => {
        if (!r.field)    throw new ValidationError(`Step ${i + 1}, rule ${ri + 1}: field is required`)
        if (!VALID_OPERATORS.has(r.operator as string)) throw new ValidationError(`Step ${i + 1}, rule ${ri + 1}: invalid operator`)
        if (r.value == null) throw new ValidationError(`Step ${i + 1}, rule ${ri + 1}: value is required`)
        if (!r.nextStep || isNaN(Number(r.nextStep))) throw new ValidationError(`Step ${i + 1}, rule ${ri + 1}: nextStep must be a valid step number`)
        return {
          id:       sanitiseString((r.id as string) || String(ri), 50),
          field:    sanitiseString(r.field as string, 100),
          operator: r.operator as string,
          value:    sanitiseString(String(r.value), 200),
          nextStep: Number(r.nextStep),
        }
      })
      base.rules = validatedRules
      base.defaultNextStep = s.defaultNextStep != null ? Number(s.defaultNextStep) : null
    }

    if (stepType === 'SUB_WORKFLOW') {
      if (!s.subWorkflowId) throw new ValidationError(`Step ${i + 1}: subWorkflowId is required for SUB_WORKFLOW steps`)
      base.subWorkflowId     = sanitiseString(s.subWorkflowId as string, 200)
      base.waitForCompletion = Boolean(s.waitForCompletion ?? true)
    }

    return base
  })
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const workflow = await prisma.onboardingWorkflow.findFirst({
      where: { id, orgId: session.orgId },
      include: { _count: { select: { instances: true } } },
    })
    if (!workflow) throw new NotFoundError('Workflow not found')

    return NextResponse.json({ workflow })
  } catch (err) {
    return handleApiError(err, 'GET /api/onboarding-workflows/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const existing = await prisma.onboardingWorkflow.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Workflow not found')

    const rawBody = await req.json()
    const parsed = UpdateOnboardingWorkflowSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const updates: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = sanitiseString(body.name ?? '', 200)
      if (!name) throw new ValidationError('name cannot be empty')
      updates.name = name
    }
    if (body.description !== undefined) {
      updates.description = body.description ? sanitiseString(body.description, 500) : null
    }
    if (body.entityTypes !== undefined) {
      updates.entityTypes = body.entityTypes.filter((t: string) => VALID_ENTITY_TYPES.has(t))
    }
    if (body.steps !== undefined) {
      updates.steps = validateSteps(body.steps)
    }
    if (body.isActive !== undefined) {
      updates.isActive = Boolean(body.isActive)
    }
    if (body.workflowType !== undefined) {
      const VALID = new Set(['ENTITY', 'INVOICE', 'PURCHASE_ORDER', 'OTHER'])
      if (!VALID.has(body.workflowType)) throw new ValidationError('Invalid workflowType')
      updates.workflowType = body.workflowType
    }

    const workflow = await prisma.onboardingWorkflow.update({
      where: { id },
      data: updates,
      include: { _count: { select: { instances: true } } },
    })
    return NextResponse.json({ workflow })
  } catch (err) {
    return handleApiError(err, 'PUT /api/onboarding-workflows/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const existing = await prisma.onboardingWorkflow.findFirst({
      where:   { id, orgId: session.orgId },
      include: { _count: { select: { instances: true } } },
    })
    if (!existing) throw new NotFoundError('Workflow not found')

    if (existing._count.instances > 0) {
      await prisma.onboardingWorkflow.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json({ deactivated: true, reason: 'Workflow has existing instances and was deactivated instead' })
    }

    await prisma.onboardingWorkflow.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/onboarding-workflows/[id]')
  }
}
