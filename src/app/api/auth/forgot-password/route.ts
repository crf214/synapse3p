// POST /api/auth/forgot-password
// Generates a password reset token and emails the user a reset link.
// Always returns 200 regardless of whether the email exists (prevents enumeration).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/errors'
import { Resend } from 'resend'

const Schema = z.object({ email: z.string().email() })

const FROM    = process.env.RESEND_FROM_EMAIL  ?? 'noreply@synapse3p.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const ALWAYS_OK = NextResponse.json(
  { message: 'If that email exists, a reset link has been sent' },
  { status: 200 },
)

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) return ALWAYS_OK   // don't hint which field is wrong

    const { email } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return ALWAYS_OK

    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken:     token,
        passwordResetExpiresAt: expiresAt,
      },
    })

    const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from:    FROM,
        to:      email,
        subject: 'Reset your Synapse3P password',
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
            <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Reset your password</div>
            <p style="color: #555; margin: 0 0 24px;">
              Hi${user.name ? ` ${user.name}` : ''}, we received a request to reset your Synapse3P password.
              Click the button below to choose a new one. This link expires in 1 hour.
            </p>
            <a href="${resetUrl}"
               style="display: inline-block; background: #111; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
              Reset password
            </a>
            <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
              If you didn't request a password reset, you can safely ignore this email.
              Your password will not change.
            </p>
          </div>
        `,
      })
    }

    return ALWAYS_OK
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/forgot-password')
  }
}
