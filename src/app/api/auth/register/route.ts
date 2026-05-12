// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'
import { sendVerificationEmail } from '@/lib/resend'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
  inviteToken: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name, inviteToken } = schema.parse(body)

    // Validate invite token
    const invite = await prisma.inviteToken.findUnique({ where: { token: inviteToken } })
    if (
      !invite ||
      invite.usedAt != null ||
      invite.expiresAt < new Date() ||
      (invite.email != null && invite.email.toLowerCase() !== email.toLowerCase())
    ) {
      return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 403 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    const passwordHash = await hash(password, 12)
    const emailVerifyToken = randomBytes(32).toString('hex')

    const user = await prisma.$transaction(async (tx) => {
      const roleToAssign = invite.role ?? 'AP_CLERK'

      const created = await tx.user.create({
        data: {
          email,
          name:             name ?? null,
          passwordHash,
          emailVerified:    false,
          emailVerifyToken,
          orgId:            invite.orgId,
          role:             roleToAssign as never,
        },
      })

      // Create org membership
      await tx.orgMember.create({
        data: {
          orgId:  invite.orgId,
          userId: created.id,
          role:   roleToAssign as never,
          status: 'active',
        },
      })

      await tx.inviteToken.update({
        where: { token: inviteToken },
        data: { usedAt: new Date() },
      })

      await writeAuditEvent(tx, {
        actorId:    created.id,
        orgId:      invite.orgId,
        action:     'CREATE',
        objectType: 'USER',
        objectId:   created.id,
        after:      { inviteTokenUsed: true, emailVerificationSent: true, role: roleToAssign },
      })
      return created
    })

    // Send verification email (non-blocking — log failure but don't fail registration)
    try {
      await sendVerificationEmail({ to: user.email, name: user.name, token: emailVerifyToken })
    } catch (emailErr) {
      console.error('[register] Failed to send verification email:', emailErr)
    }

    return NextResponse.json(
      { data: { message: 'Check your email to verify your account' } },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
