// src/app/api/approval-workflows/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { Prisma } from '@prisma/client'

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const WRITE_ROLES = new Set(['ADMIN'])

interface WorkflowStep { step: number; role: string; label: string }

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const workflows = await prisma.approvalWorkflow.findMany({
      where:   { orgId: session.orgId },
      orderBy: { thresholdMin: 'asc' },
    })

    return NextResponse.json({ workflows })
  } catch (err) {
    return handleApiError(err, 'GET /api/approval-workflows')
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as {
      name:            string
      description?:    string
      thresholdMin?:   number
      thresholdMax?:   number | null
      spendCategories?: string[]
      departments?:    string[]
      steps:           WorkflowStep[]
    }

    const name = sanitiseString(body.name ?? '', 200).trim()
    if (!name) throw new ValidationError('name is required')
    if (!body.steps?.length) throw new ValidationError('At least one step is required')

    // Validate steps
    const steps = body.steps.map((s, i) => {
      const label = sanitiseString(s.label ?? '', 100).trim()
      const role  = sanitiseString(s.role  ?? '', 50).trim()
      if (!role)  throw new ValidationError(`Step ${i + 1}: role is required`)
      if (!label) throw new ValidationError(`Step ${i + 1}: label is required`)
      return { step: i + 1, role, label }
    })

    const workflow = await prisma.approvalWorkflow.create({
      data: {
        orgId:           session.orgId,
        name,
        description:     sanitiseString(body.description ?? '', 1000).trim() || null,
        thresholdMin:    Number(body.thresholdMin ?? 0),
        thresholdMax:    body.thresholdMax != null ? Number(body.thresholdMax) : null,
        spendCategories: body.spendCategories?.map(s => sanitiseString(s, 100).trim()).filter(Boolean) ?? [],
        departments:     body.departments?.map(s => sanitiseString(s, 100).trim()).filter(Boolean) ?? [],
        steps:           steps as unknown as Prisma.InputJsonValue,
        isActive:        true,
        createdBy:       session.userId,
      },
    })

    return NextResponse.json({ workflow }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/approval-workflows')
  }
}
