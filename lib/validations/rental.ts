import { z } from 'zod'

const date = z.string().trim().min(1)
const money = z.number().int().min(0)

export const rentalDealSchema = z.object({
  contactId: z.number().int().positive(),
  assignedAgentId: z.number().int().positive().optional().nullable(),
  projectId: z.number().int().positive().optional().nullable(),
  unitId: z.number().int().positive().optional().nullable(),
  dealType: z.enum(['NEW_LEASE', 'RENEWAL']).default('NEW_LEASE'),
  status: z.enum(['DRAFT', 'NEGOTIATION', 'ACTIVE', 'COMPLETED', 'CANCELLED']).default('NEGOTIATION'),
  annualRent: money,
  securityDeposit: money.default(0),
  agencyFee: money.default(0),
  startDate: date.optional().or(z.literal('')),
  endDate: date.optional().or(z.literal('')),
  source: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

export const leaseSchema = z.object({
  rentalDealId: z.number().int().positive(),
  contractNumber: z.string().trim().min(2).max(80),
  contactId: z.number().int().positive(),
  assignedAgentId: z.number().int().positive().optional().nullable(),
  unitId: z.number().int().positive().optional().nullable(),
  ejariNumber: z.string().trim().max(80).optional().or(z.literal('')),
  ejariStatus: z.enum(['PENDING', 'SUBMITTED', 'ACTIVE', 'EXPIRED', 'NOT_REQUIRED']).default('PENDING'),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']).default('ACTIVE'),
  startDate: date,
  endDate: date,
  renewalNoticeDate: date,
  annualRent: money,
  securityDeposit: money.default(0),
  noticeDays: z.number().int().min(1).max(365).default(90),
  autoRenew: z.boolean().default(false),
  landlordId: z.number().int().positive().optional().nullable(),
  reraIndexRent: money.optional().nullable(),
  landlordName: z.string().trim().max(160).optional().or(z.literal('')),
  landlordPhone: z.string().trim().max(40).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

export const leaseRenewalSchema = z.object({
  leaseId: z.number().int().positive(),
  proposedStart: date,
  proposedEnd: date,
  proposedRent: money,
  reraIndexRent: money.optional().nullable(),
  status: z.enum(['DRAFT', 'OFFERED', 'ACCEPTED', 'DECLINED', 'COMPLETED']).default('DRAFT'),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})
