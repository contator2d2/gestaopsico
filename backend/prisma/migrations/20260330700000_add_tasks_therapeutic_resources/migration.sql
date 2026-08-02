-- Create missing tables: tasks and therapeutic_resources

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patient_id" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "due_date" DATE,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tasks_patient_id_idx" ON "tasks"("patient_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_patient_id_fkey'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_patient_id_fkey"
      FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "therapeutic_resources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "professional_id" UUID,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "category" VARCHAR(100) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "file_url" TEXT,
  "external_url" TEXT,
  "is_global" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "therapeutic_resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "therapeutic_resources_professional_id_idx" ON "therapeutic_resources"("professional_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'therapeutic_resources_professional_id_fkey'
  ) THEN
    ALTER TABLE "therapeutic_resources"
      ADD CONSTRAINT "therapeutic_resources_professional_id_fkey"
      FOREIGN KEY ("professional_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
