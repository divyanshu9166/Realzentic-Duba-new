import { z } from 'zod'

const optionalId = z.number().int().positive().optional().nullable()
const optionalDate = z.string().trim().optional().or(z.literal(''))

export const workOrderSchema = z.object({
  leaseId: optionalId,
  bookingId: optionalId,
  contactId: optionalId,
  assignedToId: optionalId,
  title: z.string().trim().min(2, 'Title is required').max(160),
  description: z.string().trim().max(3000).optional().or(z.literal('')),
  category: z.enum(['GENERAL', 'PLUMBING', 'ELECTRICAL', 'HVAC', 'CIVIL', 'CLEANING', 'OTHER']).default('GENERAL'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('OPEN'),
  vendorName: z.string().trim().max(160).optional().or(z.literal('')),
  vendorPhone: z.string().trim().max(40).optional().or(z.literal('')),
  vendorId: optionalId,
  attachments: z.array(z.string().url().max(2000)).max(20).default([]),
  scheduledAt: optionalDate,
  dueAt: optionalDate,
  estimatedCost: z.number().int().min(0).default(0),
  resolutionNotes: z.string().trim().max(3000).optional().or(z.literal('')),
})

export const workOrderStatusSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  actualCost: z.number().int().min(0).optional(),
  resolutionNotes: z.string().trim().max(3000).optional().or(z.literal('')),
  attachments: z.array(z.string().url().max(2000)).max(20).optional(),
})
