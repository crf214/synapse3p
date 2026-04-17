-- CreateEnum
CREATE TYPE "PoType" AS ENUM ('FIXED', 'OPEN', 'BLANKET');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessingTrack" AS ENUM ('FULL_PO', 'LIGHTWEIGHT', 'STP', 'CONTRACT_REQUIRED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELEGATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('PARTIAL', 'FULL', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('INTERNAL', 'VENDOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('QUOTE', 'PROPOSAL', 'CONTRACT', 'SOW', 'INVOICE', 'RECEIPT', 'APPROVAL', 'COMPLIANCE', 'CERTIFICATE', 'REPORT', 'AMENDMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ESignStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'UNDER_REVIEW', 'RENEWED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('MASTER', 'SOW', 'AMENDMENT', 'NDA', 'SLA', 'FRAMEWORK', 'OTHER');

-- CreateTable
CREATE TABLE "processing_rules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "track" "ProcessingTrack" NOT NULL,
    "requiresGoodsReceipt" BOOLEAN NOT NULL DEFAULT false,
    "requiresContract" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_rule_evaluations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT,
    "entityId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "conditionsSnapshot" JSONB NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "trackAssigned" "ProcessingTrack",
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedBy" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "processing_rule_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "spendCategories" TEXT[],
    "departments" TEXT[],
    "thresholdMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thresholdMax" DOUBLE PRECISION,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PoType" NOT NULL,
    "track" "ProcessingTrack" NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "entityId" TEXT NOT NULL,
    "serviceEngagementId" TEXT,
    "processingRuleId" TEXT,
    "processingRuleSnapshot" JSONB,
    "approvalWorkflowId" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spendCategory" TEXT,
    "department" TEXT,
    "costCentre" TEXT,
    "glCode" TEXT,
    "requestedBy" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "requiresGoodsReceipt" BOOLEAN NOT NULL DEFAULT false,
    "requiresContract" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_items" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "glCode" TEXT,
    "costCentre" TEXT,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "po_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_approvals" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "workflowId" TEXT,
    "step" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "delegatedTo" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "po_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_amendments" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedFields" JSONB NOT NULL,
    "previousValues" JSONB NOT NULL,
    "newValues" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "amendedBy" TEXT NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL,
    "lineItems" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "source" "DocumentSource" NOT NULL DEFAULT 'INTERNAL',
    "storageRef" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "entityId" TEXT,
    "poId" TEXT,
    "contractId" TEXT,
    "serviceEngagementId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "eSignRequired" BOOLEAN NOT NULL DEFAULT false,
    "eSignStatus" "ESignStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "eSignProvider" TEXT,
    "eSignEnvelopeId" TEXT,
    "eSignCompletedAt" TIMESTAMP(3),
    "uploadedBy" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "ownedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "linkedPoId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processing_rules_orgId_priority_idx" ON "processing_rules"("orgId", "priority");

-- CreateIndex
CREATE INDEX "processing_rule_evaluations_sourceType_sourceId_idx" ON "processing_rule_evaluations"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "processing_rule_evaluations_orgId_evaluatedAt_idx" ON "processing_rule_evaluations"("orgId", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_orgId_poNumber_key" ON "purchase_orders"("orgId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "po_line_items_poId_lineNo_key" ON "po_line_items"("poId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "po_amendments_poId_version_key" ON "po_amendments"("poId", "version");

-- CreateIndex
CREATE INDEX "documents_orgId_docType_idx" ON "documents"("orgId", "docType");

-- CreateIndex
CREATE INDEX "documents_entityId_idx" ON "documents"("entityId");

-- CreateIndex
CREATE INDEX "documents_poId_idx" ON "documents"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_documentId_key" ON "contracts"("documentId");

-- CreateIndex
CREATE INDEX "contracts_orgId_status_idx" ON "contracts"("orgId", "status");

-- CreateIndex
CREATE INDEX "contracts_endDate_idx" ON "contracts"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_orgId_contractNo_key" ON "contracts"("orgId", "contractNo");

-- AddForeignKey
ALTER TABLE "processing_rules" ADD CONSTRAINT "processing_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_rule_evaluations" ADD CONSTRAINT "processing_rule_evaluations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "processing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_rule_evaluations" ADD CONSTRAINT "processing_rule_evaluations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_processingRuleId_fkey" FOREIGN KEY ("processingRuleId") REFERENCES "processing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvalWorkflowId_fkey" FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_approvals" ADD CONSTRAINT "po_approvals_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_approvals" ADD CONSTRAINT "po_approvals_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_amendments" ADD CONSTRAINT "po_amendments_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
