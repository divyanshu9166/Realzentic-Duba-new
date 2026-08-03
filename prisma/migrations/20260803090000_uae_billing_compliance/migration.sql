-- UAE billing and commission compliance additions. Safe to run after the
-- additive Dubai operations migration; all changes are idempotent.

ALTER TABLE "StoreSettings"
  ADD COLUMN IF NOT EXISTS "taxInvoiceFooter" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "supplyDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "taxTreatment" TEXT NOT NULL DEFAULT 'STANDARD_5',
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'AED',
  ADD COLUMN IF NOT EXISTS "creditOfId" INTEGER;
CREATE INDEX IF NOT EXISTS "Invoice_creditOfId_idx" ON "Invoice" ("creditOfId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_creditOfId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditOfId_fkey"
      FOREIGN KEY ("creditOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "CommissionLedger"
  ADD COLUMN IF NOT EXISTS "brokerageAgreementRef" TEXT,
  ADD COLUMN IF NOT EXISTS "dldRegistrationDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payoutEligibleAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eligibilityStatus" TEXT NOT NULL DEFAULT 'PENDING_REGISTRATION',
  ADD COLUMN IF NOT EXISTS "eligibilityNote" TEXT;
