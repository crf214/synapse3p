// src/app/api/invoices/merge/route.ts
// POST — create a MergedAuthorization from a set of invoice IDs.
// Runs duplicate detection across selected invoices before confirming.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const MergeInvoicesSchema = z.object({
  invoiceIds: z.array(z.string()).min(2),
  name:       z.string().optional(),
  notes:      z.string().optional(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = MergeInvoicesSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    if (body.invoiceIds.length > 50) {
      throw new ValidationError('Cannot merge more than 50 invoices at once')
    }

    // Load and validate all invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        id:    { in: body.invoiceIds },
        orgId: session.orgId,
        status: { notIn: ['DUPLICATE', 'PAID', 'CANCELLED'] },
      },
      include: { duplicateFlags: { where: { status: 'QUARANTINED' } } },
    })

    if (invoices.length !== body.invoiceIds.length) {
      throw new ValidationError('One or more invoices not found or are not eligible for merging (must not be duplicate/paid/cancelled)')
    }

    // Check none are already in a merge
    const alreadyMerged = await prisma.mergedAuthItem.findFirst({
      where: { invoiceId: { in: body.invoiceIds } },
    })
    if (alreadyMerged) {
      throw new ValidationError(`Invoice ${alreadyMerged.invoiceId} is already part of a merged authorization`)
    }

    // Duplicate detection across the selected set (at merge time)
    // Check for duplicate invoiceNo + entityId pairs within the selected set
    const seen = new Map<string, string>()  // key → invoiceId
    for (const inv of invoices) {
      const key = `${inv.entityId}:${inv.invoiceNo}`
      if (seen.has(key)) {
        throw new ValidationError(
          `Duplicate detection: invoice ${inv.id} and ${seen.get(key)} share the same vendor and invoice number. Resolve duplicates before merging.`,
        )
      }
      seen.set(key, inv.id)

      // Check for active quarantine flags
      if (inv.duplicateFlags.length > 0) {
        throw new ValidationError(
          `Invoice ${inv.id} has an active duplicate quarantine flag and cannot be merged until resolved`,
        )
      }
    }

    // Also check pdfFingerprint duplicates within the set
    const fingerprints = invoices.map(i => i.pdfFingerprint).filter(Boolean)
    const uniqueFingerprints = new Set(fingerprints)
    if (fingerprints.length !== uniqueFingerprints.size) {
      throw new ValidationError('Duplicate detection: two or more invoices in this selection have identical PDF fingerprints')
    }

    // Compute total
    const totalAmount = invoices.reduce((s, i) => s + i.amount, 0)

    // All invoices must share a currency (simplification — multi-currency merges require FX conversion)
    const currencies = new Set(invoices.map(i => i.currency))
    if (currencies.size > 1) {
      throw new ValidationError('All invoices in a merge must share the same currency. Multi-currency merging is not yet supported.')
    }
    const currency = [...currencies][0]

    // Generate reference
    const reference = `MERGE-${Date.now()}`
    const name      = body.name ? sanitiseString(body.name, 200) : null
    const notes     = body.notes ? sanitiseString(body.notes, 2000) : null

    const mergedAuth = await prisma.mergedAuthorization.create({
      data: {
        orgId:     session.orgId,
        reference,
        name,
        totalAmount,
        currency,
        status:    'PENDING_APPROVAL',
        createdBy: session.userId!,
        notes,
        items: {
          create: invoices.map(inv => ({
            invoiceId: inv.id,
            amount:    inv.amount,
          })),
        },
      },
      include: { items: true },
    })

    return NextResponse.json({ mergedAuth }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/merge')
  }
}

// ---------------------------------------------------------------------------
// GET — list merged authorizations for the org
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const mergedAuths = await prisma.mergedAuthorization.findMany({
      where:   { orgId: session.orgId },
      orderBy: { createdAt: 'desc' },
      take:    100,
      include: {
        items: {
          include: {
            invoice: {
              select: { id: true, invoiceNo: true, amount: true, currency: true, entity: { select: { name: true } } },
            },
          },
        },
      },
    })

    return NextResponse.json({ mergedAuths })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/merge')
  }
}
