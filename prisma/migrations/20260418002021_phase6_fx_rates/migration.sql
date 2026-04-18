-- DropIndex
DROP INDEX "entity_activity_logs_entity_occurred";

-- DropIndex
DROP INDEX "entity_risk_scores_entity_scored";

-- DropIndex
DROP INDEX "erp_transactions_entity_date";

-- DropIndex
DROP INDEX "invoices_org_entity_status";

-- DropIndex
DROP INDEX "payment_instructions_org_status_due";

-- DropIndex
DROP INDEX "purchase_orders_org_status";

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "quoteCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ECB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_rates_quoteCurrency_rateDate_idx" ON "fx_rates"("quoteCurrency", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_baseCurrency_quoteCurrency_rateDate_key" ON "fx_rates"("baseCurrency", "quoteCurrency", "rateDate");
