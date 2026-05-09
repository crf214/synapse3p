-- Migration: simplify MergedAuthorization
-- Remove credit/debit netting fields; totalAmount is now the only amount figure.

ALTER TABLE "merged_authorizations"
  DROP COLUMN IF EXISTS "creditAmount",
  DROP COLUMN IF EXISTS "netAmount";

ALTER TABLE "merged_auth_items"
  DROP COLUMN IF EXISTS "isCredit";
