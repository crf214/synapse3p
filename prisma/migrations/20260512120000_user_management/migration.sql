-- Phase 5: User management fields
ALTER TABLE "users" ADD COLUMN "isActive"      BOOLEAN   NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "lastLoginAt"   TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "roleChangedAt" TIMESTAMP(3);

-- InviteToken: store intended role so register route can apply it
ALTER TABLE "invite_tokens" ADD COLUMN "role" TEXT;
