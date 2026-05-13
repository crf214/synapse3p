// src/app/api/merged-authorizations/route.ts
// GET  — paginated list of merged authorizations for the org
// POST — create a new merged authorization batch

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateMergedAuthorizationSchema = z.object({
  items: z.array(z.object({
    invoiceId: z.string().min(1),
  })).min(2),
  name:  z.string().optional(),
  notes: z.string().optional(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const CREATE_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = 50
    const status   = searchParams.get('status') ?? ''

    const where = {
      orgId: session.orgId,
      ...(status ? { status: status as never } : {}),
    }

    const [total, rows] = await Promise.all([
      prisma.mergedAuthorization.count({ where }),
      prisma.mergedAuthorization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: {
            select: { id: true, amount: true },
          },
        },
      }),
    ])

    // Batch-fetch creator/approver names
    const userIds = new Set<string>()
    for (const r of rows) {
      userIds.add(r.createdBy)
      if (r.approvedBy) userIds.add(r.approvedBy)
    }
    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const batches = rows.map(r => ({
      id:          r.id,
      reference:   r.reference,
      name:        r.name,
      totalAmount: Number(r.totalAmount),
      currency:    r.currency,
      status:       r.status,
      itemCount:    r.items.length,
      createdAt:    r.createdAt.toISOString(),
      approvedAt:   r.approvedAt?.toISOString() ?? null,
      creator:      userMap[r.createdBy] ?? null,
      approver:     r.approvedBy ? (userMap[r.approvedBy] ?? null) : null,
    }))

    return NextResponse.json({ batches, total })
  } catch (err) {
    return handleApiError(err, 'GET /api/merged-authorizations')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    if (!CREATE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const orgId = session.orgId

    const rawBody = await req.json()
    const parsed = CreateMergedAuthorizationSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { items: itemsInput, name, notes } = parsed.data

    const invoiceIds = itemsInput.map(i => i.invoiceId)

    // Load invoices — must all belong to the org and be APPROVED or MATCHED
    const invoices = await prisma.invoice.findMany({
      where: {
        id:    { in: invoiceIds },
        orgId,
        status: { in: ['APPROVED', 'MATCHED'] },
      },
      select: { id: true, amount: true, currency: true },
    })

    if (invoices.length !== invoiceIds.length) {
      throw new ValidationError('Some invoices were not found, do not belong to your organisation, or are not in APPROVED/MATCHED status')
    }

    // Check none are already in a batch
    const existing = await prisma.mergedAuthItem.findFirst({
      where: { invoiceId: { in: invoiceIds } },
    })
    if (existing) throw new ValidationError('One or more invoices are already part of another merged authorization')

    // All must share the same currency
    const currencies = new Set(invoices.map(i => i.currency))
    if (currencies.size > 1) throw new ValidationError('All invoices must share the same currency')

    const currency = invoices[0].currency

    // Build invoice map and compute total
    const invoiceMap  = Object.fromEntries(invoices.map(i => [i.id, i]))
    const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.amount), 0)

    // Generate a reference
    const dateStr   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countToday = await prisma.mergedAuthorization.count({
      where: { orgId, createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
    })
    const reference = `MA-${dateStr}-${String(countToday + 1).padStart(3, '0')}`

    const batch = await prisma.$transaction(async tx => {
      const ma = await tx.mergedAuthorization.create({
        data: {
          orgId,
          reference,
          name:      name ? sanitiseString(name) : null,
          totalAmount,
          currency,
          status:    'DRAFT',
          createdBy: session.userId!,
          notes:     notes ? sanitiseString(notes) : null,
        },
      })

      await tx.mergedAuthItem.createMany({
        data: itemsInput.map(item => ({
          mergedAuthId: ma.id,
          invoiceId:    item.invoiceId,
          amount:       Number(invoiceMap[item.invoiceId].amount),
        })),
      })

      return ma
    }, { timeout: 15000 })

    return NextResponse.json({ id: batch.id, reference: batch.reference }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/merged-authorizations')
  }
}
