// Append-only audit event writer.
// Maps to the AuditEvent model (entityType/entityId per schema).
// Never throws — a failed audit write must not crash the calling mutation.
//
// IMPORTANT: when calling inside a prisma.$transaction, pass the transaction
// client (tx), not the global prisma client, so the audit write is atomic
// with the mutation.

import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'REJECT'
  | 'SUBMIT'
  | 'CANCEL'
  | 'OVERRIDE'
  | 'COMPLETE'
  | 'AMEND'
  | 'SEND'
  | 'RECONCILE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'CRON_RUN'

export type AuditObjectType =
  | 'ENTITY'
  | 'INVOICE'
  | 'PURCHASE_ORDER'
  | 'PAYMENT'
  | 'USER'
  | 'REVIEW'
  | 'CONTRACT'
  | 'DOCUMENT'
  | 'ONBOARDING_WORKFLOW'
  | 'ONBOARDING_INSTANCE'
  | 'SERVICE_ENGAGEMENT'
  | 'PROCESSING_RULE'
  | 'APPROVAL_WORKFLOW'
  | 'AUTO_APPROVE_POLICY'
  | 'EXTERNAL_SIGNAL_CONFIG'
  | 'REVIEW_CADENCE'
  | 'MERGED_AUTHORIZATION'
  | 'PAYMENT_EXECUTION'
  | 'BANK_ACCOUNT'
  | 'SERVICE_CATALOGUE'
  | 'WORKFLOW_TEMPLATE'
  | 'SYSTEM'

export interface AuditEventInput {
  actorId:    string
  orgId:      string
  action:     AuditAction
  objectType: AuditObjectType
  objectId:   string
  before?:    Record<string, unknown>
  after?:     Record<string, unknown>
  ipAddress?: string
}

// Accept either the global PrismaClient or a transaction client.
type AuditClient = PrismaClient | Prisma.TransactionClient

export async function writeAuditEvent(
  prisma: AuditClient,
  event: AuditEventInput,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        orgId:      event.orgId,
        actorId:    event.actorId,
        action:     event.action,
        entityType: event.objectType,
        entityId:   event.objectId,
        before:     event.before as object | undefined,
        after:      event.after  as object | undefined,
        ipAddress:  event.ipAddress,
      },
    })
  } catch (err) {
    // Audit write failures are logged but must never surface to the caller.
    console.error('[audit] Failed to write audit event', {
      action:     event.action,
      objectType: event.objectType,
      objectId:   event.objectId,
      err,
    })
  }
}

// ControlTestRunner queries lowercase action strings, so keep them resolvable:
// 'create' | 'update' | 'delete' are upper-cased here but the runner uses
// action: { in: ['create','update','delete'] } — update the runner query
// separately to use ['CREATE','UPDATE','DELETE'].
