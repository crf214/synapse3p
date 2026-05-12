// POST /api/auth/reset-password
// Validates a reset token and updates the user's password.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const Schema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Validation failed'
      return NextResponse.json({ error: { message: msg } }, { status: 400 })
    }

    const { token, password } = parsed.data

    const user = await prisma.user.findUnique({
      where:  { passwordResetToken: token },
      select: { id: true, orgId: true, passwordResetExpiresAt: true },
    })

    const now = new Date()
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < now) {
      return NextResponse.json(
        { error: { message: 'Reset link is invalid or has expired' } },
        { status: 400 },
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken:     null,
        passwordResetExpiresAt: null,
      },
    })

    void writeAuditEvent(prisma, {
      actorId:    user.id,
      orgId:      user.orgId ?? 'unknown',
      action:     'UPDATE',
      objectType: 'USER',
      objectId:   user.id,
      after:      { field: 'passwordHash', via: 'password-reset' },
    })

    return NextResponse.json({ message: 'Password updated successfully' })
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/reset-password')
  }
}
