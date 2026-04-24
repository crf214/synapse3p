// src/app/api/merged-authorizations/route.ts
// GET  — paginated list of merged authorizations for the org
// POST — create a new merged authorization batch

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const CREATE_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = 50
    const status   = searchParams.get('status') ?? ''

    const where = {
      orgId: session.orgId!,
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
            select: { id: true, isCredit: true, amount: true },
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
      id:           r.id,
      reference:    r.reference,
      name:         r.name,
      totalAmount:  Number(r.totalAmount),
      creditAmount: Number(r.creditAmount),
      netAmount:    Number(r.netAmount),
      currency:     r.currency,
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
    if (!CREATE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json()
    const { items: itemsInput, name, notes } = body as {
      items: Array<{ invoiceId: string; isCredit?: boolean }>
      name?: string
      notes?: string
    }

    if (!Array.isArray(itemsInput) || itemsInput.length < 2) {
      throw new ValidationError('At least 2 invoices are required to create a merged authorization')
    }

    const invoiceIds = itemsInput.map(i => i.invoiceId)

    // Load invoices — must all belong to the org and be APPROVED or MATCHED
    const invoices = await prisma.invoice.findMany({
      where: {
        id:    { in: invoiceIds },
        orgId: session.orgId!,
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

    // Build invoice map and apply isCredit from request body
    const invoiceMap = Object.fromEntries(invoices.map(i => [i.id, i]))
    const resolvedItems = itemsInput.map(item => ({
      ...invoiceMap[item.invoiceId],
      isCredit: item.isCredit ?? false,
    }))

    // Compute totals
    let totalAmount  = 0
    let creditAmount = 0
    for (const inv of resolvedItems) {
      const amt = Number(inv.amount)
      if (inv.isCredit) creditAmount += amt
      else              totalAmount  += amt
    }
    const netAmount = totalAmount - creditAmount

    // Generate a reference
    const dateStr   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countToday = await prisma.mergedAuthorization.count({
      where: { orgId: session.orgId!, createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
    })
    const reference = `MA-${dateStr}-${String(countToday + 1).padStart(3, '0')}`

    const batch = await prisma.$transaction(async tx => {
      const ma = await tx.mergedAuthorization.create({
        data: {
          orgId:        session.orgId!,
          reference,
          name:         name ? sanitiseString(name) : null,
          totalAmount,
          creditAmount,
          netAmount,
          currency,
          status:       'DRAFT',
          createdBy:    session.userId!,
          notes:        notes ? sanitiseString(notes) : null,
        },
      })

      await tx.mergedAuthItem.createMany({
        data: resolvedItems.map(inv => ({
          mergedAuthId: ma.id,
          invoiceId:    inv.id,
          isCredit:     inv.isCredit,
          amount:       Number(inv.amount),
        })),
      })

      return ma
    }, { timeout: 15000 })

    return NextResponse.json({ id: batch.id, reference: batch.reference }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/merged-authorizations')
  }
}
