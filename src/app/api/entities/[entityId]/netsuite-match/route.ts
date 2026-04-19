import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getErpAdapter } from '@/lib/erp'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ---------------------------------------------------------------------------
// Simple name-similarity scorer
// ---------------------------------------------------------------------------
function scoreMatch(entityName: string, vendorName: string, entityRegNo: string | null): number {
  let score = 0
  const en = entityName.toLowerCase()
  const vn = vendorName.toLowerCase()

  // Exact match
  if (en === vn) return 10

  // Exact match bonus
  if (en.includes(vn) || vn.includes(en)) score += 5

  // Word-overlap scoring
  const entityWords = en.split(/\s+/).filter(w => w.length > 2)
  const vendorWords = vn.split(/\s+/).filter(w => w.length > 2)
  for (const ew of entityWords) {
    if (vendorWords.some(vw => vw === ew || vw.startsWith(ew) || ew.startsWith(vw))) {
      score += 2
    }
  }

  // Registration number hint in vendor name/data
  if (entityRegNo) {
    const regLower = entityRegNo.toLowerCase()
    if (vn.includes(regLower)) score += 3
  }

  return score
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true, name: true, registrationNo: true, metadata: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const adapter = getErpAdapter()
    const vendors = await adapter.getVendors()

    const scored = vendors
      .map(v => ({
        erpId:       v.erpId,
        name:        v.name,
        currency:    v.currency,
        isActive:    v.isActive,
        score:       scoreMatch(entity.name, v.name, entity.registrationNo ?? null),
        isExactMatch: v.name.toLowerCase() === entity.name.toLowerCase(),
      }))
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    const meta = (entity.metadata ?? {}) as Record<string, unknown>

    return NextResponse.json({
      matches:        scored,
      currentLink:    meta.erpVendorId ? { erpVendorId: meta.erpVendorId, erpVendorName: meta.erpVendorName, erpLinkedAt: meta.erpLinkedAt } : null,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/netsuite-match')
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true, name: true, metadata: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const body = await req.json() as Record<string, unknown>
    const erpVendorId   = sanitiseString(body.erpVendorId   ?? '', 100)
    const erpVendorName = sanitiseString(body.erpVendorName ?? '', 200)

    if (!erpVendorId)   throw new ValidationError('erpVendorId is required')
    if (!erpVendorName) throw new ValidationError('erpVendorName is required')

    const existingMeta = (entity.metadata ?? {}) as Record<string, unknown>
    const newMeta = {
      ...existingMeta,
      erpVendorId,
      erpVendorName,
      erpLinkedAt: new Date().toISOString(),
      erpLinkedBy: session.userId,
    }

    const updated = await prisma.entity.update({
      where: { id: entityId },
      data:  { metadata: newMeta },
    })

    await prisma.entityActivityLog.create({
      data: {
        entityId,
        orgId:        session.orgId,
        activityType: 'STATUS_CHANGE',
        title:        `Linked to NetSuite vendor: ${erpVendorName} (ID: ${erpVendorId})`,
        performedBy:  session.userId,
        metadata:     { erpVendorId, erpVendorName },
      },
    })

    return NextResponse.json({ metadata: updated.metadata })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/netsuite-match')
  }
}
