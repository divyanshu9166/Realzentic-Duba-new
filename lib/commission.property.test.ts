/**
 * Property-based tests for the channel-partner commission pure helper
 * ({@link computeCommission} in `lib/commission.ts`).
 *
 * Implements design Correctness Properties 25–27:
 *   - Property 25: Percentage commission computation (Req 6.4)
 *   - Property 26: Slab commission selects the matching slab (Req 6.5)
 *   - Property 27: Fixed commission is value-independent (Req 6.8)
 *
 * Tag convention (design.md → Testing Strategy → PBT):
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * Runs at the project default of 100 iterations via `fcAssert`.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { computeCommission, type CommissionSlab } from '@/lib/commission'
import { roundMoney } from '@/lib/money'
import { fcAssert, moneyArb } from '@/test/generators'

/**
 * A percentage rate in the inclusive range `[0, 100]`, rounded to two decimal
 * places (e.g. `2.5` for 2.5%). Boundary rates 0 and 100 are biased in.
 */
const rateArb: fc.Arbitrary<number> = fc
    .double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true })
    .map((n) => Math.round(n * 100) / 100)

/**
 * A single slab whose `rate` is a percentage. The range is normalized
 * so `minValue <= maxValue`.
 */
const slabArb: fc.Arbitrary<CommissionSlab> = fc
    .record({
        a: moneyArb,
        b: moneyArb,
        rate: fc
            .double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
            .map((r) => Math.round(r * 10_000) / 10_000),
    })
    .map(({ a, b, rate }) => ({
        minValue: Math.min(a, b),
        maxValue: Math.max(a, b),
        rate,
    }))

/** One or more slabs (may overlap or leave gaps). */
const slabsArb: fc.Arbitrary<CommissionSlab[]> = fc.array(slabArb, {
    minLength: 1,
    maxLength: 6,
})

/**
 * A slab configuration paired with an agreement value. The value is drawn
 * either freely (often falling outside every slab → no match) or from within
 * one of the configured slabs (guaranteeing a match), so both the matching
 * and the no-match branches are exercised.
 */
const slabsAndValueArb: fc.Arbitrary<{ slabs: CommissionSlab[]; value: number }> =
    slabsArb.chain((slabs) =>
        fc
            .oneof(
                moneyArb,
                fc.constantFrom(...slabs).chain((s) =>
                    fc
                        .double({
                            min: s.minValue,
                            max: s.maxValue,
                            noNaN: true,
                            noDefaultInfinity: true,
                        })
                        .map((n) => Math.round(n * 100) / 100),
                ),
            )
            .map((value) => ({ slabs, value })),
    )

describe('computeCommission (pure helper)', () => {
    // Feature: real-estate-crm, Property 25: Percentage commission computation
    // For any Percentage partner with commission rate in [0, 100] and any
    // booking agreement value, the commission equals round(rate / 100 ×
    // agreementValue, 2).
    // Validates: Requirements 6.4
    it('Property 25: percentage commission equals round(rate / 100 × agreementValue, 2)', () => {
        fcAssert(
            fc.property(rateArb, moneyArb, (rate, agreementValue) => {
                const expected = roundMoney((rate / 100) * agreementValue)
                expect(
                    computeCommission('Percentage', rate, 0, null, agreementValue),
                ).toBe(expected)
            }),
        )
    })

    // Feature: real-estate-crm, Property 26: Slab commission selects the matching slab
    // For any slab configuration and agreement value, the commission equals
    // round(matchingSlabRate / 100 × agreementValue, 2), where the matching slab is
    // the one whose value range contains the agreement value (0 if none match).
    // Validates: Requirements 6.5
    it('Property 26: slab commission applies the matching slab rate', () => {
        fcAssert(
            fc.property(slabsAndValueArb, ({ slabs, value }) => {
                const matching = slabs.find(
                    (s) => value >= s.minValue && value <= s.maxValue,
                )
                const expected = matching ? roundMoney((matching.rate / 100) * value) : 0
                expect(computeCommission('Slab', 0, 0, slabs, value)).toBe(expected)
            }),
        )
    })

    // Feature: real-estate-crm, Property 27: Fixed commission is value-independent
    // For any Fixed partner and any two distinct agreement values, the computed
    // commission is identical and equal to the partner's configured fixed amount.
    // Validates: Requirements 6.8
    it('Property 27: fixed commission is identical across distinct agreement values', () => {
        const distinctValuesArb = fc
            .tuple(moneyArb, moneyArb)
            .filter(([a, b]) => a !== b)

        fcAssert(
            fc.property(moneyArb, distinctValuesArb, (fixedAmount, [v1, v2]) => {
                const c1 = computeCommission('Fixed', 0, fixedAmount, null, v1)
                const c2 = computeCommission('Fixed', 0, fixedAmount, null, v2)
                // Value-independent and equal to the configured fixed amount.
                expect(c1).toBe(c2)
                expect(c1).toBe(roundMoney(fixedAmount))
            }),
        )
    })
})
