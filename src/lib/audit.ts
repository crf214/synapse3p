// Append-only audit event writer.
// Maps to the AuditEvent model (entityType/entityId per schema).
// Never throws — a failed audit write must not crash the calling mutation.

import type { PrismaClient } from '@prisma/client'

// Verb-only actions. Keep in sync with what ControlTestRunner queries:
// ['create', 'update', 'delete', 'upsert'].
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'submit'
  | 'cancel'
  | 'login'
  | 'logout'
  | 'register'
  | 'send'
  | 'reconcile'
  | 'override'
  | 'complete'
  | 'amend'

export type AuditObjectType =
  | 'entity'
  | 'invoice'
  | 'invoice_approval'
  | 'invoice_duplicate_flag'
  | 'purchase_order'
  | 'payment_instruction'
  | 'payment_execution'
  | 'merged_authorization'
  | 'onboarding_instance'
  | 'onboarding_workflow'
  | 'third_party_review'
  | 'contract'
  | 'document'
  | 'service_engagement'
  | 'processing_rule'
  | 'approval_workflow'
  | 'auto_approve_policy'
  | 'external_signal_config'
  | 'review_cadence'
  | 'user'
  | 'erp_sync'

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

export async function writeAuditEvent(
  prisma: PrismaClient,
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
        before:     event.before  as object | undefined,
        after:      event.after   as object | undefined,
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
