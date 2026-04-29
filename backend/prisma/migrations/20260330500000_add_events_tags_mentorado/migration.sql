-- Add tags and is_mentorado to patients
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "is_mentorado" BOOLEAN NOT NULL DEFAULT false;

-- Events table
CREATE TABLE IF NOT EXISTS "events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID,
  "professional_id" UUID NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "date" DATE NOT NULL,
  "type" VARCHAR(20) NOT NULL DEFAULT 'online',
  "url" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "events_professional_id_idx" ON "events"("professional_id");
CREATE INDEX IF NOT EXISTS "events_organization_id_idx" ON "events"("organization_id");

-- Event participations table
CREATE TABLE IF NOT EXISTS "event_participations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "patient_id" UUID NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "status" VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_participations_event_patient_unique" UNIQUE ("event_id", "patient_id")
);

CREATE INDEX IF NOT EXISTS "event_participations_event_id_idx" ON "event_participations"("event_id");
CREATE INDEX IF NOT EXISTS "event_participations_patient_id_idx" ON "event_participations"("patient_id");
