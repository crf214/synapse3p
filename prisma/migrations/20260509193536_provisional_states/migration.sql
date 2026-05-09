-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('ENTITY_CONFIRMED', 'RISK_SCORE_READY', 'ONBOARDING_COMPLETE', 'APPROVAL_COMPLETE');

-- AlterEnum
ALTER TYPE "EntityStatus" ADD VALUE 'PROVISIONAL';

-- AlterEnum
ALTER TYPE "OnboardingInstanceStatus" ADD VALUE 'WAITING';

-- CreateTable
CREATE TABLE "step_dependencies" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "dependencyType" "DependencyType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "step_dependencies_dependencyType_subjectId_resolvedAt_idx" ON "step_dependencies"("dependencyType", "subjectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "step_dependencies_stepId_idx" ON "step_dependencies"("stepId");

-- AddForeignKey
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "onboarding_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
