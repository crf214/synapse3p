// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/session'
import { writeAuditEvent } from '@/lib/audit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name } = schema.parse(body)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    const passwordHash = await hash(password, 12)

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, name: name ?? null, passwordHash },
      })
      await writeAuditEvent(tx, {
        actorId:    created.id,
        orgId:      '',
        action:     'CREATE',
        objectType: 'USER',
        objectId:   created.id,
      })
      return created
    })

    const res = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name } })
    const session = await getSessionFromRequest(req, res)
    session.userId = user.id
    session.email = user.email
    session.name = user.name
    await session.save()

    return res
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
