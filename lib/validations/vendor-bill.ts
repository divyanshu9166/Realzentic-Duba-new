import { z } from 'zod'

export const vendorBillSchema = z.object({
  vendorId: z.number().int().positive().optional().nullable(),
  vendorName: z.string().trim().min(1).max(200),
  vendorPhone: z.string().trim().max(30).optional().or(z.literal('')),
  description: z.string().trim().min(1).max(500),
  category: z.string().trim().max(100).optional().or(z.literal('')),
  dueDate: z.string().optional().or(z.literal('')),
  vatRate: z.number().min(0).max(100).default(5),
  amount: z.number().positive(),
  status: z.enum(['DRAFT', 'ISSUED']).default('ISSUED'),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
})

export const vendorBillPaymentSchema = z.object({
  vendorBillId: z.number().int().positive(),
  amount: z.number().positive(),
  method: z.string().trim().min(1).max(50),
  reference: z.string().trim().max(100).optional().or(z.literal('')),
  date: z.string().optional().or(z.literal('')),
})
