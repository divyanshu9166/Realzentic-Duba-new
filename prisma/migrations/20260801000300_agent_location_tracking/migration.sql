-- Live field-force GPS stream. The application model existed without a
-- migration, which meant prisma migrate deploy never created this table.

ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "locationSharingStoppedAt" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "locationSharingExpiresAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AgentLocation" (
  "id" SERIAL NOT NULL,
  "staffId" INTEGER NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyM" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "visitId" INTEGER,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentLocation_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentLocation_staffId_idx" ON "AgentLocation"("staffId");
CREATE INDEX IF NOT EXISTS "AgentLocation_recordedAt_idx" ON "AgentLocation"("recordedAt");
CREATE INDEX IF NOT EXISTS "AgentLocation_staffId_recordedAt_idx" ON "AgentLocation"("staffId", "recordedAt");
