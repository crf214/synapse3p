// GET  — list all onboarding workflows for the org
// POST — create a new workflow

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { VALID_STEP_TYPES, VALID_OPERATORS, type RuleCondition, type StepDef } from '@/lib/workflow-steps'

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const VALID_ENTITY_TYPES = new Set(['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER'])

function validateSteps(steps: unknown): StepDef[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ValidationError('Workflow must have at least one step')
  }
  return steps.map((s: Record<string, unknown>, i: number) => {
    if (!s.title?.toString().trim()) throw new ValidationError(`Step ${i + 1}: title is required`)
    if (!VALID_STEP_TYPES.has(s.type as string)) throw new ValidationError(`Step ${i + 1}: invalid type "${s.type}"`)

    const stepType = s.type as string
    const isAutoStep = stepType === 'PROCESSING_RULE' || stepType === 'SUB_WORKFLOW'

    // ownerRole required for human steps; optional for auto-evaluated steps
    if (!isAutoStep && !s.ownerRole?.toString().trim()) {
      throw new ValidationError(`Step ${i + 1}: ownerRole is required`)
    }

    const base: StepDef = {
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

export async function GET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const workflows = await prisma.onboardingWorkflow.findMany({
      where:   { orgId: session.orgId },
      orderBy: [{ workflowType: 'asc' }, { isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, name: true, description: true, workflowType: true, entityTypes: true,
        isActive: true, steps: true, createdAt: true, updatedAt: true,
        _count: { select: { instances: true } },
      },
    })

    return NextResponse.json({ workflows })
  } catch (err) {
    return handleApiError(err, 'GET /api/onboarding-workflows')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json()
    const { name, description, workflowType, entityTypes, steps } = body

    if (!name?.trim()) throw new ValidationError('name is required')

    const VALID_WORKFLOW_TYPES = new Set(['ENTITY', 'INVOICE', 'PURCHASE_ORDER', 'OTHER'])
    const resolvedType = VALID_WORKFLOW_TYPES.has(workflowType) ? workflowType : 'ENTITY'

    const entityTypeList: string[] = resolvedType === 'ENTITY'
      ? (entityTypes ?? []).filter((t: string) => VALID_ENTITY_TYPES.has(t))
      : []
    const validatedSteps = validateSteps(steps)

    const workflow = await prisma.onboardingWorkflow.create({
      data: {
        orgId:        session.orgId,
        name:         sanitiseString(name, 200),
        description:  description ? sanitiseString(description, 500) : null,
        workflowType: resolvedType as never,
        entityTypes:  entityTypeList as never,
        steps:        validatedSteps as never,
        isActive:     true,
        createdBy:    session.userId,
      },
    })

    return NextResponse.json({ workflow }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/onboarding-workflows')
  }
}
