-- Phase 5: Add password reset fields to users table
ALTER TABLE "users" ADD COLUMN "passwordResetToken" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
