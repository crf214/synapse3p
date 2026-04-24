// src/app/api/purchase-orders/[id]/amend/route.ts
// POST — create a POAmendment and update the PO.
// Allowed on APPROVED or PARTIALLY_RECEIVED POs.
// If the PO was APPROVED, it resets to PENDING_APPROVAL for re-approval.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const AMEND_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const AMENDABLE   = new Set(['APPROVED', 'PARTIALLY_RECEIVED'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !AMEND_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const po = await prisma.purchaseOrder.findFirst({
      where:   { id, orgId: session.orgId },
      include: {
        amendments: { orderBy: { version: 'desc' }, take: 1 },
        entity:    { select: { id: true } },
      },
    })
    if (!po) throw new NotFoundError('Purchase order not found')
    if (!AMENDABLE.has(po.status)) {
      throw new ValidationError(`Cannot amend a PO with status ${po.status}. Only APPROVED or PARTIALLY_RECEIVED POs can be amended.`)
    }

    const body = await req.json() as {
      reason: string
      changes: {
        title?:       string
        description?: string
        totalAmount?: number
        validTo?:     string | null
        notes?:       string
      }
    }

    const reason = sanitiseString(body.reason ?? '', 1000).trim()
    if (!reason) throw new ValidationError('reason is required for amendments')
    if (!body.changes || Object.keys(body.changes).length === 0) {
      throw new ValidationError('At least one field must be changed in an amendment')
    }

    const nextVersion = (po.amendments[0]?.version ?? po.currentVersion) + 1

    // Build previousValues and newValues
    const changedFields: string[] = []
    const previousValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown>      = {}
    const updateData: Record<string, unknown>     = {}

    if (body.changes.title !== undefined) {
      const v = sanitiseString(body.changes.title, 200).trim()
      changedFields.push('title')
      previousValues.title = po.title
      newValues.title      = v
      updateData.title     = v
    }
    if (body.changes.description !== undefined) {
      const v = sanitiseString(body.changes.description ?? '', 1000).trim() || null
      changedFields.push('description')
      previousValues.description = po.description
      newValues.description      = v
      updateData.description     = v
    }
    if (body.changes.totalAmount !== undefined) {
      const v = Number(body.changes.totalAmount)
      if (v <= 0) throw new ValidationError('totalAmount must be positive')
      changedFields.push('totalAmount')
      previousValues.totalAmount = po.totalAmount
      newValues.totalAmount      = v
      updateData.totalAmount     = v
    }
    if (body.changes.validTo !== undefined) {
      const v = body.changes.validTo ? new Date(body.changes.validTo) : null
      changedFields.push('validTo')
      previousValues.validTo = po.validTo?.toISOString() ?? null
      newValues.validTo      = v?.toISOString() ?? null
      updateData.validTo     = v
    }
    if (body.changes.notes !== undefined) {
      const v = sanitiseString(body.changes.notes ?? '', 2000).trim() || null
      changedFields.push('notes')
      previousValues.notes = po.notes
      newValues.notes      = v
      updateData.notes     = v
    }

    if (changedFields.length === 0) throw new ValidationError('No valid fields to amend')

    // If PO was APPROVED, re-submit for approval
    const requiresReApproval = po.status === 'APPROVED'
    if (requiresReApproval) {
      updateData.status = 'PENDING_APPROVAL'
    }
    updateData.currentVersion = nextVersion

    await prisma.$transaction(async (tx) => {
      await tx.pOAmendment.create({
        data: {
          poId:           id,
          version:        nextVersion,
          changedFields:  changedFields as unknown as never,
          previousValues: previousValues as unknown as never,
          newValues:      newValues      as unknown as never,
          reason,
          amendedBy:      session.userId!,
        },
      })

      await tx.purchaseOrder.update({ where: { id }, data: updateData })

      await tx.entityActivityLog.create({
        data: {
          entityId:    po.entityId,
          orgId:       session.orgId!,
          activityType: 'NOTE' as never,
          title:       `PO amended (v${nextVersion}): ${po.poNumber}`,
          description: `Changed: ${changedFields.join(', ')}. Reason: ${reason}`,
          referenceId:   id,
          referenceType: 'PurchaseOrder',
          performedBy:   session.userId,
        },
      })
    })

    const updated = await prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        lineItems:  { orderBy: { lineNo: 'asc' } },
        amendments: { orderBy: { version: 'asc' } },
        approvals:  { orderBy: { step: 'asc' } },
      },
    })

    return NextResponse.json({ purchaseOrder: updated, requiresReApproval })
  } catch (err) {
    return handleApiError(err, 'POST /api/purchase-orders/[id]/amend')
  }
}
