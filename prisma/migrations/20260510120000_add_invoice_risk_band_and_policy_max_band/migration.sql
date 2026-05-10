-- AlterTable: add riskBand to invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "riskBand" "RiskBand";

-- AlterTable: add maxRiskBand to auto_approve_policies
ALTER TABLE "auto_approve_policies" ADD COLUMN IF NOT EXISTS "maxRiskBand" "RiskBand";
