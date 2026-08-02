-- Villa-specific inventory attributes. Nullable measurements keep existing
-- apartment and legacy inventory rows valid while allowing accurate villa
-- cataloguing and filtering.

ALTER TABLE "Unit"
  ADD COLUMN IF NOT EXISTS "plotArea" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "bedroomCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "bathroomCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "maidRoom" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "driverRoom" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "privateGarden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "privatePool" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "furnishingStatus" TEXT;
