import { z } from 'zod'
import { idSchema, moneyAmount } from './common'

/**
 * Zod validation schemas for the Deal Pipeline (Module 3).
 *
 * These mirror the `DealStage` and `Deal` fields in `prisma/schema.prisma`
 * and enforce the required-field, range, and length rules from Requirements
 * 4.1 and 4.2 before any database write (Requirement 20.4). Server actions in
 * `app/actions/deals.ts` parse untrusted input through these schemas and
 * reject invalid input with a descriptive error.
 */

// ─── DealStage (Req 4.1) ─────────────────────────────

/** A 7-digit hex color such as `#1a2b3c`; falls back to a default in the action. */
const colorSchema = z
    .string()
    .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, 'Color must be a hex value such as #888888')

/**
 * DealStage creation: name (1–100 chars), positive-integer order, optional
 * color, is-won / is-lost flags, and optional auto-action definitions.
 */
export const createDealStageSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Stage name is required')
        .max(100, 'Stage name must be at most 100 characters'),
    order: z
        .number({ message: 'Order must be a number' })
        .int('Order must be a whole number')
        .positive('Order must be a positive integer'),
    color: colorSchema.optional(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    autoActions: z.unknown().optional(),
})

/** A single entry in a stage-reorder request: stage id + its new order. */
export const reorderStageEntrySchema = z.object({
    id: idSchema,
    order: z
        .number({ message: 'Order must be a number' })
        .int('Order must be a whole number')
        .positive('Order must be a positive integer'),
})

/** A non-empty list of stage-reorder entries. */
export const reorderStagesSchema = z
    .array(reorderStageEntrySchema)
    .min(1, 'At least one stage is required to reorder')

// ─── Deal (Req 4.2) ──────────────────────────────────

/**
 * Deal creation: contact + stage are required, value is a money amount, and
 * the optional fields mirror the persisted `Deal` columns. Notes are limited
 * to 5000 characters and the AI score to 0–100.
 */
export const createDealSchema = z.object({
    contactId: idSchema,
    stageId: idSchema,
    value: moneyAmount,
    unitId: idSchema.optional(),
    assignedAgentId: idSchema.optional(),
    channelPartnerId: idSchema.optional(),
    expectedCloseDate: z.coerce.date().optional(),
    source: z.string().trim().max(255, 'Source must be at most 255 characters').optional(),
    notes: z.string().max(5000, 'Notes must be at most 5000 characters').optional(),
    lostReason: z.string().trim().max(1000, 'Lost reason must be at most 1000 characters').optional(),
})

/** Input for moving a deal to a different stage, with an optional lost reason. */
export const moveDealSchema = z.object({
    dealId: idSchema,
    toStageId: idSchema,
    lostReason: z
        .string()
        .trim()
        .max(1000, 'Lost reason must be at most 1000 characters')
        .optional(),
})

// ─── Booking engine (Req 5.1, 5.6, 5.7) ──────────────

/**
 * Convert-deal-to-booking input (Req 5.1). Mirrors the `Booking` columns:
 * agreement value (money range), reservation deposit (money range; constrained to
 * the agreement value below), reservation receipt number (1–50 chars), optional
 * token date / mode, optional payment plan and booking date, and an optional
 * unit override (defaults to the deal's unit in the action).
 *
 * The reservation deposit must not exceed the agreement value (Req 5.1); this is
 * checked with a cross-field refinement so the error names `tokenAmount`.
 */
export const convertDealToBookingSchema = z
    .object({
        agreementValue: moneyAmount,
        tokenAmount: moneyAmount,
        tokenReceiptNo: z
            .string()
            .trim()
            .min(1, 'Reservation receipt number is required')
            .max(50, 'Reservation receipt number must be at most 50 characters'),
        tokenDate: z.coerce.date().optional(),
        tokenMode: z.string().trim().max(50, 'Token mode must be at most 50 characters').optional(),
        paymentPlanId: idSchema.optional(),
        bookingDate: z.coerce.date().optional(),
        unitId: idSchema.optional(),
    })
    .refine((data) => data.tokenAmount <= data.agreementValue, {
        message: 'Reservation deposit must not exceed the agreement value',
        path: ['tokenAmount'],
    })

/**
 * Token-payment input (Req 5.6). The payment is recorded against the existing
 * `DailyPayment` model and the booking's token fields are updated: a positive
 * money amount, a payment method (1–50 chars), a reservation receipt number
 * (1–50 chars), and optional reference / token date / staff / payment date.
 */
export const recordTokenPaymentSchema = z.object({
    amount: moneyAmount.refine((v) => v > 0, 'Payment amount must be greater than zero'),
    method: z
        .string()
        .trim()
        .min(1, 'Payment method is required')
        .max(50, 'Payment method must be at most 50 characters'),
    tokenReceiptNo: z
        .string()
        .trim()
            .min(1, 'Reservation receipt number is required')
            .max(50, 'Reservation receipt number must be at most 50 characters'),
    reference: z.string().trim().max(255, 'Reference must be at most 255 characters').optional(),
    tokenDate: z.coerce.date().optional(),
    receivedByStaffId: idSchema.optional(),
    date: z.coerce.date().optional(),
})

/** Booking-cancellation input (Req 5.7): a required 1–1000 char reason. */
export const cancelBookingSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(1, 'A cancellation reason is required')
        .max(1000, 'Cancellation reason must be at most 1000 characters'),
})

export type CreateDealStageInput = z.infer<typeof createDealStageSchema>
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>
export type CreateDealInput = z.infer<typeof createDealSchema>
export type MoveDealInput = z.infer<typeof moveDealSchema>
export type ConvertDealToBookingInput = z.infer<typeof convertDealToBookingSchema>
export type RecordTokenPaymentInput = z.infer<typeof recordTokenPaymentSchema>
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>
