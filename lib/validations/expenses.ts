import { z } from 'zod'

export const createExpenseSchema = z.object({
  date: z.string(),
  categoryId: z.number(),
  amount: z.number().min(1, 'Amount must be at least AED 1'),
  description: z.string().min(1, 'Description is required'),
  paymentMode: z.enum(['Cash', 'Card', 'Bank Transfer', 'Cheque', 'PDC', 'Mortgage Disbursement', 'Credit']).default('Cash'),
  reference: z.string().optional(),
  receipt: z.string().optional(),
  vendor: z.string().optional(),
  staffId: z.number().optional(),
  notes: z.string().optional(),
})

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  icon: z.string().optional(),
  color: z.string().optional(),
  budget: z.number().min(0).default(0),
})

export const createRecurringSchema = z.object({
  categoryId: z.number(),
  description: z.string().min(1),
  amount: z.number().min(1),
  paymentMode: z.enum(['Cash', 'Card', 'Bank Transfer', 'Cheque', 'PDC', 'Mortgage Disbursement', 'Credit']).default('Bank Transfer'),
  vendor: z.string().optional(),
  frequency: z.enum(['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly']).default('Monthly'),
  dayOfMonth: z.number().min(1).max(31).optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
})

export const dateRangeSchema = z.object({
  fromDate: z.string(),
  toDate: z.string(),
})

export const cashRegisterSchema = z.object({
  date: z.string(),
  openingCash: z.number().min(0).default(0),
  closingCash: z.number().min(0).optional(),
  cashIn: z.number().min(0).default(0),
  notes: z.string().optional(),
})

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>
