// src/lib/workflow-engine/templates/invoice-templates.ts
// Idempotent seed function for invoice workflow templates.
// Safe to call multiple times — uses upsert logic keyed on (orgId, name).

import { PrismaClient } from '@prisma/client'

export async function seedInvoiceTemplates(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  await seedStandardInvoiceReview(orgId, createdBy, prisma)
  await seedHighValueInvoiceReview(orgId, createdBy, prisma)
}

// ---------------------------------------------------------------------------
// Template A: "Standard Invoice Review"
// ---------------------------------------------------------------------------

async function seedStandardInvoiceReview(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  const name = 'Standard Invoice Review'

  // Idempotency check — skip if template already exists for this org
  const existing = await prisma.workflowTemplate.findFirst({
    where: { orgId, name },
  })
  if (existing) {
    console.log(`[seedInvoiceTemplates] "${name}" already exists for org ${orgId} — skipping`)
    return
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name,
      description:     'Standard two-step invoice review: entity check → auto-approve or FM review',
      targetObjectType: 'INVOICE',
      isActive:        true,
      isValid:         true,
      version:         1,
      createdBy,
      orgId,
    },
  })

  // Step 0 — CONDITION_BRANCH "Entity Status Check"
  const step0 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Entity Status Check',
      description:     'Branch based on entity onboarding status',
      stepType:        'CONDITION_BRANCH',
      executionMode:   'SYNC',
      order:           0,
      onMissingContext: 'WAIT',
      config: {
        branches: [
          {
            conditions: [{ field: 'entity.status', operator: 'eq', value: 'PROVISIONAL' }],
            operator:   'AND',
            nextStepOrder: 1,
          },
          {
            conditions: [{ field: 'entity.status', operator: 'eq', value: 'ACTIVE' }],
            operator:   'AND',
            nextStepOrder: 2,
          },
        ],
        defaultNextStepOrder: 1,
      },
      nextSteps:    {},
      dependencies: [],
    },
  })

  // Step 1 — SUB_WORKFLOW "Onboard Entity"
  const step1 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Onboard Entity',
      description:     'Trigger entity onboarding sub-workflow',
      stepType:        'SUB_WORKFLOW',
      executionMode:   'SYNC',
      order:           1,
      onMissingContext: 'FAIL',
      config: {
        templateName:        'Entity Onboarding',
        targetObjectIdField: 'entityId',
        waitForCompletion:   true,
      },
      nextSteps: {
        PASS: { nextStepOrder: 2 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step0.id],
    },
  })

  // Step 2 — AUTO_RULE "Auto-Approve Check"
  const step2 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Auto-Approve Check',
      description:     'Automatically approve low-risk invoices under threshold',
      stepType:        'AUTO_RULE',
      executionMode:   'SYNC',
      order:           2,
      onMissingContext: 'FAIL',
      config: {
        conditions: [
          { field: 'invoice.amount',    operator: 'lt',  value: 10000 },
          { field: 'entity.riskBand',   operator: 'in',  value: ['LOW', 'MEDIUM'] },
          { field: 'invoice.riskBand',  operator: 'neq', value: 'CRITICAL' },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
        FAIL: { nextStepOrder: 3 },
      },
      dependencies: [step1.id],
    },
  })

  // Step 3 — APPROVAL "Finance Manager Review"
  const step3 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Finance Manager Review',
      description:     'Requires Finance Manager approval',
      stepType:        'APPROVAL',
      executionMode:   'SYNC',
      order:           3,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'FINANCE_MANAGER',
        timeoutHours:  48,
        escalateTo:    'CONTROLLER',
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step2.id],
    },
  })

  // Step 4 — NOTIFICATION "Approved — Notify Submitter"
  const step4 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Approved — Notify Submitter',
      description:     'Send approval notification to submitter',
      stepType:        'NOTIFICATION',
      executionMode:   'ASYNC',
      order:           4,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'invoice_approved',
        message:       'Your invoice has been approved.',
      },
      nextSteps:    {},
      dependencies: [step3.id, step2.id],
    },
  })

  // Step 5 — NOTIFICATION "Rejected — Notify Submitter"
  await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Rejected — Notify Submitter',
      description:     'Send rejection notification to submitter',
      stepType:        'NOTIFICATION',
      executionMode:   'ASYNC',
      order:           5,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'invoice_rejected',
        message:       'Your invoice has been rejected.',
      },
      nextSteps:    {},
      dependencies: [step3.id, step1.id],
    },
  })

  // Suppress unused variable warning — step4 id used above
  void step4

  // TemplateSelectionRule: priority 100 — matches all invoices (fallback)
  await prisma.templateSelectionRule.create({
    data: {
      templateId:      template.id,
      orgId,
      priority:        100,
      triggerEvent:    'OBJECT_CREATED',
      targetObjectType: 'INVOICE',
      conditions:      [],
      isActive:        true,
    },
  })

  console.log(`[seedInvoiceTemplates] Created "${name}" for org ${orgId}`)
}

// ---------------------------------------------------------------------------
// Template B: "High Value Invoice Review"
// ---------------------------------------------------------------------------

async function seedHighValueInvoiceReview(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  const name = 'High Value Invoice Review'

  const existing = await prisma.workflowTemplate.findFirst({
    where: { orgId, name },
  })
  if (existing) {
    console.log(`[seedInvoiceTemplates] "${name}" already exists for org ${orgId} — skipping`)
    return
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name,
      description:     'High-value invoice review: entity check → dual FM + CFO approval',
      targetObjectType: 'INVOICE',
      isActive:        true,
      isValid:         true,
      version:         1,
      createdBy,
      orgId,
    },
  })

  // Step 0 — CONDITION_BRANCH "Entity Status Check"
  const step0 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Entity Status Check',
      description:     'Branch based on entity onboarding status',
      stepType:        'CONDITION_BRANCH',
      executionMode:   'SYNC',
      order:           0,
      onMissingContext: 'WAIT',
      config: {
        branches: [
          {
            conditions: [{ field: 'entity.status', operator: 'eq', value: 'PROVISIONAL' }],
            operator:   'AND',
            nextStepOrder: 1,
          },
          {
            conditions: [{ field: 'entity.status', operator: 'eq', value: 'ACTIVE' }],
            operator:   'AND',
            nextStepOrder: 2,
          },
        ],
        defaultNextStepOrder: 1,
      },
      nextSteps:    {},
      dependencies: [],
    },
  })

  // Step 1 — SUB_WORKFLOW "Onboard Entity"
  const step1 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Onboard Entity',
      description:     'Trigger entity onboarding sub-workflow',
      stepType:        'SUB_WORKFLOW',
      executionMode:   'SYNC',
      order:           1,
      onMissingContext: 'FAIL',
      config: {
        templateName:        'Entity Onboarding',
        targetObjectIdField: 'entityId',
        waitForCompletion:   true,
      },
      nextSteps: {
        PASS: { nextStepOrder: 2 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step0.id],
    },
  })

  // Step 2 — APPROVAL "Finance Manager Approval"
  const step2 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Finance Manager Approval',
      description:     'Requires Finance Manager approval (first of two)',
      stepType:        'APPROVAL',
      executionMode:   'SYNC',
      order:           2,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'FINANCE_MANAGER',
        timeoutHours:  24,
        escalateTo:    'CONTROLLER',
      },
      nextSteps: {
        PASS: { nextStepOrder: 3 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step1.id],
    },
  })

  // Step 3 — APPROVAL "CFO Approval"
  const step3 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'CFO Approval',
      description:     'Requires CFO approval (final sign-off)',
      stepType:        'APPROVAL',
      executionMode:   'SYNC',
      order:           3,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'CFO',
        timeoutHours:  48,
        escalateTo:    'CFO',
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
        FAIL: { nextStepOrder: 5 },
      },
      dependencies: [step2.id],
    },
  })

  // Step 4 — NOTIFICATION "Approved — Notify Submitter"
  const step4 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Approved — Notify Submitter',
      description:     'Send approval notification to submitter',
      stepType:        'NOTIFICATION',
      executionMode:   'ASYNC',
      order:           4,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'invoice_approved',
        message:       'Your invoice has been approved.',
      },
      nextSteps:    {},
      dependencies: [step3.id],
    },
  })

  // Step 5 — NOTIFICATION "Rejected — Notify Submitter"
  await prisma.workflowStepDefinition.create({
    data: {
      templateId:      template.id,
      name:            'Rejected — Notify Submitter',
      description:     'Send rejection notification to submitter',
      stepType:        'NOTIFICATION',
      executionMode:   'ASYNC',
      order:           5,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'invoice_rejected',
        message:       'Your invoice has been rejected.',
      },
      nextSteps:    {},
      dependencies: [step2.id, step3.id],
    },
  })

  void step4

  // TemplateSelectionRule: priority 10 — matches invoices over $100,000 (evaluated first)
  await prisma.templateSelectionRule.create({
    data: {
      templateId:      template.id,
      orgId,
      priority:        10,
      triggerEvent:    'OBJECT_CREATED',
      targetObjectType: 'INVOICE',
      conditions:      [{ field: 'invoice.amount', operator: 'gt', value: 100000 }],
      isActive:        true,
    },
  })

  console.log(`[seedInvoiceTemplates] Created "${name}" for org ${orgId}`)
}
