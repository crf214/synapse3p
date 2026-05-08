// src/app/api/merged-authorizations/[id]/submit/route.ts
// POST — submit a DRAFT merged authorization for approval

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const SUBMIT_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!SUBMIT_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const ma = await prisma.mergedAuthorization.findUnique({
      where:   { id },
      include: { items: { select: { id: true } } },
    })
    if (!ma || ma.orgId !== session.orgId) throw new NotFoundError('Merged authorization not found')
    if (ma.status !== 'DRAFT') {
      throw new ValidationError(`Only DRAFT merged authorizations can be submitted (current: ${ma.status})`)
    }
    if (ma.items.length < 2) {
      throw new ValidationError('A merged authorization must contain at least 2 invoices before submission')
    }

    await prisma.mergedAuthorization.update({
      where: { id },
      data:  { status: 'PENDING_APPROVAL' },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/merged-authorizations/[id]/submit')
  }
}
