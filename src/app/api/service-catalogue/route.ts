// src/app/api/service-catalogue/route.ts
// GET  — list all active service catalogue entries (for dropdowns)
// POST — create a new catalogue entry (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const VALID_CATEGORIES = [
  'BANKING', 'CUSTODY', 'FUND_ADMIN', 'OUTSOURCING',
  'LEGAL', 'AUDIT', 'TECHNOLOGY', 'COMPLIANCE', 'OTHER',
] as const

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()

    const entries = await prisma.serviceCatalogue.findMany({
      where:   { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select:  { id: true, name: true, category: true, description: true },
    })

    return NextResponse.json({ entries })
  } catch (err) {
    return handleApiError(err, 'GET /api/service-catalogue')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const body = await req.json()
    const { name, category, description } = body

    if (!name?.trim()) throw new ValidationError('name is required')
    if (!VALID_CATEGORIES.includes(category)) {
      throw new ValidationError(`category must be one of: ${VALID_CATEGORIES.join(', ')}`)
    }

    const entry = await prisma.serviceCatalogue.create({
      data: {
        name:        sanitiseString(name),
        category,
        description: description ? sanitiseString(description) : null,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/service-catalogue')
  }
}
