-- Invoice Ingestion Phase 1: Schema additions
-- New enums, extended Invoice/RiskEvaluation models, and 8 new models.

-- ============================================================
-- New enums
-- ============================================================

CREATE TYPE "RiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE "RiskSignalType" AS ENUM (
  'NEW_VENDOR',
  'AMOUNT_VARIANCE',
  'NO_CONTRACT_MATCH',
  'CONTRACT_EXPIRED',
  'CONTRACT_EXPIRING_SOON',
  'DUPLICATE_FLAG',
  'MISSING_FIELDS',
  'UNCONTRACTED_SPEND',
  'AMOUNT_OVER_THRESHOLD',
  'FREQUENCY_ANOMALY',
  'SANCTION_FLAG'
);

CREATE TYPE "DuplicateFlagStatus" AS ENUM (
  'QUARANTINED',
  'OVERRIDE_APPROVED',
  'FALSE_POSITIVE'
);

CREATE TYPE "InvoiceApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'DELEGATED',
  'EXPIRED'
);

CREATE TYPE "MergedAuthStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAID'
);

-- ============================================================
-- Extend invoices table
-- ============================================================

ALTER TABLE "invoices"
  ADD COLUMN "contractId"         TEXT,
  ADD COLUMN "contractMatchConf"  DOUBLE PRECISION,
  ADD COLUMN "emailMessageId"     TEXT,
  ADD COLUMN "pdfFingerprint"     TEXT;

CREATE UNIQUE INDEX "invoices_emailMessageId_key" ON "invoices"("emailMessageId");
CREATE INDEX "invoices_contractId_idx" ON "invoices"("contractId");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Extend risk_evaluations table
-- ============================================================

ALTER TABLE "risk_evaluations"
  ADD COLUMN "tier" "RiskTier";

-- ============================================================
-- risk_signals
-- ============================================================

CREATE TABLE "risk_signals" (
  "id"               TEXT NOT NULL,
  "riskEvaluationId" TEXT NOT NULL,
  "signalType"       "RiskSignalType" NOT NULL,
  "triggered"        BOOLEAN NOT NULL,
  "value"            DOUBLE PRECISION,
  "weight"           DOUBLE PRECISION,
  "detail"           TEXT,

  CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "risk_signals_riskEvaluationId_idx" ON "risk_signals"("riskEvaluationId");

ALTER TABLE "risk_signals"
  ADD CONSTRAINT "risk_signals_riskEvaluationId_fkey"
  FOREIGN KEY ("riskEvaluationId") REFERENCES "risk_evaluations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- invoice_ingestion_events
-- ============================================================

CREATE TABLE "invoice_ingestion_events" (
  "id"               TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "invoiceId"        TEXT,
  "source"           "InvoiceSource" NOT NULL,
  "receivedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailMessageId"   TEXT,
  "fromEmail"        TEXT,
  "fromName"         TEXT,
  "subject"          TEXT,
  "attachmentRefs"   JSONB,
  "storageRef"       TEXT,
  "uploadedBy"       TEXT,
  "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "errorDetails"     TEXT,
  "rawPayload"       JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_ingestion_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_ingestion_events_invoiceId_key"    ON "invoice_ingestion_events"("invoiceId");
CREATE UNIQUE INDEX "invoice_ingestion_events_emailMessageId_key" ON "invoice_ingestion_events"("emailMessageId");
CREATE INDEX "invoice_ingestion_events_orgId_receivedAt_idx"    ON "invoice_ingestion_events"("orgId", "receivedAt");
CREATE INDEX "invoice_ingestion_events_processingStatus_idx"    ON "invoice_ingestion_events"("processingStatus");

ALTER TABLE "invoice_ingestion_events"
  ADD CONSTRAINT "invoice_ingestion_events_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_ingestion_events"
  ADD CONSTRAINT "invoice_ingestion_events_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- invoice_extracted_fields
-- ============================================================

CREATE TABLE "invoice_extracted_fields" (
  "id"              TEXT NOT NULL,
  "invoiceId"       TEXT NOT NULL,
  "fieldName"       TEXT NOT NULL,
  "rawValue"        TEXT,
  "normalizedValue" TEXT,
  "confidence"      DOUBLE PRECISION NOT NULL,
  "modelVersion"    TEXT,
  "needsReview"     BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewedBy"      TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "reviewedValue"   TEXT,

  CONSTRAINT "invoice_extracted_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_extracted_fields_invoiceId_fieldName_key"
  ON "invoice_extracted_fields"("invoiceId", "fieldName");
CREATE INDEX "invoice_extracted_fields_invoiceId_idx"   ON "invoice_extracted_fields"("invoiceId");
CREATE INDEX "invoice_extracted_fields_needsReview_idx" ON "invoice_extracted_fields"("needsReview");

ALTER TABLE "invoice_extracted_fields"
  ADD CONSTRAINT "invoice_extracted_fields_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- invoice_duplicate_flags
-- ============================================================

CREATE TABLE "invoice_duplicate_flags" (
  "id"                    TEXT NOT NULL,
  "orgId"                 TEXT NOT NULL,
  "invoiceId"             TEXT NOT NULL,
  "duplicateOfInvoiceId"  TEXT,
  "matchedOnInvoiceNo"    BOOLEAN NOT NULL DEFAULT FALSE,
  "matchedOnVendorAmount" BOOLEAN NOT NULL DEFAULT FALSE,
  "matchedOnPdfHash"      BOOLEAN NOT NULL DEFAULT FALSE,
  "matchedOnEmailMsgId"   BOOLEAN NOT NULL DEFAULT FALSE,
  "signalDetails"         JSONB,
  "status"                "DuplicateFlagStatus" NOT NULL DEFAULT 'QUARANTINED',
  "detectedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detectedBy"            TEXT NOT NULL,
  "overriddenBy"          TEXT,
  "overriddenAt"          TIMESTAMP(3),
  "overrideJustification" TEXT,
  "resolvedBy"            TEXT,
  "resolvedAt"            TIMESTAMP(3),
  "resolutionNotes"       TEXT,

  CONSTRAINT "invoice_duplicate_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_duplicate_flags_orgId_status_idx"          ON "invoice_duplicate_flags"("orgId", "status");
CREATE INDEX "invoice_duplicate_flags_invoiceId_idx"             ON "invoice_duplicate_flags"("invoiceId");
CREATE INDEX "invoice_duplicate_flags_duplicateOfInvoiceId_idx"  ON "invoice_duplicate_flags"("duplicateOfInvoiceId");

ALTER TABLE "invoice_duplicate_flags"
  ADD CONSTRAINT "invoice_duplicate_flags_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_duplicate_flags"
  ADD CONSTRAINT "invoice_duplicate_flags_duplicateOfInvoiceId_fkey"
  FOREIGN KEY ("duplicateOfInvoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- auto_approve_policies
-- ============================================================

CREATE TABLE "auto_approve_policies" (
  "id"                    TEXT NOT NULL,
  "orgId"                 TEXT NOT NULL,
  "entityId"              TEXT,
  "name"                  TEXT NOT NULL,
  "isActive"              BOOLEAN NOT NULL DEFAULT TRUE,
  "maxAmount"             DECIMAL(18,4),
  "currency"              TEXT NOT NULL DEFAULT 'USD',
  "requireContractMatch"  BOOLEAN NOT NULL DEFAULT TRUE,
  "requireRecurringMatch" BOOLEAN NOT NULL DEFAULT FALSE,
  "allowedRiskTiers"      "RiskTier"[],
  "noDuplicateFlag"       BOOLEAN NOT NULL DEFAULT TRUE,
  "noAnomalyFlag"         BOOLEAN NOT NULL DEFAULT TRUE,
  "allFieldsExtracted"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"             TEXT NOT NULL,
  "updatedBy"             TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "auto_approve_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_approve_policies_orgId_entityId_key"
  ON "auto_approve_policies"("orgId", "entityId");
CREATE INDEX "auto_approve_policies_orgId_isActive_idx"
  ON "auto_approve_policies"("orgId", "isActive");

ALTER TABLE "auto_approve_policies"
  ADD CONSTRAINT "auto_approve_policies_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- invoice_approvals
-- ============================================================

CREATE TABLE "invoice_approvals" (
  "id"             TEXT NOT NULL,
  "invoiceId"      TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "assignedTo"     TEXT NOT NULL,
  "assignedBy"     TEXT NOT NULL,
  "assignedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "role"           "OrgRole" NOT NULL,
  "status"         "InvoiceApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "decidedAt"      TIMESTAMP(3),
  "decision"       TEXT,
  "notes"          TEXT,
  "delegatedTo"    TEXT,
  "lastReminderAt" TIMESTAMP(3),

  CONSTRAINT "invoice_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_approvals_invoiceId_idx"        ON "invoice_approvals"("invoiceId");
CREATE INDEX "invoice_approvals_assignedTo_status_idx" ON "invoice_approvals"("assignedTo", "status");
CREATE INDEX "invoice_approvals_orgId_status_idx"      ON "invoice_approvals"("orgId", "status");

ALTER TABLE "invoice_approvals"
  ADD CONSTRAINT "invoice_approvals_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_approvals"
  ADD CONSTRAINT "invoice_approvals_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_approvals"
  ADD CONSTRAINT "invoice_approvals_assignedTo_fkey"
  FOREIGN KEY ("assignedTo") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- notification_preferences
-- ============================================================

CREATE TABLE "notification_preferences" (
  "id"                   TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "orgId"                TEXT NOT NULL,
  "emailOnInvoiceRouted" BOOLEAN NOT NULL DEFAULT TRUE,
  "reminderEnabled"      BOOLEAN NOT NULL DEFAULT TRUE,
  "reminderAfterDays"    INTEGER NOT NULL DEFAULT 3,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");
CREATE INDEX "notification_preferences_orgId_idx"         ON "notification_preferences"("orgId");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- merged_authorizations
-- ============================================================

CREATE TABLE "merged_authorizations" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "reference"    TEXT NOT NULL,
  "name"         TEXT,
  "totalAmount"  DECIMAL(18,4) NOT NULL,
  "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "netAmount"    DECIMAL(18,4) NOT NULL,
  "currency"     TEXT NOT NULL,
  "status"       "MergedAuthStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy"    TEXT NOT NULL,
  "approvedBy"   TEXT,
  "approvedAt"   TIMESTAMP(3),
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merged_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merged_authorizations_orgId_reference_key"
  ON "merged_authorizations"("orgId", "reference");
CREATE INDEX "merged_authorizations_orgId_status_idx"
  ON "merged_authorizations"("orgId", "status");

ALTER TABLE "merged_authorizations"
  ADD CONSTRAINT "merged_authorizations_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organisations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- merged_auth_items
-- ============================================================

CREATE TABLE "merged_auth_items" (
  "id"           TEXT NOT NULL,
  "mergedAuthId" TEXT NOT NULL,
  "invoiceId"    TEXT NOT NULL,
  "isCredit"     BOOLEAN NOT NULL DEFAULT FALSE,
  "amount"       DECIMAL(18,4) NOT NULL,
  "notes"        TEXT,

  CONSTRAINT "merged_auth_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merged_auth_items_invoiceId_key" ON "merged_auth_items"("invoiceId");
CREATE INDEX "merged_auth_items_mergedAuthId_idx"     ON "merged_auth_items"("mergedAuthId");

ALTER TABLE "merged_auth_items"
  ADD CONSTRAINT "merged_auth_items_mergedAuthId_fkey"
  FOREIGN KEY ("mergedAuthId") REFERENCES "merged_authorizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "merged_auth_items"
  ADD CONSTRAINT "merged_auth_items_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- vendor_spend_snapshots
-- ============================================================

CREATE TABLE "vendor_spend_snapshots" (
  "id"           TEXT NOT NULL,
  "entityId"     TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "period"       TEXT NOT NULL,
  "invoiceCount" INTEGER NOT NULL,
  "totalAmount"  DECIMAL(18,4) NOT NULL,
  "avgAmount"    DECIMAL(18,4) NOT NULL,
  "minAmount"    DECIMAL(18,4) NOT NULL,
  "maxAmount"    DECIMAL(18,4) NOT NULL,
  "currency"     TEXT NOT NULL,
  "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vendor_spend_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_spend_snapshots_entityId_orgId_period_currency_key"
  ON "vendor_spend_snapshots"("entityId", "orgId", "period", "currency");
CREATE INDEX "vendor_spend_snapshots_entityId_orgId_period_idx"
  ON "vendor_spend_snapshots"("entityId", "orgId", "period");

ALTER TABLE "vendor_spend_snapshots"
  ADD CONSTRAINT "vendor_spend_snapshots_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "entities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
