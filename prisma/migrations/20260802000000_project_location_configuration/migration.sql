-- Project-level location governance for geo-verified site visits.
-- Existing coordinates intentionally remain unconfirmed: an administrator
-- must review the pin in the Properties workspace before it can be scheduled.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "geofenceRadiusM" INTEGER NOT NULL DEFAULT 200;

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "locationConfirmedAt" TIMESTAMP(3);
