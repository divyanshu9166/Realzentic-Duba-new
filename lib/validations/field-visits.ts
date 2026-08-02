import { z } from 'zod'
import { idSchema, moneyAmount, rating } from '@/lib/validations/common'

/**
 * Zod schemas for Site Visit 2.0 (Module 9) server actions.
 *
 * These validate the inputs to the geo check-in, structured feedback, and
 * follow-up/deal creation flows before any database write (Requirements
 * 12.4–12.6, 20.4). The geometric/analytics math itself
 * lives in the pure helpers in `lib/geo.ts`.
 */

/** A latitude in the valid WGS-84 range. */
const latitude = z
    .number({ message: 'Latitude must be a number' })
    .finite('Latitude must be a finite number')
    .min(-90, 'Latitude must be ≥ -90')
    .max(90, 'Latitude must be ≤ 90')

/** A longitude in the valid WGS-84 range. */
const longitude = z
    .number({ message: 'Longitude must be a number' })
    .finite('Longitude must be a finite number')
    .min(-180, 'Longitude must be ≥ -180')
    .max(180, 'Longitude must be ≤ 180')

/**
 * A buyer phone number. Accepts loose input (the action normalizes it to E.164
 * for matching); only requires enough digits to be plausible.
 */
const phone = z
    .string({ message: 'A phone number is required' })
    .trim()
    .min(8, 'Phone number is too short')
    .max(20, 'Phone number is too long')

export const siteVisitStatusEnum = z.enum(['Scheduled', 'In Progress', 'Completed', 'Cancelled', 'No Show'])

export const createFieldVisitSchema = z.object({
    staffId: idSchema,
    customer: z.string().trim().min(2, 'Buyer name is required').max(200),
    address: z.string().trim().min(3, 'Project address is required').max(500),
    scheduledAt: z.string().datetime({ offset: true, message: 'A valid scheduled date and time is required' }),
    type: z.string().trim().min(2).max(100).default('Property Viewing'),
    notes: z.string().trim().max(2000).optional(),
    buyerPhone: phone,
    projectId: idSchema,
    unitIds: z.array(idSchema).max(20, 'A visit can include at most 20 units').default([]),
})

export type CreateFieldVisitInput = z.infer<typeof createFieldVisitSchema>

export const rescheduleFieldVisitSchema = createFieldVisitSchema.extend({
    visitId: idSchema,
})

export const updateFieldVisitSchema = z.object({
    visitId: idSchema,
    status: siteVisitStatusEnum.optional(),
    staffNotes: z.string().trim().max(4000).optional(),
    measurements: z.record(z.string(), z.unknown()).optional(),
})

export const updateVisitPhotosSchema = z.object({
    visitId: idSchema,
    photoUrls: z.array(z.string().trim().min(1).max(2000)).max(10, 'A visit can contain at most 10 photos'),
})

// ─── Geo check-in (Req 12.4) ─────────────────────────

export const geoCheckinSchema = z.object({
    visitId: idSchema,
    agentLat: latitude,
    agentLng: longitude,
    accuracyM: z.number().finite().nonnegative().max(10_000).optional(),
})

export type GeoCheckinInput = z.infer<typeof geoCheckinSchema>

// ─── Structured feedback + follow-up/deal (Req 12.5) ─

/**
 * The follow-up action selected at the end of a visit. `Deal` creates a deal
 * for the buyer; `FollowUp` schedules a lead follow-up; `None` records the
 * feedback without any downstream record.
 */
export const followUpActionEnum = z.enum(['Deal', 'FollowUp', 'None'])

export type FollowUpAction = z.infer<typeof followUpActionEnum>

export const submitVisitFeedbackSchema = z
    .object({
        visitId: idSchema,
        buyerRating: rating.optional(),
        feedbackLiked: z.string().trim().max(2000).optional(),
        feedbackDisliked: z.string().trim().max(2000).optional(),
        feedbackConcerns: z.string().trim().max(2000).optional(),
        visitDurationMin: z
            .number({ message: 'Duration must be a number' })
            .int('Duration must be whole minutes')
            .min(0, 'Duration cannot be negative')
            .max(24 * 60, 'Duration is unrealistically long')
            .optional(),
        followUpAction: followUpActionEnum.default('None'),

        // ── Deal creation inputs (required when followUpAction === 'Deal') ──
        contactId: idSchema.optional(),
        stageId: idSchema.optional(),
        dealValue: moneyAmount.optional(),
        unitId: idSchema.optional(),
        assignedAgentId: idSchema.optional(),

        // ── Follow-up inputs (required when followUpAction === 'FollowUp') ──
        leadId: idSchema.optional(),
        followUpDate: z.string().datetime({ message: 'Follow-up date must be an ISO datetime' }).optional(),
        followUpMessage: z.string().trim().min(1, 'A follow-up message is required').max(2000).optional(),
        followUpDay: z.number().int().min(0).max(365).optional(),
    })
    .superRefine((data, ctx) => {
        if (data.followUpAction === 'Deal') {
            if (data.contactId === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactId'], message: 'A contact is required to create a deal' })
            }
            if (data.stageId === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stageId'], message: 'A pipeline stage is required to create a deal' })
            }
            if (data.dealValue === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dealValue'], message: 'A deal value is required to create a deal' })
            }
        }
        if (data.followUpAction === 'FollowUp') {
            if (data.leadId === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leadId'], message: 'A lead is required to schedule a follow-up' })
            }
            if (data.followUpMessage === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['followUpMessage'], message: 'A follow-up message is required' })
            }
        }
    })

export type SubmitVisitFeedbackInput = z.infer<typeof submitVisitFeedbackSchema>

// ─── Visit analytics query (Req 12.6) ────────────────

export const visitAnalyticsSchema = z.object({
    staffId: idSchema.optional(),
    projectId: idSchema.optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
})

export type VisitAnalyticsInput = z.infer<typeof visitAnalyticsSchema>
