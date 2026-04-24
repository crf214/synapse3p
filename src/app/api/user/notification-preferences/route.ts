// src/app/api/user/notification-preferences/route.ts
// GET/PUT the current user's invoice notification preferences.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ValidationError } from '@/lib/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: session.userId },
    })

    // Return defaults if no preference row exists yet
    return NextResponse.json({
      preferences: pref ?? {
        emailOnInvoiceRouted: true,
        reminderEnabled:      true,
        reminderAfterDays:    3,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/user/notification-preferences')
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const body = await req.json() as {
      emailOnInvoiceRouted?: boolean
      reminderEnabled?:      boolean
      reminderAfterDays?:    number
    }

    if (body.reminderAfterDays !== undefined) {
      const days = Number(body.reminderAfterDays)
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw new ValidationError('reminderAfterDays must be an integer between 1 and 30')
      }
    }

    const pref = await prisma.notificationPreference.upsert({
      where:  { userId: session.userId },
      create: {
        userId:               session.userId,
        orgId:                session.orgId,
        emailOnInvoiceRouted: body.emailOnInvoiceRouted ?? true,
        reminderEnabled:      body.reminderEnabled ?? true,
        reminderAfterDays:    body.reminderAfterDays ?? 3,
      },
      update: {
        ...(body.emailOnInvoiceRouted !== undefined ? { emailOnInvoiceRouted: body.emailOnInvoiceRouted } : {}),
        ...(body.reminderEnabled      !== undefined ? { reminderEnabled:      body.reminderEnabled }      : {}),
        ...(body.reminderAfterDays    !== undefined ? { reminderAfterDays:    body.reminderAfterDays }    : {}),
      },
    })

    return NextResponse.json({ preferences: pref })
  } catch (err) {
    return handleApiError(err, 'PUT /api/user/notification-preferences')
  }
}
