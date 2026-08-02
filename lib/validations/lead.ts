import { z } from 'zod'
import { LEAD_SOURCE_OPTIONS } from '@/lib/lead-sources'

export const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCE_OPTIONS),
  interest: z.string().min(1, 'Product interest is required'),
  projectId: z.number().int().positive().optional().nullable(),
  budget: z.string().optional(),
  notes: z.string().optional(),
})

export const updateLeadStatusSchema = z.object({
  id: z.number(),
  status: z.enum(['NEW', 'CONTACTED', 'SHOWROOM_VISIT', 'QUOTATION', 'WON', 'LOST']),
})

export const addFollowUpSchema = z.object({
  leadId: z.number(),
  day: z.number().min(1),
  message: z.string().min(1),
  date: z.string(),
})

export type CreateLeadInput = z.infer<typeof createLeadSchema>
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>
