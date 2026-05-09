-- Add email verification fields to users
ALTER TABLE "users"
  ADD COLUMN "emailVerified"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailVerifyToken" TEXT;

CREATE UNIQUE INDEX "users_emailVerifyToken_key" ON "users"("emailVerifyToken");

-- Add invite_tokens table
CREATE TABLE "invite_tokens" (
  "id"        TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "email"     TEXT,
  "usedAt"    TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invite_tokens_token_key" ON "invite_tokens"("token");
