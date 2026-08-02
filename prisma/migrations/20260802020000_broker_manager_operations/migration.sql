-- Broker and manager operations: lead routing, rentals, maintenance,
-- billing, commissions, and listing publication tracking.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "responseDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_responseDueAt_idx" ON "Lead"("responseDueAt");

CREATE TABLE IF NOT EXISTS "LeadRoutingRule" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "source" TEXT,
  "emirate" TEXT,
  "community" TEXT,
  "responseSlaMinutes" INTEGER NOT NULL DEFAULT 15,
  "mode" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
  "staffIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "fixedStaffId" INTEGER,
  "roundRobinCursor" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadRoutingRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadRoutingRule_active_priority_idx"
  ON "LeadRoutingRule"("active", "priority");

CREATE TABLE IF NOT EXISTS "LeadAssignmentEvent" (
  "id" SERIAL NOT NULL,
  "leadId" INTEGER NOT NULL,
  "ruleId" INTEGER,
  "fromStaffId" INTEGER,
  "toStaffId" INTEGER,
  "reason" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responseDueAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "LeadAssignmentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadAssignmentEvent_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadAssignmentEvent_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "LeadRoutingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadAssignmentEvent_fromStaffId_fkey"
    FOREIGN KEY ("fromStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadAssignmentEvent_toStaffId_fkey"
    FOREIGN KEY ("toStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LeadAssignmentEvent_leadId_assignedAt_idx"
  ON "LeadAssignmentEvent"("leadId", "assignedAt");
CREATE INDEX IF NOT EXISTS "LeadAssignmentEvent_toStaffId_respondedAt_idx"
  ON "LeadAssignmentEvent"("toStaffId", "respondedAt");
CREATE INDEX IF NOT EXISTS "LeadAssignmentEvent_responseDueAt_idx"
  ON "LeadAssignmentEvent"("responseDueAt");

CREATE TABLE IF NOT EXISTS "RentalDeal" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "contactId" INTEGER NOT NULL,
  "assignedAgentId" INTEGER,
  "projectId" INTEGER,
  "unitId" INTEGER,
  "dealType" TEXT NOT NULL DEFAULT 'NEW_LEASE',
  "status" TEXT NOT NULL DEFAULT 'NEGOTIATION',
  "annualRent" INTEGER NOT NULL,
  "monthlyRent" INTEGER,
  "securityDeposit" INTEGER NOT NULL DEFAULT 0,
  "agencyFee" INTEGER NOT NULL DEFAULT 0,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "source" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RentalDeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RentalDeal_displayId_key" UNIQUE ("displayId"),
  CONSTRAINT "RentalDeal_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RentalDeal_assignedAgentId_fkey"
    FOREIGN KEY ("assignedAgentId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RentalDeal_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RentalDeal_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RentalDeal_contactId_idx" ON "RentalDeal"("contactId");
CREATE INDEX IF NOT EXISTS "RentalDeal_assignedAgentId_idx" ON "RentalDeal"("assignedAgentId");
CREATE INDEX IF NOT EXISTS "RentalDeal_status_idx" ON "RentalDeal"("status");
CREATE INDEX IF NOT EXISTS "RentalDeal_endDate_idx" ON "RentalDeal"("endDate");

CREATE TABLE IF NOT EXISTS "Lease" (
  "id" SERIAL NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "rentalDealId" INTEGER NOT NULL,
  "contactId" INTEGER NOT NULL,
  "assignedAgentId" INTEGER,
  "unitId" INTEGER,
  "ejariNumber" TEXT,
  "ejariStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "renewalNoticeDate" TIMESTAMP(3) NOT NULL,
  "annualRent" INTEGER NOT NULL,
  "securityDeposit" INTEGER NOT NULL DEFAULT 0,
  "noticeDays" INTEGER NOT NULL DEFAULT 90,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "landlordName" TEXT,
  "landlordPhone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lease_contractNumber_key" UNIQUE ("contractNumber"),
  CONSTRAINT "Lease_rentalDealId_key" UNIQUE ("rentalDealId"),
  CONSTRAINT "Lease_ejariNumber_key" UNIQUE ("ejariNumber"),
  CONSTRAINT "Lease_rentalDealId_fkey"
    FOREIGN KEY ("rentalDealId") REFERENCES "RentalDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Lease_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Lease_assignedAgentId_fkey"
    FOREIGN KEY ("assignedAgentId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Lease_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Lease_contactId_idx" ON "Lease"("contactId");
CREATE INDEX IF NOT EXISTS "Lease_status_idx" ON "Lease"("status");
CREATE INDEX IF NOT EXISTS "Lease_endDate_idx" ON "Lease"("endDate");
CREATE INDEX IF NOT EXISTS "Lease_renewalNoticeDate_idx" ON "Lease"("renewalNoticeDate");

CREATE TABLE IF NOT EXISTS "LeaseRenewal" (
  "id" SERIAL NOT NULL,
  "leaseId" INTEGER NOT NULL,
  "proposedStart" TIMESTAMP(3) NOT NULL,
  "proposedEnd" TIMESTAMP(3) NOT NULL,
  "proposedRent" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reminderSentAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaseRenewal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeaseRenewal_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LeaseRenewal_leaseId_idx" ON "LeaseRenewal"("leaseId");
CREATE INDEX IF NOT EXISTS "LeaseRenewal_status_idx" ON "LeaseRenewal"("status");

CREATE TABLE IF NOT EXISTS "WorkOrder" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "leaseId" INTEGER,
  "bookingId" INTEGER,
  "contactId" INTEGER,
  "assignedToId" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "vendorName" TEXT,
  "vendorPhone" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "estimatedCost" INTEGER NOT NULL DEFAULT 0,
  "actualCost" INTEGER NOT NULL DEFAULT 0,
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkOrder_displayId_key" UNIQUE ("displayId"),
  CONSTRAINT "WorkOrder_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkOrder_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkOrder_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkOrder_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX IF NOT EXISTS "WorkOrder_assignedToId_status_idx" ON "WorkOrder"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "WorkOrder_dueAt_idx" ON "WorkOrder"("dueAt");
CREATE INDEX IF NOT EXISTS "WorkOrder_leaseId_idx" ON "WorkOrder"("leaseId");
CREATE INDEX IF NOT EXISTS "WorkOrder_bookingId_idx" ON "WorkOrder"("bookingId");

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "contactId" INTEGER,
  "dealId" INTEGER,
  "rentalDealId" INTEGER,
  "leaseId" INTEGER,
  "type" TEXT NOT NULL DEFAULT 'SERVICE',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "subtotal" INTEGER NOT NULL,
  "vatAmount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "balanceDue" INTEGER NOT NULL,
  "lineItems" JSONB NOT NULL,
  "notes" TEXT,
  "fileUrl" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_displayId_key" UNIQUE ("displayId"),
  CONSTRAINT "Invoice_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Invoice_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Invoice_rentalDealId_fkey"
    FOREIGN KEY ("rentalDealId") REFERENCES "RentalDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Invoice_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Invoice_contactId_idx" ON "Invoice"("contactId");
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX IF NOT EXISTS "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX IF NOT EXISTS "Invoice_dealId_idx" ON "Invoice"("dealId");
CREATE INDEX IF NOT EXISTS "Invoice_rentalDealId_idx" ON "Invoice"("rentalDealId");
CREATE INDEX IF NOT EXISTS "Invoice_leaseId_idx" ON "Invoice"("leaseId");

UPDATE "DailyPayment" p
SET "invoiceId" = NULL
WHERE "invoiceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."id" = p."invoiceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyPayment_invoiceId_fkey'
  ) THEN
    ALTER TABLE "DailyPayment"
      ADD CONSTRAINT "DailyPayment_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Contract" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'SERVICE',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "contactId" INTEGER,
  "dealId" INTEGER,
  "rentalDealId" INTEGER,
  "leaseId" INTEGER,
  "invoiceId" INTEGER,
  "templateId" INTEGER,
  "fileUrl" TEXT,
  "signedFileUrl" TEXT,
  "signedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Contract_displayId_key" UNIQUE ("displayId"),
  CONSTRAINT "Contract_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Contract_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Contract_rentalDealId_fkey"
    FOREIGN KEY ("rentalDealId") REFERENCES "RentalDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Contract_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Contract_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Contract_status_idx" ON "Contract"("status");
CREATE INDEX IF NOT EXISTS "Contract_contactId_idx" ON "Contract"("contactId");
CREATE INDEX IF NOT EXISTS "Contract_leaseId_idx" ON "Contract"("leaseId");

CREATE TABLE IF NOT EXISTS "CommissionLedger" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "beneficiaryType" TEXT NOT NULL DEFAULT 'AGENT',
  "staffId" INTEGER,
  "dealId" INTEGER,
  "rentalDealId" INTEGER,
  "invoiceId" INTEGER,
  "basisAmount" INTEGER NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionLedger_displayId_key" UNIQUE ("displayId"),
  CONSTRAINT "CommissionLedger_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommissionLedger_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommissionLedger_rentalDealId_fkey"
    FOREIGN KEY ("rentalDealId") REFERENCES "RentalDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommissionLedger_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CommissionLedger_staffId_status_idx"
  ON "CommissionLedger"("staffId", "status");
CREATE INDEX IF NOT EXISTS "CommissionLedger_beneficiaryType_status_idx"
  ON "CommissionLedger"("beneficiaryType", "status");
CREATE INDEX IF NOT EXISTS "CommissionLedger_dealId_idx" ON "CommissionLedger"("dealId");
CREATE INDEX IF NOT EXISTS "CommissionLedger_rentalDealId_idx" ON "CommissionLedger"("rentalDealId");

CREATE TABLE IF NOT EXISTS "ListingPublication" (
  "id" SERIAL NOT NULL,
  "portalName" TEXT NOT NULL,
  "projectId" INTEGER,
  "unitId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "externalListingId" TEXT,
  "listingUrl" TEXT,
  "lastPublishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingPublication_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ListingPublication_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ListingPublication_portalName_projectId_unitId_key"
    UNIQUE ("portalName", "projectId", "unitId")
);

CREATE INDEX IF NOT EXISTS "ListingPublication_status_idx" ON "ListingPublication"("status");
CREATE INDEX IF NOT EXISTS "ListingPublication_portalName_idx" ON "ListingPublication"("portalName");

ALTER TABLE "Expense"
  ADD COLUMN IF NOT EXISTS "workOrderId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Expense_workOrderId_fkey'
  ) THEN
    ALTER TABLE "Expense"
      ADD CONSTRAINT "Expense_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Expense_workOrderId_idx" ON "Expense"("workOrderId");

-- Delayed automated email delivery uses recipient-level scheduling so a lead
-- event can queue a message without blocking the CRM transaction.
ALTER TABLE "EmailRecipient"
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "EmailRecipient_scheduledAt_status_idx"
  ON "EmailRecipient"("scheduledAt", "status");

-- Structured lead-to-project attribution and idempotent renewal scheduling.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
CREATE INDEX IF NOT EXISTS "Lead_projectId_idx" ON "Lead"("projectId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_projectId_fkey') THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Lease"
  ADD COLUMN IF NOT EXISTS "renewalReminderSentAt" TIMESTAMP(3);

-- Contract signatures are linked to the dedicated billing contract while the
-- existing generic document signature workflow remains backward-compatible.
ALTER TABLE "DocumentSignature"
  ADD COLUMN IF NOT EXISTS "contractId" INTEGER;
CREATE INDEX IF NOT EXISTS "DocumentSignature_contractId_idx" ON "DocumentSignature"("contractId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentSignature_contractId_fkey') THEN
    ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_contractId_fkey"
      FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Separate outbound listing credentials from inbound lead-webhook settings.
ALTER TABLE "PortalConfig"
  ADD COLUMN IF NOT EXISTS "listingApiUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "listingApiKey" TEXT;

CREATE TABLE IF NOT EXISTS "VendorBill" (
  "id" SERIAL NOT NULL,
  "displayId" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "vendorPhone" TEXT,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "subtotal" INTEGER NOT NULL,
  "vatAmount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "balanceDue" INTEGER NOT NULL,
  "notes" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorBill_displayId_key" UNIQUE ("displayId")
);
CREATE INDEX IF NOT EXISTS "VendorBill_status_idx" ON "VendorBill"("status");
CREATE INDEX IF NOT EXISTS "VendorBill_dueDate_idx" ON "VendorBill"("dueDate");
CREATE INDEX IF NOT EXISTS "VendorBill_vendorName_idx" ON "VendorBill"("vendorName");

ALTER TABLE "DailyPayment"
  ADD COLUMN IF NOT EXISTS "vendorBillId" INTEGER;
CREATE INDEX IF NOT EXISTS "DailyPayment_vendorBillId_idx" ON "DailyPayment"("vendorBillId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyPayment_vendorBillId_fkey') THEN
    ALTER TABLE "DailyPayment" ADD CONSTRAINT "DailyPayment_vendorBillId_fkey"
      FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
