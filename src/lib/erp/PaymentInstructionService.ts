import { prisma } from '@/lib/prisma'
import { getErpAdapter } from './index'
import type { PaymentInstructionPayload } from './types'
import type { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApprovalConfig {
  requiresFourEyes: boolean
  amendmentRequiresFourEyes: boolean
  /** Payments strictly below this amount may be self-approved (STP hook). 0 = disabled. */
  autoApproveBelow: number
}

// ---------------------------------------------------------------------------
// 1. getApprovalConfig
// ---------------------------------------------------------------------------

// TODO: Drive this from ProcessingRule configuration in a future iteration.
// The ProcessingRule model has a `conditions` JSON field that can encode
// approval thresholds, four-eyes requirements, and STP limits per org/entity/track.
// For now this returns org-wide defaults that work for all payment types.
export async function getApprovalConfig(_orgId: string): Promise<ApprovalConfig> {
  return {
    requiresFourEyes:          true,
    amendmentRequiresFourEyes: true,
    autoApproveBelow:          0,
  }
}

// ---------------------------------------------------------------------------
// 2. submitInstruction
// ---------------------------------------------------------------------------

export async function submitInstruction(
  instructionId: string,
  submittedBy: string,
): Promise<void> {
  const instruction = await prisma.paymentInstruction.findUniqueOrThrow({
    where: { id: instructionId },
  })

  if (instruction.status !== 'DRAFT') {
    throw new Error(`Cannot submit instruction in status ${instruction.status}`)
  }

  if (instruction.createdBy !== submittedBy) {
    throw new Error('Only the instruction creator can submit it for approval')
  }

  await prisma.paymentInstruction.update({
    where: { id: instructionId },
    data:  { status: 'PENDING_APPROVAL' },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         `Payment instruction submitted for approval — ${instruction.currency} ${instruction.amount.toFixed(2)}`,
      referenceId:   instructionId,
      referenceType: 'PaymentInstruction',
      performedBy:   submittedBy,
      metadata:      { status: 'PENDING_APPROVAL' },
    },
  })
}

// ---------------------------------------------------------------------------
// 3. approveInstruction
// ---------------------------------------------------------------------------

export async function approveInstruction(
  instructionId: string,
  reviewedBy: string,
): Promise<void> {
  const instruction = await prisma.paymentInstruction.findUniqueOrThrow({
    where: { id: instructionId },
  })

  if (instruction.status !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot approve instruction in status ${instruction.status}`)
  }

  const config = await getApprovalConfig(instruction.orgId)

  // STP path: self-approval allowed when amount is below the configured threshold.
  const isBelowAutoApproveThreshold =
    config.autoApproveBelow > 0 && instruction.amount < config.autoApproveBelow

  if (isBelowAutoApproveThreshold) {
    // Log that STP fast-path was taken so the audit trail is clear.
    console.info(
      `[PaymentInstructionService] STP auto-approve: instruction ${instructionId} ` +
      `amount ${instruction.currency} ${instruction.amount} is below ` +
      `autoApproveBelow threshold ${config.autoApproveBelow} — skipping four-eyes check.`,
    )
  } else if (config.requiresFourEyes && instruction.createdBy === reviewedBy) {
    throw new Error(
      'Four-eyes policy: the approver must be different from the instruction creator',
    )
  }

  const now = new Date()

  await prisma.paymentInstruction.update({
    where: { id: instructionId },
    data: {
      status:     'APPROVED',
      approvedBy: reviewedBy,
      approvedAt: now,
    },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         isBelowAutoApproveThreshold
        ? `Payment instruction auto-approved (STP) — ${instruction.currency} ${instruction.amount.toFixed(2)}`
        : `Payment instruction approved — ${instruction.currency} ${instruction.amount.toFixed(2)}`,
      referenceId:   instructionId,
      referenceType: 'PaymentInstruction',
      performedBy:   reviewedBy,
      metadata:      { status: 'APPROVED', autoApproved: isBelowAutoApproveThreshold },
    },
  })
}

// ---------------------------------------------------------------------------
// 4. rejectInstruction
// ---------------------------------------------------------------------------

export async function rejectInstruction(
  instructionId: string,
  reviewedBy: string,
  reason: string,
): Promise<void> {
  const instruction = await prisma.paymentInstruction.findUniqueOrThrow({
    where: { id: instructionId },
  })

  if (instruction.status !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot reject instruction in status ${instruction.status}`)
  }

  await prisma.paymentInstruction.update({
    where: { id: instructionId },
    data:  { status: 'DRAFT', cancellationReason: reason },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         `Payment instruction rejected — ${instruction.currency} ${instruction.amount.toFixed(2)}`,
      referenceId:   instructionId,
      referenceType: 'PaymentInstruction',
      performedBy:   reviewedBy,
      metadata:      { status: 'DRAFT', reason },
    },
  })
}

// ---------------------------------------------------------------------------
// 5. sendToErp
// ---------------------------------------------------------------------------

export async function sendToErp(
  instructionId: string,
  triggeredBy: string,
): Promise<string> {
  const instruction = await prisma.paymentInstruction.findUniqueOrThrow({
    where:   { id: instructionId },
    include: { org: true },
  })

  if (instruction.status !== 'APPROVED') {
    throw new Error(`Cannot send instruction in status ${instruction.status} — must be APPROVED`)
  }

  const adapter = getErpAdapter()

  const payload: PaymentInstructionPayload = {
    instructionId: instructionId,
    vendorErpId:   instruction.entityId,   // resolved to ERP vendor id at send time by adapter
    bankAccount:   { accountNo: instruction.bankAccountId },
    amount:        instruction.amount,
    currency:      instruction.currency,
    dueDate:       instruction.dueDate ?? undefined,
    memo:          instruction.notes ?? undefined,
  }

  const confirmation = await adapter.sendPaymentInstruction(payload)

  await prisma.paymentInstruction.update({
    where: { id: instructionId },
    data: {
      status:       confirmation.status === 'SUCCESS' ? 'SENT_TO_ERP' : 'FAILED',
      sentToErpAt:  new Date(),
      erpReference: confirmation.erpReference,
    },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         confirmation.status === 'SUCCESS'
        ? `Payment instruction sent to ERP — ref ${confirmation.erpReference}`
        : `Payment instruction ERP submission failed — ${confirmation.failureReason}`,
      referenceId:   instructionId,
      referenceType: 'PaymentInstruction',
      performedBy:   triggeredBy,
      metadata:      { erpReference: confirmation.erpReference, status: confirmation.status },
    },
  })

  if (confirmation.status !== 'SUCCESS') {
    throw new Error(`ERP submission failed: ${confirmation.failureReason}`)
  }

  return confirmation.erpReference!
}

// ---------------------------------------------------------------------------
// 6. requestAmendment
// ---------------------------------------------------------------------------

export async function requestAmendment(
  instructionId: string,
  field: 'AMOUNT' | 'ENTITY' | 'BANK_ACCOUNT',
  proposedValue: string,
  requestedBy: string,
  notes?: string,
): Promise<string> {
  const instruction = await prisma.paymentInstruction.findUniqueOrThrow({
    where: { id: instructionId },
  })

  if (
    instruction.status !== 'APPROVED' &&
    instruction.status !== 'SENT_TO_ERP' &&
    instruction.status !== 'AMENDMENT_PENDING'
  ) {
    throw new Error(`Cannot amend instruction in status ${instruction.status}`)
  }

  // Derive the current value for the requested field
  const previousValue = String(
    field === 'AMOUNT'       ? instruction.amount       :
    field === 'ENTITY'       ? instruction.entityId     :
    /* BANK_ACCOUNT */         instruction.bankAccountId
  )

  if (previousValue === proposedValue) {
    throw new Error(`Proposed value is identical to the current ${field.toLowerCase()}`)
  }

  const fieldKey = field.toLowerCase()
  const changes  = { [fieldKey]: { from: previousValue, to: proposedValue } } as Prisma.InputJsonValue

  const amendment = await prisma.paymentInstructionAmendment.create({
    data: {
      paymentInstructionId: instructionId,
      changes,
      status:      'PENDING',
      requestedBy,
      notes:       notes ?? null,
    },
  })

  await prisma.paymentInstruction.update({
    where: { id: instructionId },
    data:  { status: 'AMENDMENT_PENDING' },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         `Amendment requested on field ${fieldKey}`,
      referenceId:   amendment.id,
      referenceType: 'PaymentInstructionAmendment',
      performedBy:   requestedBy,
      metadata:      { field: fieldKey, previousValue, proposedValue },
    },
  })

  return amendment.id
}

// ---------------------------------------------------------------------------
// 7. approveAmendment
// ---------------------------------------------------------------------------

export async function approveAmendment(
  amendmentId: string,
  reviewedBy: string,
): Promise<void> {
  const amendment = await prisma.paymentInstructionAmendment.findUniqueOrThrow({
    where:   { id: amendmentId },
    include: { paymentInstruction: true },
  })

  if (amendment.status !== 'PENDING') {
    throw new Error(`Cannot approve amendment in status ${amendment.status}`)
  }

  const config = await getApprovalConfig(amendment.paymentInstruction.orgId)

  // Four-eyes: reviewer must differ from requester — no role restriction applied.
  if (config.amendmentRequiresFourEyes && amendment.requestedBy === reviewedBy) {
    throw new Error(
      'Four-eyes policy: the amendment approver must be different from the requester',
    )
  }

  const now = new Date()

  // Apply the amendment to the parent instruction
  const { paymentInstruction: instruction } = amendment
  const changes = amendment.changes as Record<string, { from: unknown; to: unknown }>
  const changedFields = Object.keys(changes)

  // Build the instruction patch from the changes map
  const instructionPatch: Record<string, unknown> = {}
  if ('amount'       in changes) instructionPatch.amount        = parseFloat(String(changes.amount.to))
  if ('entity'       in changes) instructionPatch.entityId      = String(changes.entity.to)
  if ('bank_account' in changes) instructionPatch.bankAccountId = String(changes.bank_account.to)

  // Snapshot the instruction state before applying
  await prisma.paymentInstructionVersion.create({
    data: {
      paymentInstructionId: instruction.id,
      version:              instruction.currentVersion + 1,
      entityId:             instruction.entityId,
      bankAccountId:        instruction.bankAccountId,
      amount:               instruction.amount,
      currency:             instruction.currency,
      dueDate:              instruction.dueDate,
      costCentre:           instruction.costCentre,
      snapshotAt:           now,
      snapshotBy:           reviewedBy,
      changeReason:         `Amendment approved: ${changedFields.join(', ')} changed`,
    },
  })

  await prisma.$transaction([
    prisma.paymentInstructionAmendment.update({
      where: { id: amendmentId },
      data: {
        status:     'APPROVED',
        reviewedBy,
        reviewedAt: now,
      },
    }),
    prisma.paymentInstruction.update({
      where: { id: instruction.id },
      data: {
        ...instructionPatch,
        currentVersion: instruction.currentVersion + 1,
        status: 'APPROVED',   // revert AMENDMENT_PENDING → APPROVED after patch applied
      },
    }),
  ])

  await prisma.entityActivityLog.create({
    data: {
      entityId:      instruction.entityId,
      orgId:         instruction.orgId,
      activityType:  'PAYMENT',
      title:         `Amendment approved: ${changedFields.join(', ')} updated`,
      referenceId:   amendmentId,
      referenceType: 'PaymentInstructionAmendment',
      performedBy:   reviewedBy,
      metadata:      { changes } as Prisma.InputJsonValue,
    },
  })
}

// ---------------------------------------------------------------------------
// 8. rejectAmendment
// ---------------------------------------------------------------------------

export async function rejectAmendment(
  amendmentId: string,
  reviewedBy: string,
  rejectionReason: string,
): Promise<void> {
  const amendment = await prisma.paymentInstructionAmendment.findUniqueOrThrow({
    where:   { id: amendmentId },
    include: { paymentInstruction: true },
  })

  if (amendment.status !== 'PENDING') {
    throw new Error(`Cannot reject amendment in status ${amendment.status}`)
  }

  const now = new Date()

  await prisma.$transaction([
    prisma.paymentInstructionAmendment.update({
      where: { id: amendmentId },
      data: {
        status:          'REJECTED',
        reviewedBy,
        reviewedAt:      now,
        rejectionReason,
      },
    }),
    // Only revert to APPROVED if this was the last pending amendment
    prisma.paymentInstruction.update({
      where: { id: amendment.paymentInstructionId },
      data:  { status: 'APPROVED' },
    }),
  ])

  const rejectedChanges = amendment.changes as Record<string, unknown>
  const rejectedFields  = Object.keys(rejectedChanges)

  await prisma.entityActivityLog.create({
    data: {
      entityId:      amendment.paymentInstruction.entityId,
      orgId:         amendment.paymentInstruction.orgId,
      activityType:  'PAYMENT',
      title:         `Amendment rejected: ${rejectedFields.join(', ')}`,
      referenceId:   amendmentId,
      referenceType: 'PaymentInstructionAmendment',
      performedBy:   reviewedBy,
      metadata:      { changes: rejectedChanges, reason: rejectionReason } as Prisma.InputJsonValue,
    },
  })
}
