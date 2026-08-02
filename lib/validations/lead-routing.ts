import { z } from 'zod'

const optionalText = z.string().trim().max(120).optional().or(z.literal(''))

export const leadRoutingRuleSchema = z.object({
  name: z.string().trim().min(2, 'Rule name is required').max(120),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  source: optionalText,
  emirate: optionalText,
  community: optionalText,
  responseSlaMinutes: z.number().int().min(1).max(10080).default(15),
  mode: z.enum(['ROUND_ROBIN', 'LEAST_LOADED', 'FIXED']),
  staffIds: z.array(z.number().int().positive()).min(1, 'Select at least one staff member'),
  fixedStaffId: z.number().int().positive().optional().nullable(),
})

export const leadAssignmentSchema = z.object({
  leadId: z.number().int().positive(),
  staffId: z.number().int().positive(),
  reason: z.string().trim().min(2).max(240).default('Manual assignment'),
  responseSlaMinutes: z.number().int().min(1).max(10080).optional(),
})

export type LeadRoutingRuleInput = z.infer<typeof leadRoutingRuleSchema>
