// src/app/api/invoices/quarantine/route.ts — GET quarantined duplicate flags

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES
const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const sp    = req.nextUrl.searchParams
    const page  = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const status = sp.get('status') ?? 'QUARANTINED'  // default to active quarantine

    const where = {
      orgId:   session.orgId,
      status:  status as never,
      invoice: { orgId: session.orgId },
    }

    const [total, flags] = await Promise.all([
      prisma.invoiceDuplicateFlag.count({ where }),
      prisma.invoiceDuplicateFlag.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          invoice: {
            include: {
              entity: { select: { name: true, slug: true } },
              ingestionEvent: { select: { fromEmail: true, subject: true, receivedAt: true } },
            },
          },
          duplicateOf: {
            select: { id: true, invoiceNo: true, amount: true, currency: true, invoiceDate: true },
          },
        },
      }),
    ])

    const data = flags.map(f => ({
      id:                   f.id,
      invoiceId:            f.invoiceId,
      invoiceNo:            f.invoice.invoiceNo,
      vendorName:           f.invoice.entity.name,
      amount:               f.invoice.amount,
      currency:             f.invoice.currency,
      status:               f.status,
      detectedAt:           f.detectedAt,
      detectedBy:           f.detectedBy,
      signals: {
        invoiceNo:    f.matchedOnInvoiceNo,
        vendorAmount: f.matchedOnVendorAmount,
        pdfHash:      f.matchedOnPdfHash,
        emailMsgId:   f.matchedOnEmailMsgId,
      },
      duplicateOf:          f.duplicateOf,
      overriddenBy:         f.overriddenBy,
      overriddenAt:         f.overriddenAt,
      overrideJustification: f.overrideJustification,
      resolutionNotes:      f.resolutionNotes,
      ingestionEvent:       f.invoice.ingestionEvent,
    }))

    return NextResponse.json({
      flags: data,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/quarantine')
  }
}
