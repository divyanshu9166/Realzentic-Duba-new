import { z } from 'zod'
import {
    idSchema,
    moneyAmount,
    projectStatusEnum,
    projectTypeEnum,
    unitFacingEnum,
    unitStatusEnum,
    unitTypeEnum,
} from '@/lib/validations/common'

/**
 * Inventory validation schemas for the Real Estate CRM (Module 1).
 *
 * These Zod schemas enforce required-field, enum, and range checks for
 * `Project`, `Tower`, `Floor`, and `Unit` writes so the Inventory_Service
 * rejects any persist request that omits a required field, supplies an
 * out-of-range value, or uses an invalid enum value, returning an error
 * that identifies the offending field (Requirements 1.1–1.4, 1.10, 20.4).
 *
 * Field names mirror the Prisma models in `prisma/schema.prisma` exactly so
 * a validated payload can be handed straight to Prisma. Reusable primitives
 * and enums are composed from `lib/validations/common.ts`.
 */

// ─── Shared field primitives ─────────────────────────

/** A required, non-empty, trimmed string. */
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

/** A floor-area measurement in square feet: a finite, positive number. */
const areaSqft = (field: string) =>
    z
        .number({ message: `${field} must be a number` })
        .finite(`${field} must be a finite number`)
        .positive(`${field} must be greater than 0`)

/** A non-negative integer count. */
const nonNegativeInt = (field: string) =>
    z
        .number({ message: `${field} must be a number` })
        .int(`${field} must be a whole number`)
        .min(0, `${field} must not be negative`)

/** Latitude in the inclusive range -90 … 90. */
const latitude = z
    .number({ message: 'Latitude must be a number' })
    .min(-90, 'Latitude must be at least -90')
    .max(90, 'Latitude must not exceed 90')

/** Longitude in the inclusive range -180 … 180. */
const longitude = z
    .number({ message: 'Longitude must be a number' })
    .min(-180, 'Longitude must be at least -180')
    .max(180, 'Longitude must not exceed 180')

// ─── Project (Requirements 1.1, 1.10) ────────────────

export const createProjectSchema = z.object({
    name: requiredString('Project name'),
    location: requiredString('Location'),
    city: requiredString('City'),
    emirate: requiredString('Emirate'),
    dldProjectRegNo: optionalString,
    dldProjectRegExpiry: z.coerce.date().optional(),
    escrowAccountNo: optionalString,
    trakheesiPermitNo: optionalString,
    saleType: z.enum(['Off-Plan (Primary)', 'Secondary / Resale', 'Rental']).optional(),
    isFreeholdZone: z.boolean().optional(),
    reraExpiry: z.coerce.date().optional(),
    type: projectTypeEnum,
    status: projectStatusEnum,
    builderName: optionalString,
    totalUnits: nonNegativeInt('Total units').default(0),
    description: optionalString,
    amenities: z.array(z.string().trim().min(1, 'Amenity must not be empty')).default([]),
    brochureUrl: optionalUrl,
    photoUrls: z.array(z.string().trim().url('Each photo URL must be valid')).default([]),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    possessionDate: z.coerce.date().optional(),
})

export const updateProjectSchema = createProjectSchema.partial()

// ─── Tower (Requirement 1.2) ─────────────────────────

export const createTowerSchema = z.object({
    projectId: idSchema,
    name: requiredString('Tower name'),
    totalFloors: z
        .number({ message: 'Total floors must be a number' })
        .int('Total floors must be a whole number')
        .min(1, 'Total floors must be at least 1'),
    status: requiredString('Status').default('Active'),
})

export const updateTowerSchema = createTowerSchema.partial()

// ─── Floor (Requirement 1.3) ─────────────────────────

export const createFloorSchema = z.object({
    towerId: idSchema,
    floorNumber: z
        .number({ message: 'Floor number must be a number' })
        .int('Floor number must be a whole number'),
    floorPlanUrl: optionalUrl,
})

export const updateFloorSchema = createFloorSchema.partial()

// ─── Unit (Requirements 1.4, 1.10) ───────────────────

export const createUnitSchema = z.object({
    towerId: idSchema,
    floorNumber: z
        .number({ message: 'Floor number must be a number' })
        .int('Floor number must be a whole number'),
    unitNumber: requiredString('Unit number'),
    type: unitTypeEnum,
    carpetArea: areaSqft('Carpet area'),
    superBuiltUpArea: areaSqft('Super-built-up area'),
    facing: unitFacingEnum,
    status: unitStatusEnum.default('Available'),
    basePricePerSqft: moneyAmount,
    floorRisePremium: moneyAmount.default(0),
    viewPremium: moneyAmount.default(0),
    // totalPrice is derived by the Inventory_Service (Req 1.5); accepted as an
    // optional override but normally computed server-side.
    totalPrice: moneyAmount.optional(),
    parkingType: optionalString,
    parkingCount: nonNegativeInt('Parking count').default(0),
    bookingId: idSchema.optional(),
})

export const updateUnitSchema = createUnitSchema.partial()

// ─── Inferred types ──────────────────────────────────

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type CreateTowerInput = z.infer<typeof createTowerSchema>
export type UpdateTowerInput = z.infer<typeof updateTowerSchema>
export type CreateFloorInput = z.infer<typeof createFloorSchema>
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>
export type CreateUnitInput = z.infer<typeof createUnitSchema>
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>
