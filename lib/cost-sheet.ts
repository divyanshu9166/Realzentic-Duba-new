/**
 * Cost Sheet pure functions for the Real Estate CRM (Module 2).
 *
 * Every function here is PURE: it performs no database access, no I/O, and no
 * mutation of its inputs. This keeps the financial logic deterministic and
 * directly property-testable. All monetary math reuses the shared helpers in
 * `lib/money.ts` (`roundMoney`, `assertMoneyRange`) so the entire platform
 * shares identical rounding (round-half-up to 2 dp) and range
 * (`0.00 … 999,999,999.99`) semantics.
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11
 * Design properties: 12 (net payable composition), 13 (discount floor),
 * 14 (Dubai Land Department transfer fee), 15 (VAT rate by property use),
 * 16 (milestone split).
 */

import { assertMoneyRange, roundMoney } from './money'

// UAE VAT / Dubai Land Department (DLD) fees. Residential is deliberately
// modeled at 0% here; the accounting workflow must still distinguish a
// zero-rated first supply from an exempt subsequent supply where relevant.
export type PropertyUse = 'Residential' | 'Commercial' | string
export type BuyerType = 'Individual' | 'Company'

export const VAT_RATE_STANDARD = 0.05
export const VAT_RATE_RESIDENTIAL = 0
export const DLD_TRANSFER_FEE_RATE = 0.04
export const DLD_ADMIN_FEE_INDIVIDUAL = 580
export const DLD_ADMIN_FEE_COMPANY = 4200
export const MORTGAGE_REGISTRATION_FEE_RATE = 0.0025
export const MORTGAGE_REGISTRATION_ADMIN_FEE = 290

export function vatRateForProperty(propertyUse: PropertyUse): number {
    return propertyUse === 'Commercial' ? VAT_RATE_STANDARD : VAT_RATE_RESIDENTIAL
}

export function computeDldFee(propertyValue: number, buyerType: BuyerType = 'Individual') {
    assertMoneyRange(propertyValue)
    const transferFee = assertMoneyRange(roundMoney(propertyValue * DLD_TRANSFER_FEE_RATE))
    const adminFee = buyerType === 'Company' ? DLD_ADMIN_FEE_COMPANY : DLD_ADMIN_FEE_INDIVIDUAL
    return {
        transferFee,
        adminFee,
        total: assertMoneyRange(roundMoney(transferFee + adminFee)),
    }
}

// ---------------------------------------------------------------------------
// Net payable & discount (Req 3.3, 3.4 / Properties 12, 13)
// ---------------------------------------------------------------------------

/** Sum a list of add-on charges, validating each is within the money range. */
function sumAddons(addons: number[]): number {
    let sum = 0
    for (const addon of addons) {
        assertMoneyRange(addon)
        sum += addon
    }
    return roundMoney(sum)
}

/**
 * Compute the gross amount of a cost sheet: `total + Σ(add-ons)`.
 * Add-ons are the additional charges (floor rise, view premium, parking,
 * clubhouse, legal, DLD transfer, VAT, registration, ...).
 *
 * @throws if any input or the result is out of the money range.
 */
export function computeGross(total: number, addons: number[] = []): number {
    assertMoneyRange(total)
    const gross = roundMoney(total + sumAddons(addons))
    return assertMoneyRange(gross)
}

/**
 * Validate a discount against the gross amount. Returns `true` when the
 * discount is acceptable (`0 ≤ discount ≤ gross`) and `false` when it exceeds
 * the gross — in which case the cost sheet must be rejected so that net payable
 * can never be negative (Property 13).
 *
 * Requirements: 3.4.
 */
export function validateDiscount(gross: number, discount: number): boolean {
    if (typeof gross !== 'number' || !Number.isFinite(gross)) return false
    if (typeof discount !== 'number' || !Number.isFinite(discount)) return false
    if (discount < 0) return false
    return roundMoney(discount) <= roundMoney(gross)
}

/**
 * Compute net payable: `total + Σ(add-ons) − discount` (Property 12), rounded
 * to 2 dp. Rejects discounts that exceed the gross amount so net payable is
 * never negative (Property 13).
 *
 * Requirements: 3.3, 3.4.
 *
 * @throws if any input is out of the money range or the discount exceeds gross.
 */
export function computeNetPayable(total: number, addons: number[] = [], discount = 0): number {
    const gross = computeGross(total, addons)
    assertMoneyRange(discount)
    if (!validateDiscount(gross, discount)) {
        throw new Error(
            `Discount ${discount} exceeds gross amount ${gross}; net payable cannot be negative`
        )
    }
    return assertMoneyRange(roundMoney(gross - discount))
}

// ---------------------------------------------------------------------------
// Milestone split (Req 3.11, 5.5 / Property 16)
// ---------------------------------------------------------------------------

/** A milestone definition within a payment plan. */
export interface PlanMilestone {
    name: string
    /** Days from the basis date when this milestone is due. */
    dueOffsetDays: number
    /** Percentage (0–100) of the basis amount allocated to this milestone. */
    percentage: number
}

/** A payment plan as stored in `PaymentPlan.milestones` (Json). */
export interface PaymentPlanInput {
    name?: string
    milestones: PlanMilestone[]
}

/** A milestone with a concrete monetary amount allocated to it. */
export interface SplitMilestone {
    name: string
    dueOffsetDays: number
    amount: number
}

/**
 * Split a basis amount (cost-sheet net payable for schedules, or booking
 * agreement value for bookings) across a payment plan's milestones according to
 * each milestone's percentage. Each amount is rounded to 2 dp, and any rounding
 * remainder is absorbed by the final milestone so that the sum of milestone
 * amounts equals the basis amount EXACTLY (Property 16).
 *
 * Requirements: 3.11, 5.5.
 *
 * @throws if `basisAmount` is out of the money range or the plan has no
 *         milestones (an empty plan cannot represent a non-trivial basis).
 */
export function splitMilestones(plan: PaymentPlanInput, basisAmount: number): SplitMilestone[] {
    assertMoneyRange(basisAmount)

    const milestones = plan?.milestones ?? []
    if (milestones.length === 0) {
        throw new Error('splitMilestones requires a payment plan with at least one milestone')
    }

    const basis = roundMoney(basisAmount)
    const result: SplitMilestone[] = []
    let allocated = 0

    for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i]
        const isLast = i === milestones.length - 1

        let amount: number
        if (isLast) {
            // The final milestone absorbs the rounding remainder so the sum is
            // exactly the basis amount, regardless of percentage rounding.
            amount = roundMoney(basis - allocated)
        } else {
            const pct = Number(milestone.percentage)
            const safePct = Number.isFinite(pct) ? pct : 0
            amount = roundMoney((basis * safePct) / 100)
            allocated = roundMoney(allocated + amount)
        }

        result.push({
            name: milestone.name,
            dueOffsetDays: Number(milestone.dueOffsetDays) || 0,
            amount,
        })
    }

    return result
}
