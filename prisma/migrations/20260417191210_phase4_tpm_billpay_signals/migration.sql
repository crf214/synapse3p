-- CreateEnum
CREATE TYPE "OnboardingStepType" AS ENUM ('DOCUMENT', 'REVIEW', 'APPROVAL', 'EXTERNAL_CHECK', 'INFORMATION');

-- CreateEnum
CREATE TYPE "OnboardingInstanceStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'PENDING_APPROVAL', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('ONBOARDING', 'PERIODIC', 'EVENT_TRIGGERED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewDomain" AS ENUM ('CYBERSECURITY', 'LEGAL', 'PRIVACY', 'FINANCIAL', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('ONBOARDING', 'REVIEW', 'PAYMENT', 'STATUS_CHANGE', 'INCIDENT', 'DOCUMENT', 'NOTE', 'EXTERNAL_SIGNAL', 'RISK_SCORE_CHANGE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'MATCHED', 'UNMATCHED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('EMAIL', 'PORTAL', 'MANUAL', 'EDI');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('TWO_WAY', 'THREE_WAY', 'NONE');

-- CreateEnum
CREATE TYPE "InvoiceDecisionType" AS ENUM ('AUTO_APPROVE', 'REVIEW', 'ESCALATE', 'REJECT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "PaymentRailExecution" AS ENUM ('ERP', 'BANK_API', 'STRIPE');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('NEWS', 'STOCK_PRICE');

-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "onboarding_workflows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityTypes" "EntityType"[],
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_instances" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "OnboardingInstanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedSteps" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_party_reviews" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reviewType" "ReviewType" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cyberScore" DOUBLE PRECISION,
    "legalScore" DOUBLE PRECISION,
    "privacyScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "cyberFindings" JSONB NOT NULL DEFAULT '{}',
    "legalFindings" JSONB NOT NULL DEFAULT '{}',
    "privacyFindings" JSONB NOT NULL DEFAULT '{}',
    "reviewedBy" TEXT,
    "approvedBy" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextReviewDate" TIMESTAMP(3),
    "triggerEvent" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_party_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cadences" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "riskScoreMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScoreMax" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "reviewIntervalDays" INTEGER NOT NULL,
    "domains" "ReviewDomain"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_activity_logs" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "performedBy" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "entity_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_schedules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "spendCategory" TEXT,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequency" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "toleranceFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tolerancePct" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "toleranceDynamic" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastInvoiceAt" TIMESTAMP(3),
    "lastInvoiceAmount" DOUBLE PRECISION,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "poId" TEXT,
    "recurringScheduleId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "source" "InvoiceSource" NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "matchType" "MatchType" NOT NULL DEFAULT 'NONE',
    "documentId" TEXT,
    "rawExtraction" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_evaluations" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "amountScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendorScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duplicateScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toleranceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weights" JSONB NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "explanation" JSONB NOT NULL,
    "withinTolerance" BOOLEAN NOT NULL DEFAULT true,
    "deviation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deviationPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveTolerance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_decisions" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "decision" "InvoiceDecisionType" NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "reasoning" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT NOT NULL,
    "overriddenBy" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "previousDecision" "InvoiceDecisionType",

    CONSTRAINT "invoice_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_executions" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "rail" "PaymentRailExecution" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "reference" TEXT,
    "bankAccountId" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "glPosted" BOOLEAN NOT NULL DEFAULT false,
    "glPostedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_signal_configs" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "signalTypes" "SignalType"[],
    "stockTicker" TEXT,
    "companyName" TEXT NOT NULL,
    "newsKeywords" TEXT[],
    "severityThreshold" "SignalSeverity" NOT NULL DEFAULT 'MEDIUM',
    "alertRecipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_signal_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_signals" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "severity" "SignalSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "rawData" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "affectedRiskScore" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "external_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_instances_entityId_orgId_workflowId_key" ON "onboarding_instances"("entityId", "orgId", "workflowId");

-- CreateIndex
CREATE INDEX "third_party_reviews_entityId_reviewType_idx" ON "third_party_reviews"("entityId", "reviewType");

-- CreateIndex
CREATE INDEX "third_party_reviews_nextReviewDate_idx" ON "third_party_reviews"("nextReviewDate");

-- CreateIndex
CREATE INDEX "entity_activity_logs_entityId_occurredAt_idx" ON "entity_activity_logs"("entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "entity_activity_logs_orgId_activityType_idx" ON "entity_activity_logs"("orgId", "activityType");

-- CreateIndex
CREATE INDEX "invoices_entityId_status_idx" ON "invoices"("entityId", "status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_idx" ON "invoices"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_orgId_invoiceNo_key" ON "invoices"("orgId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_decisions_invoiceId_key" ON "invoice_decisions"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_executions_invoiceId_idx" ON "payment_executions"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_executions_status_scheduledAt_idx" ON "payment_executions"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_signal_configs_entityId_orgId_key" ON "external_signal_configs"("entityId", "orgId");

-- CreateIndex
CREATE INDEX "external_signals_entityId_detectedAt_idx" ON "external_signals"("entityId", "detectedAt");

-- CreateIndex
CREATE INDEX "external_signals_severity_dismissed_idx" ON "external_signals"("severity", "dismissed");

-- AddForeignKey
ALTER TABLE "onboarding_workflows" ADD CONSTRAINT "onboarding_workflows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "onboarding_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_reviews" ADD CONSTRAINT "third_party_reviews_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_reviews" ADD CONSTRAINT "third_party_reviews_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cadences" ADD CONSTRAINT "review_cadences_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_activity_logs" ADD CONSTRAINT "entity_activity_logs_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_activity_logs" ADD CONSTRAINT "entity_activity_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_decisions" ADD CONSTRAINT "invoice_decisions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_executions" ADD CONSTRAINT "payment_executions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_signal_configs" ADD CONSTRAINT "external_signal_configs_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_signals" ADD CONSTRAINT "external_signals_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
