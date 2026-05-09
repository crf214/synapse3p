-- Add notifyOnApproval preference field
ALTER TABLE "notification_preferences" ADD COLUMN "notifyOnApproval" BOOLEAN NOT NULL DEFAULT true;
