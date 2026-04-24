// src/app/api/approval-workflows/[id]/route.ts — PUT (update) + DELETE (deactivate)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { Prisma } from '@prisma/client'

const WRITE_ROLES = new Set(['ADMIN'])

interface WorkflowStep { step: number; role: string; label: string }

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const existing = await prisma.approvalWorkflow.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Approval workflow not found')

    const body = await req.json() as {
      name?:           string
      description?:    string
      thresholdMin?:   number
      thresholdMax?:   number | null
      spendCategories?: string[]
      departments?:    string[]
      steps?:          WorkflowStep[]
      isActive?:       boolean
    }

    const updates: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = sanitiseString(body.name, 200).trim()
      if (!name) throw new ValidationError('name cannot be empty')
      updates.name = name
    }
    if (body.description    !== undefined) updates.description    = sanitiseString(body.description ?? '', 1000).trim() || null
    if (body.thresholdMin   !== undefined) updates.thresholdMin   = Number(body.thresholdMin)
    if (body.thresholdMax   !== undefined) updates.thresholdMax   = body.thresholdMax != null ? Number(body.thresholdMax) : null
    if (body.isActive       !== undefined) updates.isActive       = body.isActive
    if (body.spendCategories !== undefined) {
      updates.spendCategories = body.spendCategories.map(s => sanitiseString(s, 100).trim()).filter(Boolean)
    }
    if (body.departments !== undefined) {
      updates.departments = body.departments.map(s => sanitiseString(s, 100).trim()).filter(Boolean)
    }
    if (body.steps !== undefined) {
      if (!body.steps.length) throw new ValidationError('At least one step is required')
      updates.steps = body.steps.map((s, i) => {
        const label = sanitiseString(s.label ?? '', 100).trim()
        const role  = sanitiseString(s.role  ?? '',  50).trim()
        if (!role)  throw new ValidationError(`Step ${i + 1}: role is required`)
        if (!label) throw new ValidationError(`Step ${i + 1}: label is required`)
        return { step: i + 1, role, label }
      }) as unknown as Prisma.InputJsonValue
    }

    const updated = await prisma.approvalWorkflow.update({
      where: { id },
      data:  updates,
    })

    return NextResponse.json({ workflow: updated })
  } catch (err) {
    return handleApiError(err, 'PUT /api/approval-workflows/[id]')
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const existing = await prisma.approvalWorkflow.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Approval workflow not found')

    // Soft delete — deactivate rather than destroy (preserves audit trail on existing POs)
    await prisma.approvalWorkflow.update({
      where: { id },
      data:  { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/approval-workflows/[id]')
  }
}
