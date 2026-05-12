// src/lib/workflow-engine/templates/po-templates.ts
// Idempotent seed function for PO approval workflow templates.
// Safe to call multiple times — uses upsert logic keyed on (orgId, name).

import { PrismaClient } from '@prisma/client'

export async function seedPOTemplates(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  await seedStandardPOApproval(orgId, createdBy, prisma)
  await seedHighValuePOApproval(orgId, createdBy, prisma)
}

// ---------------------------------------------------------------------------
// Template A: "Standard PO Approval"
// ---------------------------------------------------------------------------

async function seedStandardPOApproval(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  const name = 'Standard PO Approval'

  const existing = await prisma.workflowTemplate.findFirst({
    where: { orgId, name },
  })
  if (existing) {
    console.log(`[seedPOTemplates] "${name}" already exists for org ${orgId} — skipping`)
    return
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name,
      description:      'Standard PO approval: entity check → auto-approve or FM approval → notify',
      targetObjectType: 'PURCHASE_ORDER',
      isActive:         true,
      isValid:          true,
      version:          1,
      createdBy,
      orgId,
    },
  })

  // Step 0 — AUTO_RULE "Entity Onboarding Check"
  const step0 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Entity Onboarding Check',
      description:      'Verify vendor entity is ACTIVE before proceeding',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            0,
      onMissingContext: 'WAIT',
      config: {
        conditions: [
          { field: 'entity.status', operator: 'eq', value: 'ACTIVE' },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 1 },
        FAIL: { nextStepOrder: 6 },
      },
      dependencies: [],
    },
  })

  // Step 1 — AUTO_RULE "Auto-Approve Check"
  const step1 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Auto-Approve Check',
      description:      'Auto-approve low-value POs from low/medium risk vendors with active contracts',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            1,
      onMissingContext: 'FAIL',
      config: {
        conditions: [
          { field: 'po.totalAmount',        operator: 'lt', value: 25000 },
          { field: 'entity.riskBand',        operator: 'in', value: ['LOW', 'MEDIUM'] },
          { field: 'po.hasActiveContract',   operator: 'eq', value: true },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
        FAIL: { nextStepOrder: 2 },
      },
      dependencies: [step0.id],
    },
  })

  // Step 2 — APPROVAL "Finance Manager Approval"
  const step2 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Finance Manager Approval',
      description:      'Requires Finance Manager approval for POs that do not auto-approve',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            2,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'FINANCE_MANAGER',
        timeoutHours:  48,
        escalateTo:    'CONTROLLER',
      },
      nextSteps: {
        PASS: { nextStepOrder: 3 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step1.id],
    },
  })

  // Step 3 — AUTO_RULE "Update PO Status to Approved"
  const step3 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Update PO Status to Approved',
      description:      'Set PO status to APPROVED after successful approval',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            3,
      onMissingContext: 'FAIL',
      config: {
        conditions: [],
        operator:   'AND',
        sideEffect: {
          action: 'SET_PO_STATUS',
          value:  'APPROVED',
        },
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
      },
      dependencies: [step2.id],
    },
  })

  // Step 4 — NOTIFICATION "PO Approved — Notify Requestor"
  const step4 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'PO Approved — Notify Requestor',
      description:      'Notify the PO requestor that their PO has been approved',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            4,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'po_approved',
        message:       'Your purchase order has been approved.',
      },
      nextSteps:    {},
      dependencies: [step3.id, step1.id],
    },
  })

  // Step 5 — NOTIFICATION "PO Rejected — Notify Requestor"
  const step5 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'PO Rejected — Notify Requestor',
      description:      'Notify the PO requestor that their PO has been rejected',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            5,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'po_rejected',
        message:       'Your purchase order has been rejected.',
      },
      nextSteps:    {},
      dependencies: [step2.id],
    },
  })

  // Step 6 — NOTIFICATION "PO Blocked — Entity Not Ready"
  await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'PO Blocked — Entity Not Ready',
      description:      'Notify the PO requestor that the vendor entity is not yet onboarded',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            6,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'po_blocked_entity',
        message:       'Your purchase order has been blocked — the vendor entity is not yet active.',
      },
      nextSteps:    {},
      dependencies: [step0.id],
    },
  })

  // Suppress unused variable warnings — ids used in dependencies above
  void step4
  void step5

  // TemplateSelectionRule: priority 100 — matches all POs (fallback)
  await prisma.templateSelectionRule.create({
    data: {
      templateId:       template.id,
      orgId,
      priority:         100,
      triggerEvent:     'OBJECT_CREATED',
      targetObjectType: 'PURCHASE_ORDER',
      conditions:       [],
      isActive:         true,
    },
  })

  console.log(`[seedPOTemplates] Created "${name}" for org ${orgId}`)
}

// ---------------------------------------------------------------------------
// Template B: "High Value PO Approval"
// ---------------------------------------------------------------------------

async function seedHighValuePOApproval(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  const name = 'High Value PO Approval'

  const existing = await prisma.workflowTemplate.findFirst({
    where: { orgId, name },
  })
  if (existing) {
    console.log(`[seedPOTemplates] "${name}" already exists for org ${orgId} — skipping`)
    return
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name,
      description:      'High-value PO approval: entity check → FM approval → CFO approval → notify',
      targetObjectType: 'PURCHASE_ORDER',
      isActive:         true,
      isValid:          true,
      version:          1,
      createdBy,
      orgId,
    },
  })

  // Step 0 — AUTO_RULE "Entity Check"
  const step0 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Entity Check',
      description:      'Verify vendor entity is ACTIVE before proceeding',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            0,
      onMissingContext: 'WAIT',
      config: {
        conditions: [
          { field: 'entity.status', operator: 'eq', value: 'ACTIVE' },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 1 },
        FAIL: { nextStepOrder: 4 },
      },
      dependencies: [],
    },
  })

  // Step 1 — APPROVAL "Finance Manager Approval"
  const step1 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Finance Manager Approval',
      description:      'First-level approval by Finance Manager',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            1,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'FINANCE_MANAGER',
        timeoutHours:  24,
        escalateTo:    'CONTROLLER',
      },
      nextSteps: {
        PASS: { nextStepOrder: 2 },
        FAIL: { nextStepOrder: 4 },
      },
      dependencies: [step0.id],
    },
  })

  // Step 2 — APPROVAL "CFO Approval"
  const step2 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'CFO Approval',
      description:      'Final approval by CFO for high-value POs',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            2,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'CFO',
        timeoutHours:  48,
      },
      nextSteps: {
        PASS: { nextStepOrder: 3 },
        FAIL: { nextStepOrder: 4 },
      },
      dependencies: [step1.id],
    },
  })

  // Step 3 — NOTIFICATION "PO Approved"
  const step3 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'PO Approved',
      description:      'Notify PO requestor of approval',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            3,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'po_approved',
        message:       'Your high-value purchase order has been approved.',
      },
      nextSteps:    {},
      dependencies: [step2.id],
    },
  })

  // Step 4 — NOTIFICATION "PO Rejected"
  await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'PO Rejected',
      description:      'Notify PO requestor of rejection',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            4,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'po_rejected',
        message:       'Your high-value purchase order has been rejected.',
      },
      nextSteps:    {},
      dependencies: [step1.id, step2.id],
    },
  })

  void step3

  // TemplateSelectionRule: priority 10 — matches POs over $100,000 (evaluated first)
  await prisma.templateSelectionRule.create({
    data: {
      templateId:       template.id,
      orgId,
      priority:         10,
      triggerEvent:     'OBJECT_CREATED',
      targetObjectType: 'PURCHASE_ORDER',
      conditions:       [{ field: 'po.totalAmount', operator: 'gt', value: 100000 }],
      isActive:         true,
    },
  })

  console.log(`[seedPOTemplates] Created "${name}" for org ${orgId}`)
}
