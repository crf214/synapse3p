// src/app/api/admin/invite-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const CreateTokenSchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(90).default(7),
})

export async function GET(_req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const tokens = await prisma.inviteToken.findMany({
      where: { orgId: session.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ tokens })
  } catch (err) {
    return handleApiError(err, 'GET /api/admin/invite-tokens')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const body = await req.json()
    const parsed = CreateTokenSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }
    const { email, expiresInDays } = parsed.data

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const token = await prisma.inviteToken.create({
      data: {
        email: email ?? null,
        expiresAt,
        createdBy: session.userId,
        orgId: session.orgId,
      },
    })
    return NextResponse.json({ token }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/admin/invite-tokens')
  }
}
