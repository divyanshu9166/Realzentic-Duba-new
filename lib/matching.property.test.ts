/**
 * Property-based tests for the pure AI property-matching helpers in
 * `lib/matching.ts` (Module 13 — AI Property Matching).
 *
 * Implements design correctness Properties 55 and 56. Each property carries the
 * project tag convention:
 *
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * and runs with the project default of 100 iterations via `fcAssert`
 * (see `test/generators.ts`).
 *
 * Validates: Requirements 16.1, 16.2
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { fcAssert } from '../test/generators'
import {
    matchUnits,
    scoreMatch,
    type BuyerPreferences,
    type MatchableUnit,
} from './matching'
import type { UnitFacing, UnitStatus, UnitType } from './inventory'

// ---------------------------------------------------------------------------
// Shared domain arbitraries
// ---------------------------------------------------------------------------

const UNIT_STATUSES: readonly UnitStatus[] = [
    'Available',
    'Blocked',
    'Booked',
    'Sold',
    'Mortgaged',
]
const UNIT_TYPES: readonly UnitType[] = ['BHK1', 'BHK2', 'BHK3', 'BHK4', 'Shop', 'Office', 'Plot']
const UNIT_FACINGS: readonly UnitFacing[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']

const statusArb = fc.constantFrom(...UNIT_STATUSES)
const typeArb = fc.constantFrom(...UNIT_TYPES)
const facingArb = fc.constantFrom(...UNIT_FACINGS)

const priceArb = fc
    .double({ min: 0, max: 999_999_999, noNaN: true, noDefaultInfinity: true })
    .map((n) => Math.round(n * 100) / 100)
const areaArb = fc
    .double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true })
    .map((n) => Math.round(n * 100) / 100)

const AMENITY_POOL = ['pool', 'gym', 'park', 'lift', 'parking', 'clubhouse', 'security']

const matchableUnitArb: fc.Arbitrary<MatchableUnit> = fc.record({
    status: statusArb,
    type: typeArb,
    facing: facingArb,
    floorNumber: fc.integer({ min: 0, max: 50 }),
    netArea: areaArb,
    totalPrice: priceArb,
    projectId: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
    location: fc.option(fc.constantFrom('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'), {
        nil: undefined,
    }),
    amenities: fc.option(fc.subarray(AMENITY_POOL), { nil: undefined }),
})

/** Optionally produce a scalar-or-list filter from a value arbitrary. */
function optionalScalarFilter<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | T[] | undefined> {
    return fc.oneof(
        fc.constant<undefined>(undefined),
        arb,
        fc.array(arb, { minLength: 1, maxLength: 3 }),
    )
}

const preferencesArb: fc.Arbitrary<BuyerPreferences> = fc.record({
    minBudget: fc.option(priceArb, { nil: undefined }),
    maxBudget: fc.option(priceArb, { nil: undefined }),
    projectId: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
    location: fc.option(fc.constantFrom('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'), {
        nil: undefined,
    }),
    type: optionalScalarFilter(typeArb),
    facing: optionalScalarFilter(facingArb),
    minFloor: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
    maxFloor: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
    minNetArea: fc.option(areaArb, { nil: undefined }),
    maxNetArea: fc.option(areaArb, { nil: undefined }),
    amenities: fc.option(fc.subarray(AMENITY_POOL), { nil: undefined }),
})

// ---------------------------------------------------------------------------
// Property 55 — Match scoring is bounded and ranked (Req 16.1)
// ---------------------------------------------------------------------------

describe('Property 55: Match scoring is bounded and ranked', () => {
    // Feature: real-estate-crm, Property 55: Match scoring is bounded and ranked
    it('scoreMatch returns an integer in [0, 100] for any preferences and unit', () => {
        fcAssert(
            fc.property(preferencesArb, matchableUnitArb, (preferences, unit) => {
                const score = scoreMatch(preferences, unit)
                expect(Number.isInteger(score)).toBe(true)
                expect(score).toBeGreaterThanOrEqual(0)
                expect(score).toBeLessThanOrEqual(100)
            }),
        )
    })

    // Feature: real-estate-crm, Property 55: Match scoring is bounded and ranked
    it('matchUnits produces percentages in [0, 100] ordered non-increasingly', () => {
        fcAssert(
            fc.property(
                preferencesArb,
                fc.array(matchableUnitArb, { maxLength: 30 }),
                (preferences, units) => {
                    const results = matchUnits(preferences, units)

                    // Every produced percentage is a bounded integer.
                    for (const { matchPercentage } of results) {
                        expect(Number.isInteger(matchPercentage)).toBe(true)
                        expect(matchPercentage).toBeGreaterThanOrEqual(0)
                        expect(matchPercentage).toBeLessThanOrEqual(100)
                    }

                    // The list is ordered in non-increasing order of match percentage.
                    for (let i = 1; i < results.length; i += 1) {
                        expect(results[i - 1].matchPercentage).toBeGreaterThanOrEqual(
                            results[i].matchPercentage,
                        )
                    }
                },
            ),
        )
    })
})

// ---------------------------------------------------------------------------
// Property 56 — Matching considers only Available units (Req 16.2)
// ---------------------------------------------------------------------------

describe('Property 56: Matching considers only Available units', () => {
    // Feature: real-estate-crm, Property 56: Matching considers only Available units
    it('matchUnits result contains only units whose status is Available', () => {
        fcAssert(
            fc.property(
                preferencesArb,
                fc.array(matchableUnitArb, { maxLength: 30 }),
                (preferences, units) => {
                    const results = matchUnits(preferences, units)

                    // Soundness: every returned unit is Available.
                    for (const { unit } of results) {
                        expect(unit.status).toBe('Available')
                    }

                    // Completeness: every Available unit is present in the result.
                    const availableCount = units.filter((u) => u.status === 'Available').length
                    expect(results.length).toBe(availableCount)
                },
            ),
        )
    })
})
