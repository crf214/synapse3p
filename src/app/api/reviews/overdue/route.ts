// src/app/api/reviews/overdue/route.ts — GET list of entities overdue for review

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { getEntitiesDueForReview } from '@/lib/risk/check-review-cadence'

const READ_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const overdue = await getEntitiesDueForReview(session.orgId!, prisma)

    return NextResponse.json({ overdue })
  } catch (err) {
    return handleApiError(err, '')
  }
}
