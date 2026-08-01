-- India → Dubai (UAE) product migration.
-- Existing identifiers are renamed where possible so existing records are not
-- silently discarded. Monetary values are intentionally not FX-converted.

ALTER TABLE "Contact" RENAME COLUMN "gstNumber" TO "vatTrn";
ALTER TABLE "Contact" RENAME COLUMN "state" TO "emirate";

ALTER TABLE "Lead" ADD COLUMN "nationality" TEXT;
ALTER TABLE "Lead" ADD COLUMN "passportNumber" TEXT;
ALTER TABLE "Lead" ADD COLUMN "visaStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN "preferredLanguage" TEXT;

ALTER TABLE "Staff" RENAME COLUMN "panNumber" TO "emiratesId";
ALTER TABLE "Staff" RENAME COLUMN "bankAccount" TO "iban";
ALTER TABLE "Staff" RENAME COLUMN "ifscCode" TO "laborCardNo";
ALTER TABLE "Staff" RENAME COLUMN "uanNumber" TO "mohreNo";
ALTER TABLE "Staff" DROP COLUMN "pfEnrolled";
ALTER TABLE "Staff" DROP COLUMN "esiEnrolled";
ALTER TABLE "Staff" DROP COLUMN "pfNumber";
ALTER TABLE "Staff" DROP COLUMN "esiNumber";
ALTER TABLE "Staff" DROP COLUMN "professionalTaxState";
ALTER TABLE "Staff" DROP COLUMN "tdsMonthly";
ALTER TABLE "Staff" ADD COLUMN "visaStatus" TEXT;
ALTER TABLE "Staff" ADD COLUMN "eosbAccrued" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN "wpsRegistered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StoreSettings" RENAME COLUMN "bankIfsc" TO "bankIban";
ALTER TABLE "StoreSettings" RENAME COLUMN "gstNumber" TO "vatTrn";
ALTER TABLE "StoreSettings" RENAME COLUMN "gstRate" TO "vatRate";
ALTER TABLE "StoreSettings" DROP COLUMN "bankUpiId";
ALTER TABLE "StoreSettings" ALTER COLUMN "vatRate" SET DEFAULT 5.0;
UPDATE "StoreSettings" SET "vatRate" = 5.0 WHERE "vatRate" = 18.0;
UPDATE "StoreSettings" SET "currency" = 'AED' WHERE "currency" = 'INR';

ALTER TABLE "deals" ALTER COLUMN "currency" SET DEFAULT 'AED';
UPDATE "deals" SET "currency" = 'AED' WHERE "currency" = 'INR';

ALTER TABLE "DailyPayment" RENAME COLUMN "gstAmount" TO "vatAmount";

ALTER TABLE "Project" RENAME COLUMN "state" TO "emirate";
ALTER TABLE "Project" RENAME COLUMN "reraNumber" TO "dldProjectRegNo";
ALTER TABLE "Project" RENAME COLUMN "reraExpiry" TO "dldProjectRegExpiry";
ALTER TABLE "Project" ALTER COLUMN "emirate" SET DEFAULT 'Dubai';
ALTER TABLE "Project" ADD COLUMN "escrowAccountNo" TEXT;
ALTER TABLE "Project" ADD COLUMN "trakheesiPermitNo" TEXT;
ALTER TABLE "Project" ADD COLUMN "saleType" TEXT;
ALTER TABLE "Project" ADD COLUMN "isFreeholdZone" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CostSheet" RENAME COLUMN "stampDuty" TO "dldTransferFee";
ALTER TABLE "CostSheet" RENAME COLUMN "gst" TO "vatAmount";

ALTER TABLE "ChannelPartner" RENAME COLUMN "reraBrokerNo" TO "brnNumber";
ALTER TABLE "ChannelPartner" RENAME COLUMN "panNumber" TO "tradeLicenseNo";
ALTER TABLE "ChannelPartner" ADD COLUMN "ornNumber" TEXT;

ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Studio';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Apartment1';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Apartment2';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Apartment3';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Apartment4Plus';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Penthouse';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Villa';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Townhouse';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Duplex';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Retail';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'Warehouse';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'LandPlot';

DROP TABLE IF EXISTS "IndiaMartLead";
DROP TABLE IF EXISTS "IndiaMartConfig";
