import { z } from 'zod'
import { idSchema, moneyAmount, unitFacingEnum, unitTypeEnum } from '@/lib/validations/common'

/**
 * Buyer-preference validation for the AI_Matching_Service (Module 13 /
 * Requirement 16).
 *
 * The shape mirrors the `BuyerPreferences` interface in `lib/matching.ts`:
 * every dimension is OPTIONAL and only the dimensions a buyer actually supplies
 * constrain the match score (Req 16.1). Enum dimensions (`type`, `facing`)
 * accept either a single value or a list of accepted values. Range bounds are
 * validated individually here; the pure scorer treats them as inclusive bounds.
 *
 * Reusable primitives and enums are composed from `lib/validations/common.ts`.
 */

/** Accept a single enum value or a non-empty list of values. */
const oneOrMany = <T extends z.ZodTypeAny>(schema: T) =>
    z.union([schema, z.array(schema).nonempty('Provide at least one value')])

/** An integer floor number (may be negative for basement levels). */
const floorNumber = (field: string) =>
    z
        .number({ message: `${field} must be a number` })
        .int(`${field} must be a whole number`)

/** A carpet-area measurement in square feet: a finite, non-negative number. */
const netArea = (field: string) =>
    z
        .number({ message: `${field} must be a number` })
        .finite(`${field} must be a finite number`)
        .min(0, `${field} must not be negative`)

export const buyerPreferencesSchema = z
    .object({
        minBudget: moneyAmount.optional(),
        maxBudget: moneyAmount.optional(),
        projectId: idSchema.optional(),
        location: z.string().trim().min(1, 'Location must not be empty').optional(),
        type: oneOrMany(unitTypeEnum).optional(),
        facing: oneOrMany(unitFacingEnum).optional(),
        minFloor: floorNumber('Minimum floor').optional(),
        maxFloor: floorNumber('Maximum floor').optional(),
        minNetArea: netArea('Minimum net area').optional(),
        maxNetArea: netArea('Maximum net area').optional(),
        amenities: z.array(z.string().trim().min(1, 'Amenity must not be empty')).optional(),
    })
    .refine(
        (p) => p.minBudget === undefined || p.maxBudget === undefined || p.minBudget <= p.maxBudget,
        { message: 'minBudget must not exceed maxBudget', path: ['minBudget'] }
    )
    .refine(
        (p) => p.minFloor === undefined || p.maxFloor === undefined || p.minFloor <= p.maxFloor,
        { message: 'minFloor must not exceed maxFloor', path: ['minFloor'] }
    )
    .refine(
        (p) =>
            p.minNetArea === undefined ||
            p.maxNetArea === undefined ||
            p.minNetArea <= p.maxNetArea,
        { message: 'minNetArea must not exceed maxNetArea', path: ['minNetArea'] }
    )

export type BuyerPreferencesInput = z.infer<typeof buyerPreferencesSchema>
