// src/app/api/invoices/[id]/override-duplicate/route.ts
// POST — override a QUARANTINED duplicate flag.
// Requires a non-null justification (enforced here + DB stores it permanently).
// All overrides are visible in the audit trail.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const OverrideDuplicateSchema = z.object({
  flagId:        z.string().min(1),
  justification: z.string().min(1),
})

// Only senior roles may override a duplicate quarantine — this is a financial control.
const OVERRIDE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !OVERRIDE_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = OverrideDuplicateSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const justification = sanitiseString(body.justification ?? '', 2000).trim()
    if (justification.length < 10) {
      throw new ValidationError('A written justification of at least 10 characters is required to override a duplicate flag')
    }

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const flag = await prisma.invoiceDuplicateFlag.findFirst({
      where: { id: body.flagId, invoiceId: invoice.id, status: 'QUARANTINED' },
    })
    if (!flag) throw new NotFoundError('Quarantined duplicate flag not found on this invoice')

    await prisma.$transaction([
      // Update the flag — justification stored permanently
      prisma.invoiceDuplicateFlag.update({
        where: { id: flag.id },
        data:  {
          status:               'OVERRIDE_APPROVED',
          overriddenBy:         session.userId,
          overriddenAt:         new Date(),
          overrideJustification: justification,
        },
      }),
      // Release the invoice back into the queue
      prisma.invoice.update({
        where: { id: invoice.id },
        data:  { status: 'PENDING_REVIEW' },
      }),
      prisma.auditEvent.create({
        data: {
          orgId:      orgId,
          actorId:    session.userId!,
          action:     'OVERRIDE',
          entityType: 'INVOICE',
          entityId:   invoice.id,
        },
      }),
    ])

    // The invoice will now appear in the main queue with DUPLICATE_FLAG signal triggered
    // (the risk pipeline already set it; no need to re-run)

    return NextResponse.json({ ok: true, flagId: flag.id, newStatus: 'OVERRIDE_APPROVED' })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/[id]/override-duplicate')
  }
}
