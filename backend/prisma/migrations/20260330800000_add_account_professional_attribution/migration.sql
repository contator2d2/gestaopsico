-- Track which professional owns the entry, who created it and who settled it
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "paid_by_id" UUID;

CREATE INDEX IF NOT EXISTS "accounts_professional_id_idx" ON "accounts" ("professional_id");
CREATE INDEX IF NOT EXISTS "accounts_paid_by_id_idx" ON "accounts" ("paid_by_id");

-- Backfill: existing entries were created by their owner
UPDATE "accounts" SET "created_by_id" = "professional_id" WHERE "created_by_id" IS NULL;
UPDATE "accounts" SET "paid_by_id" = "professional_id" WHERE "paid_by_id" IS NULL AND "status" = 'paid';
