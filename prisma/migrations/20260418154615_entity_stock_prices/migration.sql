-- CreateTable
CREATE TABLE "entity_stock_prices" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "priceDate" TIMESTAMP(3) NOT NULL,
    "closePrice" DOUBLE PRECISION NOT NULL,
    "openPrice" DOUBLE PRECISION,
    "highPrice" DOUBLE PRECISION,
    "lowPrice" DOUBLE PRECISION,
    "volume" BIGINT,
    "changeAmt" DOUBLE PRECISION,
    "changePct" DOUBLE PRECISION,
    "week52High" DOUBLE PRECISION,
    "week52Low" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT 'yahoo_finance',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_stock_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_stock_prices_entityId_priceDate_idx" ON "entity_stock_prices"("entityId", "priceDate");

-- CreateIndex
CREATE INDEX "entity_stock_prices_ticker_priceDate_idx" ON "entity_stock_prices"("ticker", "priceDate");

-- CreateIndex
CREATE UNIQUE INDEX "entity_stock_prices_entityId_ticker_priceDate_key" ON "entity_stock_prices"("entityId", "ticker", "priceDate");
