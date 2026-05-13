// src/tests/workflow-engine.test.ts
// Unit tests for the workflow engine: startWorkflow, completeStep,
// WAITING steps, circular sub-workflow detection, condition evaluator edge cases,
// and NOTIFICATION step.
//
// Prisma is fully mocked — no real DB required.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories run before any imports
// ---------------------------------------------------------------------------

const { mockPrisma, mockNotificationHandler, mockStartWorkflow } = vi.hoisted(() => {
  const mockPrisma = {
    workflowTemplate: { findUnique: vi.fn() },
    workflowInstance: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    workflowStepInstance: {
      createMany: vi.fn(),
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    invoice: { findUnique: vi.fn() },
  }
  const mockNotificationHandler = vi.fn()
  const mockStartWorkflow       = vi.fn()
  return { mockPrisma, mockNotificationHandler, mockStartWorkflow }
})

vi.mock('@/lib/prisma',                                               () => ({ prisma: mockPrisma }))
vi.mock('@/lib/workflow-engine/step-handlers/notification',           () => ({ handleNotificationStep: mockNotificationHandler }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { WorkflowEngine }     from '@/lib/workflow-engine/engine'
import { evaluateCondition, evaluateConditions } from '@/lib/workflow-engine/condition-evaluator'
import { handleSubWorkflowStep }                 from '@/lib/workflow-engine/step-handlers/sub-workflow'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(steps: object[] = []) {
  return {
    id:      'tmpl-1',
    version: 1,
    steps,
  }
}

function makeInstance(overrides: object = {}) {
  return {
    id:               'inst-1',
    status:           'IN_PROGRESS',
    templateId:       'tmpl-1',
    parentInstanceId: null,
    context:          {},
    stepInstances:    [],
    ...overrides,
  }
}

function makeStepDef(overrides: object = {}) {
  return {
    id:                'step-def-1',
    stepType:          'AUTO_RULE',
    order:             0,
    dependencies:      [],
    onMissingContext:  'FAIL',
    config:            {},
    ...overrides,
  }
}

function makeStepInstance(overrides: object = {}) {
  return {
    id:                 'step-inst-1',
    stepDefinitionId:   'step-def-1',
    workflowInstanceId: 'inst-1',
    status:             'PENDING',
    result:             null,
    assignedTo:         null,
    stepDefinition:     makeStepDef(),
    workflowInstance:   makeInstance(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// WorkflowEngine.startWorkflow
// ---------------------------------------------------------------------------

describe('WorkflowEngine.startWorkflow', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new WorkflowEngine(mockPrisma as never)
  })

  it('creates instance and step instances, then executes the first step', async () => {
    const stepDef = makeStepDef({ order: 0 })
    mockPrisma.workflowTemplate.findUnique.mockResolvedValue(makeTemplate([stepDef]))
    mockPrisma.workflowInstance.create.mockResolvedValue(makeInstance())
    mockPrisma.workflowStepInstance.createMany.mockResolvedValue({ count: 1 })

    const stepInst = makeStepInstance({
      stepDefinition:   stepDef,
      workflowInstance: makeInstance({ context: {} }),
    })
    mockPrisma.workflowStepInstance.findMany
      .mockResolvedValueOnce([stepInst])    // for startWorkflow's first-step fetch
      .mockResolvedValueOnce([{ ...stepInst, status: 'COMPLETED', result: 'PASS' }]) // checkAndFinalise

    mockPrisma.workflowStepInstance.update.mockResolvedValue({
      ...stepInst, status: 'COMPLETED', workflowInstanceId: 'inst-1',
    })
    mockPrisma.workflowInstance.update.mockResolvedValue({})
    // step-executor findUnique
    mockPrisma.workflowStepInstance.findUnique.mockResolvedValue({
      ...stepInst,
      stepDefinition:   { ...stepDef, config: { conditions: [], operator: 'AND' } },
      workflowInstance: makeInstance({ context: {} }),
    })

    const instanceId = await engine.startWorkflow('tmpl-1', 'INVOICE', 'inv-1', 'org-1')

    expect(instanceId).toBe('inst-1')
    expect(mockPrisma.workflowInstance.create).toHaveBeenCalledOnce()
    expect(mockPrisma.workflowStepInstance.createMany).toHaveBeenCalledOnce()
  })

  it('throws when template is not found', async () => {
    mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null)
    await expect(
      engine.startWorkflow('bad-tmpl', 'INVOICE', 'inv-1', 'org-1'),
    ).rejects.toThrow('WorkflowTemplate not found')
  })
})

// ---------------------------------------------------------------------------
// WorkflowEngine.completeStep
// ---------------------------------------------------------------------------

describe('WorkflowEngine.completeStep', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new WorkflowEngine(mockPrisma as never)
  })

  it('marks step COMPLETED with result PASS and finalises the instance', async () => {
    const completedStep = {
      id:                 'step-inst-1',
      workflowInstanceId: 'inst-1',
      status:             'COMPLETED',
    }
    mockPrisma.workflowStepInstance.update.mockResolvedValue(completedStep)
    mockPrisma.workflowInstance.findUnique.mockResolvedValue({
      id: 'inst-1', status: 'IN_PROGRESS',
      stepInstances: [
        { id: 'step-inst-1', status: 'COMPLETED', result: 'PASS', stepDefinition: makeStepDef() },
      ],
    })
    mockPrisma.workflowStepInstance.findMany.mockResolvedValue([
      { status: 'COMPLETED', result: 'PASS' },
    ])
    mockPrisma.workflowInstance.update.mockResolvedValue({})

    await engine.completeStep('step-inst-1', 'PASS', 'user-1')

    expect(mockPrisma.workflowStepInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', result: 'PASS' }) }),
    )
    expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    )
  })

  it('marks instance FAILED when step result is FAIL', async () => {
    mockPrisma.workflowStepInstance.update.mockResolvedValue({
      id: 'step-inst-1', workflowInstanceId: 'inst-1', status: 'COMPLETED',
    })
    mockPrisma.workflowInstance.findUnique.mockResolvedValue({
      id: 'inst-1', status: 'IN_PROGRESS',
      stepInstances: [],
    })
    mockPrisma.workflowStepInstance.findMany.mockResolvedValue([
      { status: 'FAILED', result: 'FAIL' },
    ])
    mockPrisma.workflowInstance.update.mockResolvedValue({})

    await engine.completeStep('step-inst-1', 'FAIL', 'user-1')

    expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })
})

// ---------------------------------------------------------------------------
// WAITING step (sub-workflow)
// ---------------------------------------------------------------------------

describe('handleSubWorkflowStep — WAITING', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns WAITING when waitForCompletion is true', async () => {
    mockPrisma.workflowInstance.findUnique.mockResolvedValue({
      id: 'parent-inst', templateId: 'tmpl-parent', parentInstanceId: null,
    })
    mockPrisma.workflowStepInstance.update.mockResolvedValue({})
    mockStartWorkflow.mockResolvedValue('child-inst-1')

    const result = await handleSubWorkflowStep(
      'step-inst-1',
      { templateId: 'tmpl-child', waitForCompletion: true },
      { targetObjectType: 'INVOICE', targetObjectId: 'inv-1' },
      'org-1',
      mockPrisma as never,
      mockStartWorkflow,
      'parent-inst',
    )

    expect(result.status).toBe('WAITING')
    expect(mockPrisma.workflowStepInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'WAITING' } }),
    )
  })

  it('returns COMPLETED/PASS when waitForCompletion is false', async () => {
    mockPrisma.workflowInstance.findUnique.mockResolvedValue({
      id: 'parent-inst', templateId: 'tmpl-parent', parentInstanceId: null,
    })
    mockStartWorkflow.mockResolvedValue('child-inst-1')

    const result = await handleSubWorkflowStep(
      'step-inst-1',
      { templateId: 'tmpl-child', waitForCompletion: false },
      { targetObjectType: 'INVOICE', targetObjectId: 'inv-1' },
      'org-1',
      mockPrisma as never,
      mockStartWorkflow,
      'parent-inst',
    )

    expect(result.status).toBe('COMPLETED')
    expect(result.result).toBe('PASS')
  })
})

// ---------------------------------------------------------------------------
// Circular sub-workflow detection
// ---------------------------------------------------------------------------

describe('handleSubWorkflowStep — circular detection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('detects a direct cycle (parent template === child template)', async () => {
    // parent instance has same templateId as the child we are about to start
    mockPrisma.workflowInstance.findUnique.mockResolvedValue({
      id: 'parent-inst', templateId: 'tmpl-cycle', parentInstanceId: null,
    })

    const result = await handleSubWorkflowStep(
      'step-inst-1',
      { templateId: 'tmpl-cycle', waitForCompletion: false },
      { targetObjectType: 'INVOICE', targetObjectId: 'inv-1' },
      'org-1',
      mockPrisma as never,
      mockStartWorkflow,
      'parent-inst',
    )

    expect(result.status).toBe('FAILED')
    expect(result.error).toMatch(/circular/i)
    expect(mockStartWorkflow).not.toHaveBeenCalled()
  })

  it('detects a multi-hop cycle (grandparent → parent → same child)', async () => {
    // parent inst → templateId: 'tmpl-A'; grandparent → templateId: 'tmpl-target'
    mockPrisma.workflowInstance.findUnique
      .mockResolvedValueOnce({ id: 'parent-inst',      templateId: 'tmpl-A',      parentInstanceId: 'grand-inst' })
      .mockResolvedValueOnce({ id: 'grand-inst',       templateId: 'tmpl-target', parentInstanceId: null })

    const result = await handleSubWorkflowStep(
      'step-inst-1',
      { templateId: 'tmpl-target', waitForCompletion: false },
      { targetObjectType: 'INVOICE', targetObjectId: 'inv-1' },
      'org-1',
      mockPrisma as never,
      mockStartWorkflow,
      'parent-inst',
    )

    expect(result.status).toBe('FAILED')
    expect(result.error).toMatch(/circular/i)
  })

  it('returns FAILED when templateId is missing from config', async () => {
    const result = await handleSubWorkflowStep(
      'step-inst-1',
      {},
      {},
      'org-1',
      mockPrisma as never,
      mockStartWorkflow,
      'parent-inst',
    )

    expect(result.status).toBe('FAILED')
    expect(result.error).toMatch(/templateId/i)
  })
})

// ---------------------------------------------------------------------------
// Condition evaluator edge cases
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  describe('exists operator', () => {
    it('returns true when field exists and value is true', () => {
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  { x: 'hello' })).toBe(true)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  { x: 0 })).toBe(true)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  { x: false })).toBe(true)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  { x: '' })).toBe(true)
    })

    it('returns false for null/undefined when value is true', () => {
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  { x: null })).toBe(false)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: true },  {})).toBe(false)
    })

    it('returns true when field is absent/null and value is false', () => {
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: false }, {})).toBe(true)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: false }, { x: null })).toBe(true)
    })

    it('returns false when field exists and value is false', () => {
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: false }, { x: 'present' })).toBe(false)
      expect(evaluateCondition({ field: 'x', operator: 'exists', value: false }, { x: 0 })).toBe(false)
    })
  })

  describe('eq operator', () => {
    it('handles strict equality', () => {
      expect(evaluateCondition({ field: 'n', operator: 'eq', value: 0 },     { n: 0 })).toBe(true)
      expect(evaluateCondition({ field: 'n', operator: 'eq', value: false }, { n: false })).toBe(true)
      expect(evaluateCondition({ field: 'n', operator: 'eq', value: '' },    { n: '' })).toBe(true)
      expect(evaluateCondition({ field: 'n', operator: 'eq', value: 0 },     { n: '' })).toBe(false)
    })
  })

  describe('in / not_in operators', () => {
    it('in returns true when value is in array', () => {
      expect(evaluateCondition({ field: 's', operator: 'in', value: ['A', 'B'] }, { s: 'A' })).toBe(true)
      expect(evaluateCondition({ field: 's', operator: 'in', value: ['A', 'B'] }, { s: 'C' })).toBe(false)
    })

    it('not_in returns true when value is NOT in array', () => {
      expect(evaluateCondition({ field: 's', operator: 'not_in', value: ['A', 'B'] }, { s: 'C' })).toBe(true)
      expect(evaluateCondition({ field: 's', operator: 'not_in', value: ['A', 'B'] }, { s: 'A' })).toBe(false)
    })
  })

  describe('numeric comparisons', () => {
    it('gt/gte/lt/lte work correctly', () => {
      expect(evaluateCondition({ field: 'v', operator: 'gt',  value: 5  }, { v: 6 })).toBe(true)
      expect(evaluateCondition({ field: 'v', operator: 'gt',  value: 5  }, { v: 5 })).toBe(false)
      expect(evaluateCondition({ field: 'v', operator: 'gte', value: 5  }, { v: 5 })).toBe(true)
      expect(evaluateCondition({ field: 'v', operator: 'lt',  value: 10 }, { v: 9 })).toBe(true)
      expect(evaluateCondition({ field: 'v', operator: 'lte', value: 10 }, { v: 10 })).toBe(true)
    })

    it('returns false for non-numeric values', () => {
      expect(evaluateCondition({ field: 'v', operator: 'gt', value: 5 }, { v: 'high' })).toBe(false)
    })
  })

  describe('nested dot-notation fields', () => {
    it('resolves nested paths', () => {
      expect(evaluateCondition(
        { field: 'entity.riskBand', operator: 'eq', value: 'HIGH' },
        { entity: { riskBand: 'HIGH' } },
      )).toBe(true)
    })

    it('returns undefined (falsy) for missing path', () => {
      expect(evaluateCondition(
        { field: 'entity.riskBand', operator: 'eq', value: 'HIGH' },
        { entity: {} },
      )).toBe(false)
    })
  })
})

describe('evaluateConditions', () => {
  it('returns true for empty conditions', () => {
    expect(evaluateConditions([], 'AND', {})).toBe(true)
    expect(evaluateConditions([], 'OR',  {})).toBe(true)
  })

  it('AND: all conditions must pass', () => {
    const conds = [
      { field: 'a', operator: 'eq' as const, value: 1 },
      { field: 'b', operator: 'eq' as const, value: 2 },
    ]
    expect(evaluateConditions(conds, 'AND', { a: 1, b: 2 })).toBe(true)
    expect(evaluateConditions(conds, 'AND', { a: 1, b: 9 })).toBe(false)
  })

  it('OR: at least one condition must pass', () => {
    const conds = [
      { field: 'a', operator: 'eq' as const, value: 1 },
      { field: 'b', operator: 'eq' as const, value: 2 },
    ]
    expect(evaluateConditions(conds, 'OR', { a: 1, b: 9 })).toBe(true)
    expect(evaluateConditions(conds, 'OR', { a: 9, b: 9 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// NOTIFICATION step mock
// ---------------------------------------------------------------------------

describe('NOTIFICATION step (mocked handler)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is called with correct context and always resolves COMPLETED', async () => {
    mockNotificationHandler.mockResolvedValue({ status: 'COMPLETED', result: 'PASS' })

    const { handleNotificationStep } = await import(
      '@/lib/workflow-engine/step-handlers/notification'
    )

    const result = await handleNotificationStep(
      'step-inst-1',
      { template: 'invoice_assigned', recipientField: 'assigneeId' },
      { assigneeId: 'user-1', invoiceId: 'inv-1' },
      mockPrisma as never,
    )

    expect(result.status).toBe('COMPLETED')
    expect(mockNotificationHandler).toHaveBeenCalledOnce()
  })
})
