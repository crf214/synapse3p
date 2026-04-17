-- CreateEnum
CREATE TYPE "LegalStructure" AS ENUM ('INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('VENDOR', 'CONTRACTOR', 'PARTNER', 'COUNTERPARTY', 'SERVICE_PROVIDER', 'BROKER', 'PLATFORM', 'FUND_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_REVIEW', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SanctionsStatus" AS ENUM ('CLEAR', 'FLAGGED', 'UNDER_REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PaymentRail" AS ENUM ('ACH', 'BACS', 'SWIFT', 'SEPA', 'WIRE', 'STRIPE', 'ERP', 'OTHER');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'BREACHED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('BANKING', 'CUSTODY', 'FUND_ADMIN', 'OUTSOURCING', 'LEGAL', 'AUDIT', 'TECHNOLOGY', 'COMPLIANCE', 'OTHER');

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "masterOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalStructure" "LegalStructure" NOT NULL,
    "registrationNo" TEXT,
    "jurisdiction" TEXT,
    "incorporationDate" TIMESTAMP(3),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryCurrency" TEXT NOT NULL DEFAULT 'USD',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskOverride" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "ultimateParentId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_classifications" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "EntityType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_bank_accounts" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "accountName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "routingNo" TEXT,
    "swiftBic" TEXT,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentRail" "PaymentRail" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_due_diligence" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ddLevel" INTEGER NOT NULL DEFAULT 1,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "sanctionsStatus" "SanctionsStatus" NOT NULL DEFAULT 'CLEAR',
    "pepStatus" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "nextReviewDate" TIMESTAMP(3),
    "internalFactors" JSONB NOT NULL DEFAULT '{}',
    "externalFactors" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_due_diligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_financials" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "taxId" TEXT,
    "vatNumber" TEXT,
    "glCode" TEXT,
    "costCentre" TEXT,
    "creditLimit" DOUBLE PRECISION,
    "preferredBankAccountId" TEXT,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "spendYTD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_risk_scores" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "computedScore" DOUBLE PRECISION NOT NULL,
    "parentInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ddScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "behaviorScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sanctionsScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentHistoryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weights" JSONB NOT NULL,
    "notes" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoredBy" TEXT,

    CONSTRAINT "entity_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_org_relationships" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "managedBy" TEXT,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "onboardingCompletedAt" TIMESTAMP(3),
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "approvedSpendLimit" DOUBLE PRECISION,
    "portalAccess" BOOLEAN NOT NULL DEFAULT false,
    "portalUserId" TEXT,
    "activeForBillPay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_org_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_catalogue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_engagements" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "serviceCatalogueId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "internalOwner" TEXT,
    "department" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "contractId" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "slaTarget" TEXT,
    "slaStatus" "SlaStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "lastReviewedAt" TIMESTAMP(3),
    "complianceDocs" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entities_slug_key" ON "entities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "entity_classifications_entityId_type_key" ON "entity_classifications"("entityId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "entity_due_diligence_entityId_key" ON "entity_due_diligence"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_financials_entityId_key" ON "entity_financials"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_org_relationships_entityId_orgId_key" ON "entity_org_relationships"("entityId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "service_catalogue_name_key" ON "service_catalogue"("name");

-- CreateIndex
CREATE UNIQUE INDEX "service_engagements_entityId_serviceCatalogueId_orgId_key" ON "service_engagements"("entityId", "serviceCatalogueId", "orgId");

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_ultimateParentId_fkey" FOREIGN KEY ("ultimateParentId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_classifications" ADD CONSTRAINT "entity_classifications_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_bank_accounts" ADD CONSTRAINT "entity_bank_accounts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_due_diligence" ADD CONSTRAINT "entity_due_diligence_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_financials" ADD CONSTRAINT "entity_financials_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_risk_scores" ADD CONSTRAINT "entity_risk_scores_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_org_relationships" ADD CONSTRAINT "entity_org_relationships_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_org_relationships" ADD CONSTRAINT "entity_org_relationships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_engagements" ADD CONSTRAINT "service_engagements_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_engagements" ADD CONSTRAINT "service_engagements_serviceCatalogueId_fkey" FOREIGN KEY ("serviceCatalogueId") REFERENCES "service_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_engagements" ADD CONSTRAINT "service_engagements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
