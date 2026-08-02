import { z } from 'zod'

const positiveMoney = z.number().int().positive()
const nonNegativeMoney = z.number().int().min(0)

export const invoiceLineItemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.number().positive().max(100000),
  unitPrice: nonNegativeMoney,
})

export const invoiceSchema = z.object({
  contactId: z.number().int().positive().optional().nullable(),
  dealId: z.number().int().positive().optional().nullable(),
  rentalDealId: z.number().int().positive().optional().nullable(),
  leaseId: z.number().int().positive().optional().nullable(),
  type: z.enum(['SERVICE', 'COMMISSION', 'RENT', 'SECURITY_DEPOSIT', 'OTHER']).default('SERVICE'),
  status: z.enum(['DRAFT', 'ISSUED']).default('DRAFT'),
  dueDate: z.string().trim().optional().or(z.literal('')),
  vatRate: z.number().min(0).max(100).default(0),
  lineItems: z.array(invoiceLineItemSchema).min(1, 'At least one line item is required'),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

export const invoicePaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: positiveMoney,
  method: z.enum(['Cash', 'Card', 'Bank Transfer', 'Cheque', 'PDC']),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  date: z.string().trim().optional().or(z.literal('')),
})

export const contractSchema = z.object({
  title: z.string().trim().min(2).max(200),
  type: z.enum(['SALE', 'LEASE', 'RENEWAL', 'SERVICE', 'OTHER']).default('SERVICE'),
  status: z.enum(['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED']).default('DRAFT'),
  contactId: z.number().int().positive().optional().nullable(),
  dealId: z.number().int().positive().optional().nullable(),
  rentalDealId: z.number().int().positive().optional().nullable(),
  leaseId: z.number().int().positive().optional().nullable(),
  invoiceId: z.number().int().positive().optional().nullable(),
  fileUrl: z.string().trim().max(1000).optional().or(z.literal('')),
  expiresAt: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(3000).optional().or(z.literal('')),
})

export const commissionSchema = z.object({
  beneficiaryType: z.enum(['AGENT', 'COMPANY']),
  staffId: z.number().int().positive().optional().nullable(),
  dealId: z.number().int().positive().optional().nullable(),
  rentalDealId: z.number().int().positive().optional().nullable(),
  invoiceId: z.number().int().positive().optional().nullable(),
  basisAmount: nonNegativeMoney,
  rate: z.number().min(0).max(100),
  amount: nonNegativeMoney,
  splits: z.array(z.object({
    beneficiaryType: z.enum(['AGENT', 'COMPANY']).default('AGENT'),
    staffId: z.number().int().positive().optional().nullable(),
    amount: nonNegativeMoney,
    rate: z.number().min(0).max(100).default(0),
    notes: z.string().trim().max(500).optional().or(z.literal('')),
  })).max(50).optional().default([]),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})
