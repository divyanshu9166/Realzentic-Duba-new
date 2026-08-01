import { z } from 'zod'
import {
    commissionTypeEnum,
    idSchema,
    moneyAmount,
    partnerStatusEnum,
    partnerTypeEnum,
} from '@/lib/validations/common'

/**
 * Channel-partner validation schemas for the Real Estate CRM (Module 4).
 *
 * These Zod schemas enforce required-field, enum, and range checks for the
 * Channel_Partner_Service writes so it rejects any persist request that omits
 * a required field, supplies an out-of-range value, or uses an invalid enum
 * value, returning an error that identifies the offending field
 * (Requirements 6.1, 6.2, 6.3, 6.9, 20.4).
 *
 * Field names mirror the Prisma models in `prisma/schema.prisma` exactly so a
 * validated payload can be handed straight to Prisma. Reusable primitives and
 * enums are composed from `lib/validations/common.ts`.
 */

// ─── Shared field primitives ─────────────────────────

/** A required, non-empty, trimmed string carrying a field-specific message. */
const requiredString = (field: string) =>
    z
        .string({ message: `${field} is required` })
        .trim()
        .min(1, `${field} is required`)

/** An optional string that treats an empty string as "not provided". */
const optionalString = z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v))

/** An optional URL string (empty string treated as omitted). */
const optionalUrl = z
    .string()
    .trim()
    .url('Must be a valid URL')
    .optional()
    .or(z.literal('').transform(() => undefined))

/** A single commission slab: `{ minValue, maxValue, rate }` (Req 6.5). */
const commissionSlab = z
    .object({
        minValue: moneyAmount,
        maxValue: moneyAmount,
        rate: z
            .number({ message: 'Slab rate must be a number' })
            .finite('Slab rate must be a finite number')
            .min(0, 'Slab rate must not be negative'),
    })
    .refine((s) => s.maxValue >= s.minValue, {
        message: 'Slab maxValue must be greater than or equal to minValue',
        path: ['maxValue'],
    })

// ─── Onboard partner (Requirements 6.1, 6.9) ─────────

export const onboardPartnerSchema = z
    .object({
        name: requiredString('Partner name'),
        company: optionalString,
        // Dubai broker registration number (BRN) is required. Uniqueness is
        // enforced in the service against the database before any write.
        brnNumber: requiredString('BRN number'),
        ornNumber: optionalString,
        phone: requiredString('Phone'),
        email: z
            .string({ message: 'Email is required' })
            .trim()
            .min(1, 'Email is required')
            .email('Email must be a valid email address'),
        type: partnerTypeEnum,
        status: partnerStatusEnum.default('Active'),
        commissionType: commissionTypeEnum.default('Percentage'),
        // For Percentage partners this must be 0–100; otherwise it is unused
        // and defaults to 0. The cross-field rule is enforced below.
        commissionRate: z
            .number({ message: 'Commission rate must be a number' })
            .finite('Commission rate must be a finite number')
            .min(0, 'Commission rate must not be negative')
            .default(0),
        fixedCommission: moneyAmount.default(0),
        commissionSlabs: z.array(commissionSlab).optional(),
        agreementDocUrl: optionalUrl,
        tradeLicenseNo: optionalString,
        bankDetails: z.record(z.string(), z.unknown()).optional(),
    })
    .superRefine((data, ctx) => {
        // Req 6.1: commission rate is 0–100 when commission type is Percentage.
        if (data.commissionType === 'Percentage' && data.commissionRate > 100) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Commission rate must be between 0 and 100 for a Percentage partner',
                path: ['commissionRate'],
            })
        }
        // Req 6.5: a Slab partner needs at least one slab to be resolvable.
        if (data.commissionType === 'Slab' && (!data.commissionSlabs || data.commissionSlabs.length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A Slab partner requires at least one commission slab',
                path: ['commissionSlabs'],
            })
        }
    })

// ─── CP lead (Requirement 6.2) ───────────────────────

export const createCpLeadSchema = z.object({
    partnerId: idSchema,
    leadId: idSchema.optional(),
    status: requiredString('Status').default('Submitted'),
    commissionEligible: z.boolean().default(false),
    attributionVerified: z.boolean().default(false),
})

// ─── Commission (Requirement 6.3) ────────────────────

export const createCommissionSchema = z
    .object({
        partnerId: idSchema,
        dealId: idSchema.optional(),
        bookingId: idSchema.optional(),
    })
    .refine((d) => d.dealId !== undefined || d.bookingId !== undefined, {
        message: 'A commission must reference a deal or a booking',
        path: ['bookingId'],
    })

export const approveCommissionSchema = z.object({
    commissionId: idSchema,
})

// ─── Payout batch (Requirement 6.6) ──────────────────

export const createPayoutBatchSchema = z.object({
    batchName: requiredString('Batch name'),
    commissionIds: z
        .array(idSchema)
        .min(1, 'A payout batch must include at least one commission'),
})

export const completePayoutBatchSchema = z.object({
    batchId: idSchema,
    utr: optionalString,
})

// ─── Inferred types ──────────────────────────────────

export type OnboardPartnerInput = z.infer<typeof onboardPartnerSchema>
export type CreateCpLeadInput = z.infer<typeof createCpLeadSchema>
export type CreateCommissionInput = z.infer<typeof createCommissionSchema>
export type ApproveCommissionInput = z.infer<typeof approveCommissionSchema>
export type CreatePayoutBatchInput = z.infer<typeof createPayoutBatchSchema>
export type CompletePayoutBatchInput = z.infer<typeof completePayoutBatchSchema>
