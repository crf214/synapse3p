import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getErpAdapter } from '@/lib/erp'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const READ_ROLES = APPROVAL_ROLES

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const ENTITY_CAP = 500

    const entities = await prisma.entity.findMany({
      where:   { masterOrgId: session.orgId, status: { not: 'OFFBOARDED' } },
      select:  { id: true, name: true, slug: true, jurisdiction: true, metadata: true },
      orderBy: { name: 'asc' },
      take:    ENTITY_CAP,
    })
    const entitiesCapped = entities.length === ENTITY_CAP

    // Split into linked vs unlinked
    const matched: Array<{ entityId: string; entityName: string; jurisdiction: string | null; erpVendorId: string; erpVendorName: string; erpLinkedAt: string | null }> = []
    const unmatchedSynapse: Array<{ entityId: string; entityName: string; slug: string; jurisdiction: string | null }> = []

    for (const e of entities) {
      const meta = (e.metadata ?? {}) as Record<string, unknown>
      if (meta.erpVendorId && meta.erpVendorName) {
        matched.push({
          entityId:    e.id,
          entityName:  e.name,
          jurisdiction: e.jurisdiction,
          erpVendorId:   String(meta.erpVendorId),
          erpVendorName: String(meta.erpVendorName),
          erpLinkedAt:   meta.erpLinkedAt ? String(meta.erpLinkedAt) : null,
        })
      } else {
        unmatchedSynapse.push({ entityId: e.id, entityName: e.name, slug: e.slug, jurisdiction: e.jurisdiction })
      }
    }

    // NetSuite vendors not linked to any entity (cap at 500)
    const VENDOR_CAP = 500
    const linkedErpIds = new Set(matched.map(m => m.erpVendorId))
    const adapter = getErpAdapter()
    const allVendorsRaw = await adapter.getVendors()
    const allVendors = allVendorsRaw.slice(0, VENDOR_CAP)
    const vendorsCapped = allVendorsRaw.length > VENDOR_CAP
    const unmatchedNetsuite = allVendors
      .filter(v => v.isActive && !linkedErpIds.has(v.erpId))
      .map(v => ({ erpId: v.erpId, erpName: v.name, currency: v.currency }))

    const capped = entitiesCapped || vendorsCapped

    return NextResponse.json({
      matched:           { count: matched.length,            items: matched            },
      unmatchedSynapse:  { count: unmatchedSynapse.length,   items: unmatchedSynapse   },
      unmatchedNetsuite: { count: unmatchedNetsuite.length,  items: unmatchedNetsuite  },
      capped,
      ...(capped ? { cappedNote: 'Results capped at 500 — reconciliation may be incomplete. Contact support to process larger datasets.' } : {}),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/reconciliation')
  }
}
