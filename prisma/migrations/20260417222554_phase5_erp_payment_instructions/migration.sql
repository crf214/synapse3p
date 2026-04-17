-- CreateEnum
CREATE TYPE "PaymentInstructionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_ERP', 'CONFIRMED', 'CANCELLED', 'FAILED', 'AMENDMENT_PENDING');

-- CreateEnum
CREATE TYPE "AmendmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AmendmentField" AS ENUM ('AMOUNT', 'ENTITY', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "ErpTransactionType" AS ENUM ('VENDOR_BILL', 'VENDOR_PAYMENT', 'JOURNAL_ENTRY', 'CREDIT_MEMO', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "ErpSyncStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ErpSyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK');

-- CreateTable
CREATE TABLE "payment_instructions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dueDate" TIMESTAMP(3),
    "glCode" TEXT,
    "costCentre" TEXT,
    "poReference" TEXT,
    "status" "PaymentInstructionStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentToErpAt" TIMESTAMP(3),
    "erpReference" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedAmount" DOUBLE PRECISION,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_instruction_versions" (
    "id" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "glCode" TEXT,
    "costCentre" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotBy" TEXT NOT NULL,
    "changeReason" TEXT,

    CONSTRAINT "payment_instruction_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_instruction_amendments" (
    "id" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "field" "AmendmentField" NOT NULL,
    "previousValue" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "payment_instruction_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_transactions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "erpInternalId" TEXT NOT NULL,
    "erpTransactionType" "ErpTransactionType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "vendorRef" TEXT,
    "paymentReference" TEXT,
    "period" TEXT NOT NULL,
    "periodClosed" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentInstructionId" TEXT,

    CONSTRAINT "erp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_transaction_versions" (
    "id" TEXT NOT NULL,
    "erpTransactionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "vendorRef" TEXT,
    "paymentReference" TEXT,
    "period" TEXT NOT NULL,
    "periodClosed" BOOLEAN NOT NULL,
    "previousValues" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedBySync" TEXT,
    "periodWasClosedAtDetection" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "erp_transaction_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_periods" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "erp_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sync_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "trigger" "ErpSyncTrigger" NOT NULL,
    "triggeredBy" TEXT,
    "status" "ErpSyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "transactionsChecked" INTEGER NOT NULL DEFAULT 0,
    "transactionsChanged" INTEGER NOT NULL DEFAULT 0,
    "thirdPartyRelevant" INTEGER NOT NULL DEFAULT 0,
    "newTransactions" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,

    CONSTRAINT "erp_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_instructions_invoiceId_key" ON "payment_instructions"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_instructions_orgId_status_idx" ON "payment_instructions"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instruction_versions_paymentInstructionId_version_key" ON "payment_instruction_versions"("paymentInstructionId", "version");

-- CreateIndex
CREATE INDEX "payment_instruction_amendments_paymentInstructionId_status_idx" ON "payment_instruction_amendments"("paymentInstructionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instruction_amendments_paymentInstructionId_field_s_key" ON "payment_instruction_amendments"("paymentInstructionId", "field", "status");

-- CreateIndex
CREATE INDEX "erp_transactions_entityId_idx" ON "erp_transactions"("entityId");

-- CreateIndex
CREATE INDEX "erp_transactions_period_periodClosed_idx" ON "erp_transactions"("period", "periodClosed");

-- CreateIndex
CREATE UNIQUE INDEX "erp_transactions_orgId_erpInternalId_key" ON "erp_transactions"("orgId", "erpInternalId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_transaction_versions_erpTransactionId_versionNo_key" ON "erp_transaction_versions"("erpTransactionId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "erp_periods_orgId_period_key" ON "erp_periods"("orgId", "period");

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instruction_versions" ADD CONSTRAINT "payment_instruction_versions_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instruction_amendments" ADD CONSTRAINT "payment_instruction_amendments_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_transaction_versions" ADD CONSTRAINT "erp_transaction_versions_erpTransactionId_fkey" FOREIGN KEY ("erpTransactionId") REFERENCES "erp_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: only one PENDING amendment per instruction per field at a time
-- This enforces the four-eyes constraint at the database level
CREATE UNIQUE INDEX "payment_instruction_amendments_pending_unique"
ON payment_instruction_amendments ("paymentInstructionId", field)
WHERE status = 'PENDING';

-- Partial unique index: only one APPROVED amendment per instruction per field at a time
-- Prevents duplicate approvals
CREATE UNIQUE INDEX "payment_instruction_amendments_approved_unique"
ON payment_instruction_amendments ("paymentInstructionId", field)
WHERE status = 'APPROVED';
