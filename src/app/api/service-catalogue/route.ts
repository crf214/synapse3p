// GET  — list all catalogue entries flat (client builds tree)
// POST — create a new node (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()

    const includeInactive = new URL(req.url).searchParams.get('includeInactive') === 'true'

    const entries = await prisma.serviceCatalogue.findMany({
      where:   includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select:  { id: true, name: true, parentId: true, description: true, isActive: true, sortOrder: true },
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
    const { name, parentId, description, sortOrder } = body

    if (!name?.trim()) throw new ValidationError('name is required')

    // Verify parent exists if provided
    if (parentId) {
      const parent = await prisma.serviceCatalogue.findUnique({ where: { id: parentId } })
      if (!parent) throw new ValidationError('Parent entry not found')
    }

    const entry = await prisma.serviceCatalogue.create({
      data: {
        name:        sanitiseString(name, 200),
        parentId:    parentId ?? null,
        description: description ? sanitiseString(description, 500) : null,
        sortOrder:   sortOrder ?? 0,
      },
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/service-catalogue')
  }
}
