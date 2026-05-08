/*
  Warnings:

  - The values [PARTNER,COUNTERPARTY,SERVICE_PROVIDER,FUND_SERVICE] on the enum `EntityType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `ultimateParentId` on the `entities` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `service_catalogue` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('ENTITY', 'INVOICE', 'PURCHASE_ORDER', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "EntityType_new" AS ENUM ('VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER');
ALTER TABLE "entity_classifications" ALTER COLUMN "type" TYPE "EntityType_new" USING ("type"::text::"EntityType_new");
ALTER TABLE "onboarding_workflows" ALTER COLUMN "entityTypes" TYPE "EntityType_new"[] USING ("entityTypes"::text::"EntityType_new"[]);
ALTER TYPE "EntityType" RENAME TO "EntityType_old";
ALTER TYPE "EntityType_new" RENAME TO "EntityType";
DROP TYPE "EntityType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "OnboardingInstanceStatus" ADD VALUE 'PENDING_SUB_WORKFLOW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OnboardingStepType" ADD VALUE 'PROCESSING_RULE';
ALTER TYPE "OnboardingStepType" ADD VALUE 'SUB_WORKFLOW';

-- DropForeignKey
ALTER TABLE "entities" DROP CONSTRAINT "entities_ultimateParentId_fkey";

-- DropIndex
DROP INDEX "service_catalogue_name_key";

-- AlterTable
ALTER TABLE "entities" DROP COLUMN "ultimateParentId",
ADD COLUMN     "stockTicker" TEXT;

-- AlterTable
ALTER TABLE "onboarding_instances" ADD COLUMN     "parentInstanceId" TEXT,
ADD COLUMN     "skippedSteps" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "onboarding_workflows" ADD COLUMN     "workflowType" "WorkflowType" NOT NULL DEFAULT 'ENTITY';

-- AlterTable
ALTER TABLE "service_catalogue" DROP COLUMN "category",
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- DropEnum
DROP TYPE "ServiceCategory";

-- AddForeignKey
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "service_catalogue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_parentInstanceId_fkey" FOREIGN KEY ("parentInstanceId") REFERENCES "onboarding_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
