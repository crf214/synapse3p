// src/app/api/admin/invite-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { Resend } from 'resend'

const VALID_ROLES = ['ADMIN','AP_CLERK','FINANCE_MANAGER','CONTROLLER','CFO','AUDITOR','LEGAL','CISO'] as const

const CreateTokenSchema = z.object({
  email:         z.string().email().optional(),
  role:          z.enum(VALID_ROLES).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(7),
})

const FROM    = process.env.RESEND_FROM_EMAIL  ?? 'noreply@synapse3p.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

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
    const { email, role, expiresInDays } = parsed.data

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const inviteRecord = await prisma.inviteToken.create({
      data: {
        email:     email ?? null,
        role:      role  ?? null,
        expiresAt,
        createdBy: session.userId,
        orgId:     session.orgId,
      },
    })

    // Send invitation email if an address was provided
    if (email && process.env.RESEND_API_KEY) {
      const resend     = new Resend(process.env.RESEND_API_KEY)
      const registerUrl = `${APP_URL}/auth/register?token=${inviteRecord.token}`

      await resend.emails.send({
        from:    FROM,
        to:      email,
        subject: "You've been invited to Synapse3P",
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #fff;">
            <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">You've been invited</div>
            <p style="color: #555; margin: 0 0 24px;">
              You've been invited to join Synapse3P${role ? ` as <strong>${role.replace(/_/g, ' ')}</strong>` : ''}.
              Click the button below to create your account. This invitation expires in ${expiresInDays} day${expiresInDays !== 1 ? 's' : ''}.
            </p>
            <a href="${registerUrl}"
               style="display: inline-block; background: #111; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
              Create account
            </a>
            <p style="color: #aaa; font-size: 12px; margin-top: 32px;">
              If you weren't expecting this invitation, you can safely ignore this email.
            </p>
          </div>
        `,
      }).catch(err => console.error('[invite] Failed to send invitation email:', err))
    }

    return NextResponse.json({ token: inviteRecord }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/admin/invite-tokens')
  }
}
