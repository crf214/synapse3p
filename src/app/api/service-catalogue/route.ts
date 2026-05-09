// GET  — list all catalogue entries flat (client builds tree)
// POST — create a new node (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateServiceCatalogueSchema = z.object({
  name:        z.string().min(1),
  parentId:    z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  sortOrder:   z.number().optional(),
})

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

    const rawBody = await req.json()
    const parsed = CreateServiceCatalogueSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { name, parentId, description, sortOrder } = parsed.data

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
