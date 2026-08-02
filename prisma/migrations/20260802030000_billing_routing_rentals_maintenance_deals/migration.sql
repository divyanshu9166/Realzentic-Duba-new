-- Additive Dubai operations improvements. Existing data is preserved.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "community" TEXT,
  ADD COLUMN IF NOT EXISTS "slaAlertedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaEscalatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Lead_status_responseDueAt_firstResponseAt_idx"
  ON "Lead" ("status", "responseDueAt", "firstResponseAt");

ALTER TABLE "LeadRoutingRule"
  ADD COLUMN IF NOT EXISTS "businessHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "businessHoursStartMinute" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN IF NOT EXISTS "businessHoursEndMinute" INTEGER NOT NULL DEFAULT 1260,
  ADD COLUMN IF NOT EXISTS "businessDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
  ADD COLUMN IF NOT EXISTS "escalationEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "escalationAfterMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "Lease"
  ADD COLUMN IF NOT EXISTS "landlordId" INTEGER,
  ADD COLUMN IF NOT EXISTS "reraIndexRent" INTEGER,
  ADD COLUMN IF NOT EXISTS "maintenanceAccessToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Lease_maintenanceAccessToken_key" ON "Lease" ("maintenanceAccessToken");
ALTER TABLE "LeaseRenewal"
  ADD COLUMN IF NOT EXISTS "reraIndexRent" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxIncreasePercent" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "maxPermittedRent" INTEGER,
  ADD COLUMN IF NOT EXISTS "complianceWarning" TEXT;

ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "vendorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "maintenanceScheduleId" INTEGER,
  ADD COLUMN IF NOT EXISTS "attachments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "breachAlertedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "WorkOrder_status_dueAt_breachAlertedAt_idx"
  ON "WorkOrder" ("status", "dueAt", "breachAlertedAt");

CREATE TABLE IF NOT EXISTS "Landlord" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Landlord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Landlord_name_idx" ON "Landlord" ("name");
CREATE INDEX IF NOT EXISTS "Landlord_phone_idx" ON "Landlord" ("phone");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lease_landlordId_fkey') THEN
    ALTER TABLE "Lease" ADD CONSTRAINT "Lease_landlordId_fkey"
      FOREIGN KEY ("landlordId") REFERENCES "Landlord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SecurityDepositSettlement" (
  "id" SERIAL NOT NULL,
  "leaseId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "originalDeposit" INTEGER NOT NULL,
  "refundAmount" INTEGER NOT NULL DEFAULT 0,
  "deductions" JSONB NOT NULL,
  "refundDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityDepositSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SecurityDepositSettlement_leaseId_key" ON "SecurityDepositSettlement" ("leaseId");
CREATE INDEX IF NOT EXISTS "SecurityDepositSettlement_status_idx" ON "SecurityDepositSettlement" ("status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SecurityDepositSettlement_leaseId_fkey') THEN
    ALTER TABLE "SecurityDepositSettlement" ADD CONSTRAINT "SecurityDepositSettlement_leaseId_fkey"
      FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MaintenanceVendor" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rating" DOUBLE PRECISION,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceVendor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MaintenanceVendor_active_idx" ON "MaintenanceVendor" ("active");
CREATE INDEX IF NOT EXISTS "MaintenanceVendor_name_idx" ON "MaintenanceVendor" ("name");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_vendorId_fkey') THEN
    ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "MaintenanceVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
ALTER TABLE "VendorBill" ADD COLUMN IF NOT EXISTS "vendorId" INTEGER;
CREATE INDEX IF NOT EXISTS "VendorBill_vendorId_idx" ON "VendorBill" ("vendorId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VendorBill_vendorId_fkey') THEN
    ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "MaintenanceVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MaintenanceSchedule" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "leaseId" INTEGER,
  "vendorId" INTEGER,
  "assignedToId" INTEGER,
  "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
  "nextDueAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSpawnedAt" TIMESTAMP(3),
  "estimatedCost" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MaintenanceSchedule_active_nextDueAt_idx" ON "MaintenanceSchedule" ("active", "nextDueAt");
CREATE INDEX IF NOT EXISTS "MaintenanceSchedule_leaseId_idx" ON "MaintenanceSchedule" ("leaseId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MaintenanceSchedule_leaseId_fkey') THEN
    ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_leaseId_fkey"
      FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MaintenanceSchedule_vendorId_fkey') THEN
    ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "MaintenanceVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MaintenanceSchedule_assignedToId_fkey') THEN
    ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrder_maintenanceScheduleId_fkey') THEN
    ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_maintenanceScheduleId_fkey"
      FOREIGN KEY ("maintenanceScheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InvoiceNumberSequence" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceNumberSequence_pkey" PRIMARY KEY ("id")
);
INSERT INTO "InvoiceNumberSequence" ("id", "nextNumber", "updatedAt")
VALUES (1, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "CommissionLedger"
  ADD COLUMN IF NOT EXISTS "sourceKey" TEXT,
  ADD COLUMN IF NOT EXISTS "reversalOfId" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionLedger_sourceKey_key" ON "CommissionLedger" ("sourceKey");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedger_reversalOfId_fkey') THEN
    ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_reversalOfId_fkey"
      FOREIGN KEY ("reversalOfId") REFERENCES "CommissionLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CommissionSplit" (
  "id" SERIAL NOT NULL,
  "commissionId" INTEGER NOT NULL,
  "beneficiaryType" TEXT NOT NULL DEFAULT 'AGENT',
  "staffId" INTEGER,
  "amount" INTEGER NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionSplit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommissionSplit_commissionId_idx" ON "CommissionSplit" ("commissionId");
CREATE INDEX IF NOT EXISTS "CommissionSplit_staffId_idx" ON "CommissionSplit" ("staffId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionSplit_commissionId_fkey') THEN
    ALTER TABLE "CommissionSplit" ADD CONSTRAINT "CommissionSplit_commissionId_fkey"
      FOREIGN KEY ("commissionId") REFERENCES "CommissionLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionSplit_staffId_fkey') THEN
    ALTER TABLE "CommissionSplit" ADD CONSTRAINT "CommissionSplit_staffId_fkey"
      FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
