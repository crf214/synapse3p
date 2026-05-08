// PUT    — update a catalogue node (ADMIN only)
// DELETE — deactivate if in use, hard delete otherwise (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const existing = await prisma.serviceCatalogue.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('Catalogue entry not found')

    const body = await req.json()
    const updates: Record<string, unknown> = {}

    if ('name' in body) {
      const name = sanitiseString(body.name ?? '', 200)
      if (!name) throw new ValidationError('name cannot be empty')
      updates.name = name
    }
    if ('description' in body) {
      updates.description = body.description ? sanitiseString(body.description as string, 500) : null
    }
    if ('isActive' in body) {
      updates.isActive = Boolean(body.isActive)
    }
    if ('sortOrder' in body) {
      updates.sortOrder = Number(body.sortOrder)
    }

    const entry = await prisma.serviceCatalogue.update({ where: { id }, data: updates })
    return NextResponse.json({ entry })
  } catch (err) {
    return handleApiError(err, 'PUT /api/service-catalogue/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const existing = await prisma.serviceCatalogue.findUnique({
      where:  { id },
      select: { id: true, _count: { select: { engagements: true, children: true } } },
    })
    if (!existing) throw new NotFoundError('Catalogue entry not found')

    if (existing._count.engagements > 0 || existing._count.children > 0) {
      await prisma.serviceCatalogue.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json({ deactivated: true, reason: 'Entry has children or engagements and was deactivated instead' })
    }

    await prisma.serviceCatalogue.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/service-catalogue/[id]')
  }
}
