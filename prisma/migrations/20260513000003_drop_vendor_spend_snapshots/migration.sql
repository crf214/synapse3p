-- Drop VendorSpendSnapshot — reads replaced with direct Invoice queries in Phase 1B.
-- Table is expected to be empty; if not, data should be migrated before applying.
DROP TABLE IF EXISTS "vendor_spend_snapshots";
