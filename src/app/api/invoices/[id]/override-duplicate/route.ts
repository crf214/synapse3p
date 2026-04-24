// src/app/api/invoices/[id]/override-duplicate/route.ts
// POST — override a QUARANTINED duplicate flag.
// Requires a non-null justification (enforced here + DB stores it permanently).
// All overrides are visible in the audit trail.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

// Only senior roles may override a duplicate quarantine — this is a financial control.
const OVERRIDE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !OVERRIDE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as { flagId: string; justification: string }

    if (!body.flagId) throw new ValidationError('flagId is required')

    const justification = sanitiseString(body.justification ?? '', 2000).trim()
    if (!justification || justification.length < 10) {
      throw new ValidationError('A written justification of at least 10 characters is required to override a duplicate flag')
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, orgId: session.orgId },
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
    ])

    // The invoice will now appear in the main queue with DUPLICATE_FLAG signal triggered
    // (the risk pipeline already set it; no need to re-run)

    return NextResponse.json({ ok: true, flagId: flag.id, newStatus: 'OVERRIDE_APPROVED' })
  } catch (err) {
    return handleApiError(err, `POST /api/invoices/${params.id}/override-duplicate`)
  }
}
