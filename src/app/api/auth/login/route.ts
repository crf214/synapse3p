// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAuditEvent } from '@/lib/audit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = schema.parse(body)

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const valid = await compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (!user.emailVerified) {
      return NextResponse.json({ error: 'Please verify your email before logging in.' }, { status: 403 })
    }

    const session = await getSession()
    session.userId = user.id
    session.email = user.email
    session.name = user.name
    session.orgId = user.orgId ?? undefined
    session.role = user.role ?? undefined
    await session.save()

    await writeAuditEvent(prisma, {
      actorId:    user.id,
      orgId:      user.orgId ?? '',
      action:     'LOGIN',
      objectType: 'USER',
      objectId:   user.id,
    })

    return NextResponse.json({
      data: { id: user.id, email: user.email, name: user.name },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
