-- Follow-up UAE migration fixes. Kept separate from the first UAE migration
-- so databases that have already deployed it can upgrade safely.

ALTER TABLE "Contact" RENAME COLUMN "nriCountry" TO "nationality";
ALTER TABLE "Contact" RENAME COLUMN "nriCurrency" TO "preferredCurrency";
ALTER TABLE "Contact" ALTER COLUMN "preferredCurrency" SET DEFAULT 'AED';

ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "pfEmployee";
ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "pfEmployer";
ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "esiEmployee";
ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "esiEmployer";
ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "professionalTax";
ALTER TABLE "Payslip" DROP COLUMN IF EXISTS "tds";
ALTER TABLE "Payslip" RENAME COLUMN "hra" TO "housingAllowance";
ALTER TABLE "Payslip" RENAME COLUMN "da" TO "transportAllowance";
ALTER TABLE "Payslip" RENAME COLUMN "specialAllowance" TO "otherAllowance";

ALTER TABLE "wa_agent_configs" ALTER COLUMN "languages" SET DEFAULT ARRAY['en']::TEXT[];
UPDATE "wa_agent_configs"
SET "languages" = CASE
  WHEN cardinality(array_remove("languages", 'hi')) = 0 THEN ARRAY['en']
  ELSE array_remove("languages", 'hi')
END
WHERE 'hi' = ANY("languages");

ALTER TABLE "Unit" RENAME COLUMN "carpetArea" TO "netArea";
ALTER TABLE "Unit" RENAME COLUMN "superBuiltUpArea" TO "builtUpArea";
ALTER TABLE "Unit" ADD COLUMN "areaUnit" TEXT NOT NULL DEFAULT 'sqft';
