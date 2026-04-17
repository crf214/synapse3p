// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const client =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

// ---------------------------------------------------------------------------
// Audit middleware
// ---------------------------------------------------------------------------
// Intercepts create, update, and delete operations and writes a best-effort
// record to audit_events. The AuditEvent model is skipped to prevent loops.
//
// Phase 2 TODO: replace the '' orgId placeholder and null actorId with real
// values once request context (session/JWT) can be threaded through here —
// likely via AsyncLocalStorage or a Prisma client extension that accepts
// { actorId, orgId } per-request.
// ---------------------------------------------------------------------------

const AUDITED_ACTIONS = new Set(['create', 'update', 'delete', 'upsert'])

client.$use(async (params, next) => {
  if (!params.model || params.model === 'AuditEvent' || !AUDITED_ACTIONS.has(params.action)) {
    return next(params)
  }

  const modelDelegate = (client as any)[
    params.model.charAt(0).toLowerCase() + params.model.slice(1)
  ]

  // Fetch the record's current state before mutating it
  let before: Record<string, unknown> | null = null
  if ((params.action === 'update' || params.action === 'delete') && params.args?.where) {
    try {
      before = await modelDelegate.findFirst({ where: params.args.where }) ?? null
    } catch (e) {
      console.error('[audit] Failed to fetch before state:', e)
    }
  }

  const result = await next(params)

  // Determine after state
  let after: Record<string, unknown> | null = null
  if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
    after = result ?? null
  }

  // Best-effort audit write — never throws back to the caller
  try {
    await client.auditEvent.create({
      data: {
        // Phase 2: replace with real orgId/actorId from request context
        orgId:      before?.orgId as string ?? after?.orgId as string ?? '',
        actorId:    null,
        action:     params.action,
        entityType: params.model,
        entityId:   (result as any)?.id ?? (before as any)?.id ?? null,
        before:     before   ?? undefined,
        after:      after    ?? undefined,
        ipAddress:  null,
      },
    })
  } catch (e) {
    console.error('[audit] Failed to write audit event:', e)
  }

  return result
})

export const prisma = client

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
