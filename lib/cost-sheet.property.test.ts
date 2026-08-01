/**
 * Property-based tests for the Cost Sheet pure helpers (`lib/cost-sheet.ts`).
 *
 * Implements design correctness properties 12–16 (Cost Sheet & Payment Plans)
 * using `fast-check` on the Vitest runner. Each property runs the project
 * default of 100 iterations via {@link fcAssert} and carries the required
 * property-tag comment:
 *
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11, 5.5, 10.3
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
    computeNetPayable,
    validateDiscount,
    computeDldFee,
    vatRateForProperty,
    splitMilestones,
    DLD_TRANSFER_FEE_RATE,
    DLD_ADMIN_FEE_COMPANY,
    DLD_ADMIN_FEE_INDIVIDUAL,
    VAT_RATE_RESIDENTIAL,
    VAT_RATE_STANDARD,
    type PaymentPlanInput,
} from '@/lib/cost-sheet'
import { roundMoney, MONEY_MAX } from '@/lib/money'
import { fcAssert, moneyArb } from '@/test/generators'

// ---------------------------------------------------------------------------
// Local arbitraries
// ---------------------------------------------------------------------------

/**
 * A `total` constrained to a quarter of the money range so that, combined with
 * the constrained add-ons below, the gross amount (`total + Σ(add-ons)`) stays
 * comfortably within the inclusive money range and never overflows.
 */
const totalArb: fc.Arbitrary<number> = fc
    .double({ min: 0, max: MONEY_MAX / 4, noNaN: true, noDefaultInfinity: true })
    .map((n) => roundMoney(n))

/**
 * A list of add-on charges whose summed magnitude is bounded so that
 * `total + Σ(add-ons) <= MONEY_MAX`. Up to 8 add-ons, each up to MONEY_MAX/32,
 * yields a maximum add-on sum of MONEY_MAX/4.
 */
const addonsArb: fc.Arbitrary<number[]> = fc.array(
    fc
        .double({ min: 0, max: MONEY_MAX / 32, noNaN: true, noDefaultInfinity: true })
        .map((n) => roundMoney(n)),
    { maxLength: 8 }
)

/** A fraction in `[0, 1]`, used to derive a discount that cannot exceed gross. */
const fractionArb: fc.Arbitrary<number> = fc.double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
})

/** The sum of a list of add-ons, rounded to money precision (mirrors the impl). */
function sumAddons(addons: number[]): number {
    return roundMoney(addons.reduce((acc, a) => acc + a, 0))
}

// ---------------------------------------------------------------------------
// Property 12: Net payable composition (Req 3.3)
// ---------------------------------------------------------------------------

describe('Property 12: Net payable composition', () => {
    // Feature: real-estate-crm, Property 12: For any total, set of add-on charges, and discount within the valid money range, net payable equals `total + Σ(add-ons) − discount`.
    it('net payable equals total + Σ(add-ons) − discount', () => {
        fcAssert(
            fc.property(totalArb, addonsArb, fractionArb, (total, addons, fraction) => {
                const gross = roundMoney(total + sumAddons(addons))
                // A discount derived from a [0,1] fraction can never exceed gross.
                const discount = roundMoney(gross * fraction)
                const expected = roundMoney(gross - discount)

                expect(computeNetPayable(total, addons, discount)).toBe(expected)
            })
        )
    })
})

// ---------------------------------------------------------------------------
// Property 13: Discount never makes net payable negative (Req 3.4)
// ---------------------------------------------------------------------------

describe('Property 13: Discount never makes net payable negative', () => {
    // Feature: real-estate-crm, Property 13: For any gross amount (total plus add-ons) and discount, if discount exceeds gross the cost sheet is rejected; otherwise the resulting net payable is greater than or equal to 0.
    it('rejects discounts exceeding gross, otherwise net payable >= 0', () => {
        fcAssert(
            fc.property(totalArb, addonsArb, moneyArb, (total, addons, discount) => {
                const gross = roundMoney(total + sumAddons(addons))

                if (!validateDiscount(gross, discount)) {
                    // Discount exceeds gross (or is otherwise invalid): rejected.
                    expect(() => computeNetPayable(total, addons, discount)).toThrow()
                } else {
                    const net = computeNetPayable(total, addons, discount)
                    expect(net).toBeGreaterThanOrEqual(0)
                }
            })
        )
    })
})

// ---------------------------------------------------------------------------
// Property 14: DLD transfer fee is a flat Dubai fee (Req 3.5, 10.3)
// ---------------------------------------------------------------------------

describe('Property 14: DLD transfer fee is flat', () => {
    // Feature: real-estate-crm, Property 14: For any property value, DLD transfer fee is 4% plus the buyer-type admin fee.
    it('uses a 4% transfer fee and the correct buyer-type admin fee', () => {
        fcAssert(
            fc.property(moneyArb, fc.constantFrom<'Individual' | 'Company'>('Individual', 'Company'), (value, buyerType) => {
                const fee = computeDldFee(value, buyerType)
                const expectedAdmin = buyerType === 'Company' ? DLD_ADMIN_FEE_COMPANY : DLD_ADMIN_FEE_INDIVIDUAL
                expect(fee.transferFee).toBe(roundMoney(value * DLD_TRANSFER_FEE_RATE))
                expect(fee.adminFee).toBe(expectedAdmin)
                expect(fee.total).toBe(roundMoney(fee.transferFee + expectedAdmin))
            })
        )
    })
})

// ---------------------------------------------------------------------------
// Property 15: VAT rate is determined by property use
// ---------------------------------------------------------------------------

const propertyUseArb: fc.Arbitrary<string> = fc.oneof(
    fc.constantFrom('Residential', 'Commercial', 'Mixed'),
    fc.string()
)

describe('Property 15: VAT rate is determined by property use', () => {
    // Feature: real-estate-crm, Property 15: Commercial property is standard-rated and other property uses are modeled as residential 0%.
    it('returns 5% for commercial and 0% for residential/other uses', () => {
        fcAssert(
            fc.property(propertyUseArb, (propertyUse) => {
                const rate = vatRateForProperty(propertyUse)

                // Total function: always returns a finite, determinate number.
                expect(typeof rate).toBe('number')
                expect(Number.isFinite(rate)).toBe(true)

                if (propertyUse === 'Commercial') {
                    expect(rate).toBe(VAT_RATE_STANDARD)
                } else {
                    expect(rate).toBe(VAT_RATE_RESIDENTIAL)
                }
            })
        )
    })
})

// ---------------------------------------------------------------------------
// Property 16: Milestone amounts sum to the basis amount (Req 3.11, 5.5)
// ---------------------------------------------------------------------------

const milestoneArb = fc.record({
    name: fc.string(),
    dueOffsetDays: fc.nat({ max: 3650 }),
    percentage: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
})

const planArb: fc.Arbitrary<PaymentPlanInput> = fc.record({
    name: fc.string(),
    milestones: fc.array(milestoneArb, { minLength: 1, maxLength: 12 }),
})

describe('Property 16: Milestone amounts sum to the basis amount', () => {
    // Feature: real-estate-crm, Property 16: For any payment plan and basis amount, the sum of generated milestone amounts equals the basis amount exactly.
    it('sum of milestone amounts equals the basis amount exactly', () => {
        fcAssert(
            fc.property(planArb, moneyArb, (plan, basis) => {
                const milestones = splitMilestones(plan, basis)

                // One amount is produced per plan milestone.
                expect(milestones).toHaveLength(plan.milestones.length)

                const total = roundMoney(milestones.reduce((acc, m) => acc + m.amount, 0))
                expect(total).toBe(roundMoney(basis))
            })
        )
    })
})
