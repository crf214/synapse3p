-- Phase 3A: Unified Workflow Engine
-- Removes legacy workflow models and adds new unified workflow engine schema.

-- ============================================================
-- Step 1: Drop foreign key constraints on removed models
-- ============================================================

-- StepDependency used to reference OnboardingInstance — drop the old FK
ALTER TABLE "step_dependencies" DROP CONSTRAINT IF EXISTS "step_dependencies_stepId_fkey";

-- PurchaseOrder FK to ProcessingRule
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_processingRuleId_fkey";

-- PurchaseOrder FK to ApprovalWorkflow
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_approvalWorkflowId_fkey";

-- POApproval FK to ApprovalWorkflow
ALTER TABLE "po_approvals" DROP CONSTRAINT IF EXISTS "po_approvals_workflowId_fkey";

-- ProcessingRuleEvaluation FK to ProcessingRule
ALTER TABLE "processing_rule_evaluations" DROP CONSTRAINT IF EXISTS "processing_rule_evaluations_ruleId_fkey";

-- OnboardingInstance FK to OnboardingWorkflow
ALTER TABLE "onboarding_instances" DROP CONSTRAINT IF EXISTS "onboarding_instances_workflowId_fkey";

-- OnboardingInstance self-referential FK (sub-workflows)
ALTER TABLE "onboarding_instances" DROP CONSTRAINT IF EXISTS "onboarding_instances_parentInstanceId_fkey";

-- Organisation FKs to removed models
ALTER TABLE "onboarding_workflows" DROP CONSTRAINT IF EXISTS "onboarding_workflows_orgId_fkey";
ALTER TABLE "onboarding_instances" DROP CONSTRAINT IF EXISTS "onboarding_instances_orgId_fkey";
ALTER TABLE "onboarding_instances" DROP CONSTRAINT IF EXISTS "onboarding_instances_entityId_fkey";
ALTER TABLE "processing_rules" DROP CONSTRAINT IF EXISTS "processing_rules_orgId_fkey";
ALTER TABLE "approval_workflows" DROP CONSTRAINT IF EXISTS "approval_workflows_orgId_fkey";
ALTER TABLE "auto_approve_policies" DROP CONSTRAINT IF EXISTS "auto_approve_policies_orgId_fkey";

-- ============================================================
-- Step 2: Drop removed model tables
-- ============================================================

DROP TABLE IF EXISTS "onboarding_instances";
DROP TABLE IF EXISTS "onboarding_workflows";
DROP TABLE IF EXISTS "approval_workflows";
DROP TABLE IF EXISTS "auto_approve_policies";
DROP TABLE IF EXISTS "processing_rules";

-- ============================================================
-- Step 3: Create new workflow engine tables
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE "WorkflowTargetType"   AS ENUM ('ENTITY', 'INVOICE', 'PURCHASE_ORDER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StepType" AS ENUM ('APPROVAL', 'AUTO_RULE', 'CONDITION_BRANCH', 'NOTIFICATION', 'WAIT_FOR', 'SUB_WORKFLOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StepExecutionMode" AS ENUM ('SYNC', 'ASYNC', 'PARALLEL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StepInstanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StepResult" AS ENUM ('PASS', 'FAIL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OnMissingContext" AS ENUM ('WAIT', 'SKIP', 'FAIL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- WorkflowTemplate
CREATE TABLE IF NOT EXISTS "workflow_templates" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "targetObjectType" "WorkflowTargetType" NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT false,
  "isValid"          BOOLEAN NOT NULL DEFAULT false,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "createdBy"        TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- WorkflowStepDefinition
CREATE TABLE IF NOT EXISTS "workflow_step_definitions" (
  "id"               TEXT NOT NULL,
  "templateId"       TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "stepType"         "StepType" NOT NULL,
  "executionMode"    "StepExecutionMode" NOT NULL DEFAULT 'SYNC',
  "parallelGroupId"  TEXT,
  "config"           JSONB NOT NULL,
  "nextSteps"        JSONB NOT NULL,
  "dependencies"     JSONB NOT NULL DEFAULT '[]',
  "onMissingContext" "OnMissingContext" NOT NULL DEFAULT 'FAIL',
  "order"            INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "workflow_step_definitions_pkey" PRIMARY KEY ("id")
);

-- WorkflowInstance
CREATE TABLE IF NOT EXISTS "workflow_instances" (
  "id"                   TEXT NOT NULL,
  "templateId"           TEXT NOT NULL,
  "templateVersion"      INTEGER NOT NULL,
  "orgId"                TEXT NOT NULL,
  "targetObjectType"     "WorkflowTargetType" NOT NULL,
  "targetObjectId"       TEXT NOT NULL,
  "status"               "WorkflowInstanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "parentInstanceId"     TEXT,
  "parentStepInstanceId" TEXT,
  "context"              JSONB NOT NULL DEFAULT '{}',
  "startedAt"            TIMESTAMP(3),
  "completedAt"          TIMESTAMP(3),
  "cancelledAt"          TIMESTAMP(3),
  "cancelledBy"          TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- WorkflowStepInstance
CREATE TABLE IF NOT EXISTS "workflow_step_instances" (
  "id"                 TEXT NOT NULL,
  "workflowInstanceId" TEXT NOT NULL,
  "stepDefinitionId"   TEXT NOT NULL,
  "status"             "StepInstanceStatus" NOT NULL DEFAULT 'PENDING',
  "result"             "StepResult",
  "assignedTo"         TEXT,
  "startedAt"          TIMESTAMP(3),
  "completedAt"        TIMESTAMP(3),
  "completedBy"        TEXT,
  "notes"              TEXT,
  "metadata"           JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_step_instances_pkey" PRIMARY KEY ("id")
);

-- TemplateSelectionRule
CREATE TABLE IF NOT EXISTS "template_selection_rules" (
  "id"               TEXT NOT NULL,
  "templateId"       TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "priority"         INTEGER NOT NULL,
  "triggerEvent"     TEXT NOT NULL,
  "targetObjectType" "WorkflowTargetType" NOT NULL,
  "conditions"       JSONB NOT NULL DEFAULT '[]',
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "template_selection_rules_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Step 4: Add foreign keys on new tables
-- ============================================================

ALTER TABLE "workflow_step_definitions"
  ADD CONSTRAINT "workflow_step_definitions_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE;

ALTER TABLE "workflow_instances"
  ADD CONSTRAINT "workflow_instances_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id");

ALTER TABLE "workflow_step_instances"
  ADD CONSTRAINT "workflow_step_instances_workflowInstanceId_fkey"
  FOREIGN KEY ("workflowInstanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE;

ALTER TABLE "workflow_step_instances"
  ADD CONSTRAINT "workflow_step_instances_stepDefinitionId_fkey"
  FOREIGN KEY ("stepDefinitionId") REFERENCES "workflow_step_definitions"("id");

ALTER TABLE "template_selection_rules"
  ADD CONSTRAINT "template_selection_rules_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE;

-- ============================================================
-- Step 5: Recreate StepDependency FK to reference WorkflowStepInstance
-- ============================================================

ALTER TABLE "step_dependencies"
  ADD CONSTRAINT "step_dependencies_stepId_fkey"
  FOREIGN KEY ("stepId") REFERENCES "workflow_step_instances"("id");

-- ============================================================
-- Step 6: Create indexes on new tables
-- ============================================================

CREATE INDEX IF NOT EXISTS "workflow_instances_targetObjectType_targetObjectId_idx"
  ON "workflow_instances"("targetObjectType", "targetObjectId");

CREATE INDEX IF NOT EXISTS "workflow_instances_status_idx"
  ON "workflow_instances"("status");

CREATE INDEX IF NOT EXISTS "template_selection_rules_targetObjectType_triggerEvent_priority_idx"
  ON "template_selection_rules"("targetObjectType", "triggerEvent", "priority");
