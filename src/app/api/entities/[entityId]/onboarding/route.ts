import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const DEFAULT_STEPS = [
  { stepNo: 1, title: 'Basic information',          type: 'INFORMATION',    required: true, blocksPayment: true, ownerRole: 'FINANCE_MANAGER', description: 'Verify entity name, legal structure, jurisdiction, registration details' },
  { stepNo: 2, title: 'Legal & compliance review',  type: 'REVIEW',         required: true, blocksPayment: true, ownerRole: 'LEGAL',            description: 'Review legal standing, regulatory compliance, sanctions screening' },
  { stepNo: 3, title: 'Cybersecurity assessment',   type: 'REVIEW',         required: true, blocksPayment: true, ownerRole: 'CISO',             description: 'Assess cybersecurity posture, SOC2/ISO certifications, data handling' },
  { stepNo: 4, title: 'Data privacy review',        type: 'REVIEW',         required: true, blocksPayment: true, ownerRole: 'FINANCE_MANAGER',  description: 'Review GDPR compliance, data processing agreements, privacy controls' },
  { stepNo: 5, title: 'Bank account & payment setup', type: 'INFORMATION',  required: true, blocksPayment: true, ownerRole: 'FINANCE_MANAGER',  description: 'Verify and record bank account details for payment processing' },
  { stepNo: 6, title: 'NetSuite vendor link',       type: 'EXTERNAL_CHECK', required: true, blocksPayment: true, ownerRole: 'FINANCE_MANAGER',  description: 'Match and link this entity to its NetSuite vendor record' },
  { stepNo: 7, title: 'Final approval',             type: 'APPROVAL',       required: true, blocksPayment: true, ownerRole: 'CFO',              description: 'CFO or Controller final sign-off to activate entity for payment' },
]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
      select: { id: true, name: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const instance = await prisma.onboardingInstance.findFirst({
      where: { entityId, orgId: session.orgId },
      include: { workflow: { select: { id: true, name: true, steps: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ instance: instance ?? null, entityName: entity.name })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/onboarding')
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
      include: { classifications: { where: { isPrimary: true }, take: 1, select: { type: true } } },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    // Check if an active instance already exists
    const existing = await prisma.onboardingInstance.findFirst({
      where: { entityId, orgId: session.orgId },
      orderBy: { createdAt: 'desc' },
    })
    if (existing && existing.status !== 'COMPLETED' && existing.status !== 'REJECTED') {
      return NextResponse.json({ instance: existing })
    }

    // Find a matching workflow or create a default one
    const primaryType = entity.classifications[0]?.type ?? null
    let workflow = await prisma.onboardingWorkflow.findFirst({
      where: {
        orgId:    session.orgId,
        isActive: true,
        ...(primaryType ? { entityTypes: { has: primaryType } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!workflow) {
      workflow = await prisma.onboardingWorkflow.create({
        data: {
          orgId:       session.orgId,
          name:        'Standard Onboarding',
          description: 'Default 7-step entity onboarding workflow',
          entityTypes: [],
          steps:       DEFAULT_STEPS,
          isActive:    true,
          createdBy:   session.userId,
        },
      })
    }

    const instance = await prisma.onboardingInstance.create({
      data: {
        entityId,
        orgId:       session.orgId,
        workflowId:  workflow.id,
        status:      'IN_PROGRESS',
        currentStep: 1,
        completedSteps: [],
        startedAt:   new Date(),
        assignedTo:  session.userId,
      },
      include: { workflow: { select: { id: true, name: true, steps: true } } },
    })

    // Update org relationship to IN_PROGRESS
    await prisma.entityOrgRelationship.updateMany({
      where: { entityId, orgId: session.orgId },
      data:  { onboardingStatus: 'IN_PROGRESS' },
    })

    await prisma.entityActivityLog.create({
      data: {
        entityId,
        orgId:        session.orgId,
        activityType: 'ONBOARDING',
        title:        'Onboarding started',
        description:  `7-step onboarding workflow initiated by ${session.email}`,
        performedBy:  session.userId,
        metadata:     { workflowId: workflow.id, instanceId: instance.id },
      },
    })

    return NextResponse.json({ instance }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/onboarding')
  }
}
