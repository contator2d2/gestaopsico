-- Shared agenda between professionals of the same organization (single-room clinics)
ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "shared_agenda" BOOLEAN NOT NULL DEFAULT false;
