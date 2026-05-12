// src/lib/workflow-engine/templates/entity-templates.ts
// Idempotent seed function for entity workflow templates.
// Safe to call multiple times — uses upsert logic keyed on (orgId, name).

import { PrismaClient } from '@prisma/client'

export async function seedEntityTemplates(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  await seedEntityOnboarding(orgId, createdBy, prisma)
}

// ---------------------------------------------------------------------------
// Template: "Entity Onboarding"
// ---------------------------------------------------------------------------

async function seedEntityOnboarding(
  orgId: string,
  createdBy: string,
  prisma: PrismaClient,
): Promise<void> {
  const name = 'Entity Onboarding'

  // Idempotency check — skip if template already exists for this org
  const existing = await prisma.workflowTemplate.findFirst({
    where: { orgId, name },
  })
  if (existing) {
    console.log(`[seedEntityTemplates] "${name}" already exists for org ${orgId} — skipping`)
    return
  }

  const template = await prisma.workflowTemplate.create({
    data: {
      name,
      description:      'Full entity onboarding workflow: KYC/KYB → sanctions → bank account verification → risk routing → activation',
      targetObjectType: 'ENTITY',
      isActive:         true,
      isValid:          true,
      version:          1,
      createdBy,
      orgId,
    },
  })

  // Step 0 — AUTO_RULE "Initial Data Check"
  const step0 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Initial Data Check',
      description:      'Verify required entity fields exist before proceeding',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            0,
      onMissingContext: 'FAIL',
      config: {
        conditions: [
          { field: 'entity.name', operator: 'exists', value: true },
          { field: 'entity.type', operator: 'exists', value: true },
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

  // Step 1 — APPROVAL "KYC/KYB Review"
  const step1 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'KYC/KYB Review',
      description:      'Legal team KYC/KYB review and approval',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            1,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'LEGAL',
        timeoutHours:  72,
        escalateTo:    'CISO',
      },
      nextSteps: {
        PASS: { nextStepOrder: 2 },
        FAIL: { nextStepOrder: 7 },
      },
      dependencies: [step0.id],
    },
  })

  // Step 2 — AUTO_RULE "Sanctions Check"
  const step2 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Sanctions Check',
      description:      'Verify entity sanctions status is clear',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            2,
      onMissingContext: 'WAIT',
      config: {
        conditions: [
          { field: 'entity.dueDiligence.sanctionsStatus', operator: 'eq', value: 'CLEAR' },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 3 },
        FAIL: { nextStepOrder: 8 },
      },
      dependencies: [step1.id],
    },
  })

  // Step 3 — APPROVAL "Bank Account Verification"
  const step3 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Bank Account Verification',
      description:      'Finance Manager verifies entity bank account details',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            3,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'FINANCE_MANAGER',
        timeoutHours:  48,
      },
      nextSteps: {
        PASS: { nextStepOrder: 4 },
        FAIL: { nextStepOrder: 6 },
      },
      dependencies: [step2.id],
    },
  })

  // Step 4 — AUTO_RULE "Risk Score Ready"
  const step4 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Risk Score Ready',
      description:      'Verify entity risk band has been computed',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            4,
      onMissingContext: 'WAIT',
      config: {
        conditions: [
          { field: 'entity.riskBand', operator: 'exists', value: true },
        ],
        operator: 'AND',
      },
      nextSteps: {
        PASS: { nextStepOrder: 5 },
        FAIL: { nextStepOrder: 4 },
      },
      dependencies: [step3.id],
    },
  })

  // Step 5 — CONDITION_BRANCH "Risk Band Routing"
  const step5 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Risk Band Routing',
      description:      'Route to senior approval for high-risk entities or directly to activation for low/medium risk',
      stepType:         'CONDITION_BRANCH',
      executionMode:    'SYNC',
      order:            5,
      onMissingContext: 'WAIT',
      config: {
        branches: [
          {
            conditions: [{ field: 'entity.riskBand', operator: 'in', value: ['HIGH', 'CRITICAL'] }],
            operator:   'AND',
            nextStepOrder: 9,
          },
          {
            conditions: [{ field: 'entity.riskBand', operator: 'in', value: ['LOW', 'MEDIUM'] }],
            operator:   'AND',
            nextStepOrder: 10,
          },
        ],
        defaultNextStepOrder: 9,
      },
      nextSteps:    {},
      dependencies: [step4.id],
    },
  })

  // Step 6 — NOTIFICATION "Notify: Incomplete Data"
  const step6 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Notify: Incomplete Data',
      description:      'Notify submitter that onboarding could not proceed due to missing data',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            6,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'entity_incomplete_data',
        message:       'Entity onboarding could not be completed — required data is missing.',
      },
      nextSteps:    {},
      dependencies: [step0.id, step3.id],
    },
  })

  // Step 7 — NOTIFICATION "Notify: Entity Rejected"
  const step7 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Notify: Entity Rejected',
      description:      'Notify submitter that entity onboarding was rejected',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            7,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'entity_rejected',
        message:       'Entity onboarding was rejected.',
      },
      nextSteps:    {},
      dependencies: [step1.id],
    },
  })

  // Step 8 — APPROVAL "Sanctions Escalation"
  const step8 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Sanctions Escalation',
      description:      'CISO review of sanctions flag before proceeding',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            8,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'CISO',
        timeoutHours:  24,
      },
      nextSteps: {
        PASS: { nextStepOrder: 3 },
        FAIL: { nextStepOrder: 7 },
      },
      dependencies: [step2.id],
    },
  })

  // Step 9 — APPROVAL "Senior Approval (High Risk)"
  const step9 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Senior Approval (High Risk)',
      description:      'CFO approval required for high or critical risk entities',
      stepType:         'APPROVAL',
      executionMode:    'SYNC',
      order:            9,
      onMissingContext: 'FAIL',
      config: {
        assigneeRule:  'ROLE',
        requiredRole:  'CFO',
        timeoutHours:  48,
      },
      nextSteps: {
        PASS: { nextStepOrder: 10 },
        FAIL: { nextStepOrder: 7  },
      },
      dependencies: [step5.id],
    },
  })

  // Step 10 — AUTO_RULE "Activate Entity"
  const step10 = await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Activate Entity',
      description:      'Set entity status to ACTIVE to complete onboarding',
      stepType:         'AUTO_RULE',
      executionMode:    'SYNC',
      order:            10,
      onMissingContext: 'FAIL',
      config: {
        conditions: [],
        operator:   'AND',
        sideEffect: {
          action: 'SET_ENTITY_STATUS',
          value:  'ACTIVE',
        },
      },
      nextSteps: {
        PASS: { nextStepOrder: 11 },
      },
      dependencies: [step5.id, step9.id],
    },
  })

  // Step 11 — NOTIFICATION "Notify: Entity Activated"
  await prisma.workflowStepDefinition.create({
    data: {
      templateId:       template.id,
      name:             'Notify: Entity Activated',
      description:      'Notify submitter that entity has been successfully onboarded and activated',
      stepType:         'NOTIFICATION',
      executionMode:    'ASYNC',
      order:            11,
      onMissingContext: 'SKIP',
      config: {
        recipientRule: 'SUBMITTER',
        templateId:    'entity_activated',
        message:       'Entity has been successfully onboarded and activated.',
      },
      nextSteps:    {},
      dependencies: [step10.id],
    },
  })

  // Suppress unused variable warnings — ids used in dependencies above
  void step6
  void step7
  void step8

  // TemplateSelectionRule: priority 100 — matches all newly-created entities (fallback)
  await prisma.templateSelectionRule.create({
    data: {
      templateId:       template.id,
      orgId,
      priority:         100,
      triggerEvent:     'OBJECT_CREATED',
      targetObjectType: 'ENTITY',
      conditions:       [],
      isActive:         true,
    },
  })

  console.log(`[seedEntityTemplates] Created "${name}" for org ${orgId}`)
}
