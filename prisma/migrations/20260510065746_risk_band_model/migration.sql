-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "entities" ADD COLUMN     "riskBand" "RiskBand",
ADD COLUMN     "riskBandOverride" "RiskBand",
ADD COLUMN     "riskBandOverrideAt" TIMESTAMP(3),
ADD COLUMN     "riskBandOverrideBy" TEXT,
ADD COLUMN     "riskBandOverrideReason" TEXT,
ADD COLUMN     "riskBandUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "entity_risk_scores" ADD COLUMN     "band" "RiskBand",
ADD COLUMN     "computedAt" TIMESTAMP(3),
ADD COLUMN     "factors" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION;
