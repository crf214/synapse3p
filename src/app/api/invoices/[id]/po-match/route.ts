// src/app/api/invoices/[id]/po-match/route.ts
// GET — compute a live three-way match result for a PO-linked invoice

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { performThreeWayMatch } from '@/lib/matching/three-way-match'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where:  { id, orgId: session.orgId },
      select: { id: true, poId: true, matchType: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    if (!invoice.poId) {
      return NextResponse.json({ match: null, currentMatchType: invoice.matchType })
    }

    const result = await performThreeWayMatch(invoice.poId, invoice.id, prisma)
    return NextResponse.json({ match: result, currentMatchType: invoice.matchType })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/[id]/po-match')
  }
}
