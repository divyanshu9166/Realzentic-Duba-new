import { z } from 'zod'
import { MONEY_MAX, MONEY_MIN } from '@/lib/money'

/**
 * Shared Zod primitives for the Real Estate CRM validation layer.
 *
 * These reusable schemas centralize the cross-cutting validation rules
 * (money range, percentage, rating, and the Prisma enums) so every
 * module-specific schema in `lib/validations/*` composes the same checks
 * and rejects invalid input with descriptive errors before any database
 * write (Requirement 20.4).
 */

// ─── Numeric primitives ──────────────────────────────

/**
 * A monetary amount in the inclusive range `0.00 … 999,999,999.99`.
 * Mirrors the `lib/money.ts` range constants and the `Decimal(12,2)`
 * columns in the schema.
 */
export const moneyAmount = z
    .number({ message: 'Amount must be a number' })
    .finite('Amount must be a finite number')
    .min(MONEY_MIN, `Amount must be at least ${MONEY_MIN.toFixed(2)}`)
    .max(MONEY_MAX, `Amount must not exceed ${MONEY_MAX.toFixed(2)}`)

/**
 * A percentage in the inclusive range `0 … 100`. Used for commission rates,
 * VAT rates, discounts expressed as a percentage, etc.
 */
export const percentage = z
    .number({ message: 'Percentage must be a number' })
    .min(0, 'Percentage must be at least 0')
    .max(100, 'Percentage must not exceed 100')

/**
 * An integer rating in the inclusive range `1 … 5`.
 */
export const rating = z
    .number({ message: 'Rating must be a number' })
    .int('Rating must be a whole number')
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must not exceed 5')

/** A positive integer identifier (e.g. a Prisma autoincrement primary key). */
export const idSchema = z
    .number({ message: 'ID must be a number' })
    .int('ID must be a whole number')
    .positive('ID must be a positive integer')

// ─── Enum primitives (mirror prisma/schema.prisma) ───

export const projectTypeEnum = z.enum(['Residential', 'Commercial', 'Mixed'])

export const projectStatusEnum = z.enum(['Upcoming', 'UnderConstruction', 'ReadyToMove'])

export const unitTypeEnum = z.enum(['Studio', 'Apartment1', 'Apartment2', 'Apartment3', 'Apartment4Plus', 'Penthouse', 'Villa', 'Townhouse', 'Duplex', 'Retail', 'Office', 'Warehouse', 'LandPlot', 'BHK1', 'BHK2', 'BHK3', 'BHK4', 'Shop', 'Plot'])

export const unitFacingEnum = z.enum(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

export const unitStatusEnum = z.enum(['Available', 'Blocked', 'Booked', 'Sold', 'Mortgaged'])

export const commissionTypeEnum = z.enum(['Percentage', 'Fixed', 'Slab'])

export const partnerTypeEnum = z.enum(['Individual', 'Firm', 'Company'])

export const partnerStatusEnum = z.enum(['Active', 'Inactive', 'Suspended'])

export const commissionStatusEnum = z.enum(['Pending', 'Approved', 'Paid', 'Disputed'])

export const payoutBatchStatusEnum = z.enum(['Draft', 'Processing', 'Completed'])

export const milestoneStatusEnum = z.enum([
    'Upcoming',
    'Due',
    'Overdue',
    'Paid',
    'Partially_Paid',
])

export const bookingStatusEnum = z.enum(['Active', 'Cancelled', 'Completed'])

export const documentStatusEnum = z.enum(['Pending', 'Verified', 'Rejected', 'Expired'])

export const supportTicketStatusEnum = z.enum(['Open', 'InProgress', 'Resolved', 'Closed'])

// ─── Inferred types ──────────────────────────────────

export type ProjectType = z.infer<typeof projectTypeEnum>
export type ProjectStatus = z.infer<typeof projectStatusEnum>
export type UnitType = z.infer<typeof unitTypeEnum>
export type UnitFacing = z.infer<typeof unitFacingEnum>
export type UnitStatus = z.infer<typeof unitStatusEnum>
export type CommissionType = z.infer<typeof commissionTypeEnum>
export type PartnerType = z.infer<typeof partnerTypeEnum>
export type PartnerStatus = z.infer<typeof partnerStatusEnum>
export type CommissionStatus = z.infer<typeof commissionStatusEnum>
export type PayoutBatchStatus = z.infer<typeof payoutBatchStatusEnum>
export type MilestoneStatus = z.infer<typeof milestoneStatusEnum>
export type BookingStatus = z.infer<typeof bookingStatusEnum>
export type DocumentStatus = z.infer<typeof documentStatusEnum>
export type SupportTicketStatus = z.infer<typeof supportTicketStatusEnum>
