-- CreateEnum
CREATE TYPE "ControlDomain" AS ENUM ('ACCESS_CONTROL', 'CHANGE_MANAGEMENT', 'FINANCIAL_INTEGRITY', 'VENDOR_RISK', 'BC_DR', 'MONITORING');

-- CreateEnum
CREATE TYPE "ControlFrequency" AS ENUM ('CONTINUOUS', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'PER_EVENT');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_REVIEW', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "TestResultStatus" AS ENUM ('PASS', 'FAIL', 'WARNING', 'NOT_RUN', 'ERROR');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('AUTOMATED_TEST', 'MANUAL_REVIEW', 'DOCUMENT', 'SCREENSHOT', 'EXPORT', 'SIGN_OFF');

-- CreateEnum
CREATE TYPE "AuditPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateTable
CREATE TABLE "controls" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" "ControlDomain" NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "frequency" "ControlFrequency" NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "automatedTestKey" TEXT,
    "sox" BOOLEAN NOT NULL DEFAULT false,
    "soc2Criteria" TEXT[],
    "status" "ControlStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_periods" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "AuditPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "openedBy" TEXT NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "auditorNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_test_results" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditPeriodId" TEXT,
    "status" "TestResultStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "testedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,

    CONSTRAINT "control_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_evidence" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditPeriodId" TEXT,
    "evidenceType" "EvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageRef" TEXT,
    "storageHash" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "control_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_dr_records" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "rtoTargetHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "rpoTargetHours" DOUBLE PRECISION NOT NULL DEFAULT 24,
    "actualRtoHours" DOUBLE PRECISION,
    "actualRpoHours" DOUBLE PRECISION,
    "status" "TestResultStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "testedBy" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,

    CONSTRAINT "bc_dr_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "controls_controlId_key" ON "controls"("controlId");

-- CreateIndex
CREATE INDEX "controls_orgId_domain_idx" ON "controls"("orgId", "domain");

-- CreateIndex
CREATE INDEX "controls_controlId_idx" ON "controls"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_periods_orgId_name_key" ON "audit_periods"("orgId", "name");

-- CreateIndex
CREATE INDEX "control_test_results_controlId_testedAt_idx" ON "control_test_results"("controlId", "testedAt");

-- CreateIndex
CREATE INDEX "control_test_results_orgId_status_idx" ON "control_test_results"("orgId", "status");

-- CreateIndex
CREATE INDEX "control_evidence_controlId_collectedAt_idx" ON "control_evidence"("controlId", "collectedAt");

-- CreateIndex
CREATE INDEX "control_evidence_auditPeriodId_idx" ON "control_evidence"("auditPeriodId");

-- CreateIndex
CREATE INDEX "bc_dr_records_orgId_recordType_idx" ON "bc_dr_records"("orgId", "recordType");

-- AddForeignKey
ALTER TABLE "control_test_results" ADD CONSTRAINT "control_test_results_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_test_results" ADD CONSTRAINT "control_test_results_auditPeriodId_fkey" FOREIGN KEY ("auditPeriodId") REFERENCES "audit_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_evidence" ADD CONSTRAINT "control_evidence_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_evidence" ADD CONSTRAINT "control_evidence_auditPeriodId_fkey" FOREIGN KEY ("auditPeriodId") REFERENCES "audit_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
