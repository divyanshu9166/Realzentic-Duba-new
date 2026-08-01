-- Dubai closing workflow: developer NOC and DLD Trustee transfer appointment.

CREATE TYPE "DeveloperNocStatus" AS ENUM ('NotRequested', 'Requested', 'Received', 'Rejected');
CREATE TYPE "DldTransferStatus" AS ENUM ('NotStarted', 'TrusteeAppointmentScheduled', 'TransferCompleted', 'Cancelled');

ALTER TABLE "Deal"
  ADD COLUMN "developerNocStatus" "DeveloperNocStatus" NOT NULL DEFAULT 'NotRequested',
  ADD COLUMN "dldTransferStatus" "DldTransferStatus" NOT NULL DEFAULT 'NotStarted',
  ADD COLUMN "dldTrusteeOffice" TEXT,
  ADD COLUMN "dldTransferNotes" TEXT;

ALTER TABLE "Appointment" ADD COLUMN "dealId" INTEGER;
CREATE INDEX "Appointment_dealId_idx" ON "Appointment"("dealId");
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
