/**
 * Property-based tests for the pure inventory helpers in `lib/inventory.ts`
 * (Module 1 — Inventory).
 *
 * Implements design correctness Properties 1, 2, 3, 6, and 11. Each property
 * carries the project tag convention:
 *
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * and runs with the project default of 100 iterations via `fcAssert`
 * (see `test/generators.ts`).
 *
 * Validates: Requirements 1.5, 1.6, 1.8, 2.1, 2.2, 2.8
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { MONEY_MAX, roundMoney } from '@/lib/money'
import { fcAssert, moneyArb, moneyUpToArb } from '../test/generators'
import {
    canTransition,
    computeAnalytics,
    computePercentSold,
    computeTotalPrice,
    filterUnits,
    matchesUnitFilters,
    type FilterableUnit,
    type UnitFacing,
    type UnitFilters,
    type UnitStatus,
    type UnitType,
} from './inventory'

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
const UNIT_TYPES: readonly UnitType[] = [
    'BHK1',
    'BHK2',
    'BHK3',
    'BHK4',
    'Shop',
    'Office',
    'Plot',
]
const UNIT_FACINGS: readonly UnitFacing[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']

const statusArb = fc.constantFrom(...UNIT_STATUSES)
const typeArb = fc.constantFrom(...UNIT_TYPES)
const facingArb = fc.constantFrom(...UNIT_FACINGS)

// ---------------------------------------------------------------------------
// Property 1 — Unit total price composition (Req 1.5)
// ---------------------------------------------------------------------------

describe('Property 1: Unit total price composition', () => {
    // Bound the price/area factors so the composed total stays inside the
    // money range (max ~5.2e8 < MONEY_MAX), keeping inputs valid per the
    // property's "within the valid money range" precondition.
    const basePsfArb = fc
        .double({ min: 0, max: 50_000, noNaN: true, noDefaultInfinity: true })
        .map((n) => Math.round(n * 100) / 100)
    const areaArb = fc
        .double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true })
        .map((n) => Math.round(n * 100) / 100)
    const premiumArb = moneyUpToArb(10_000_000)

    // Feature: real-estate-crm, Property 1: Unit total price composition
    it('equals round(basePsf × area, 2) + floorRisePremium + viewPremium', () => {
        fcAssert(
            fc.property(
                basePsfArb,
                areaArb,
                premiumArb,
                premiumArb,
                (basePsf, area, floorRise, view) => {
                    const expected = roundMoney(roundMoney(basePsf * area) + floorRise + view)
                    // Stay within the asserted money range.
                    fc.pre(expected <= MONEY_MAX)

                    expect(computeTotalPrice(basePsf, area, floorRise, view)).toBe(expected)
                },
            ),
        )
    })

    // Feature: real-estate-crm, Property 1: Unit total price composition
    it('treats omitted premiums as zero', () => {
        fcAssert(
            fc.property(basePsfArb, areaArb, (basePsf, area) => {
                const expected = roundMoney(roundMoney(basePsf * area))
                expect(computeTotalPrice(basePsf, area)).toBe(expected)
            }),
        )
    })
})

// ---------------------------------------------------------------------------
// Property 2 — Percentage sold is bounded and well-defined (Req 1.6)
// ---------------------------------------------------------------------------

describe('Property 2: Percentage sold is bounded and well-defined', () => {
    // Counts where booked + sold ≤ total (a consistent inventory), so the
    // formula round((booked + sold) / total × 100) is naturally within [0,100].
    const consistentCountsArb = fc
        .integer({ min: 1, max: 100_000 })
        .chain((total) =>
            fc.nat({ max: total }).chain((booked) =>
                fc
                    .nat({ max: total - booked })
                    .map((sold) => ({ booked, sold, total })),
            ),
        )

    // Feature: real-estate-crm, Property 2: Percentage sold is bounded and well-defined
    it('returns round((booked + sold) / total × 100), an integer in [0, 100]', () => {
        fcAssert(
            fc.property(consistentCountsArb, ({ booked, sold, total }) => {
                const result = computePercentSold(booked, sold, total)
                const expected = Math.round(((booked + sold) / total) * 100)

                expect(Number.isInteger(result)).toBe(true)
                expect(result).toBe(expected)
                expect(result).toBeGreaterThanOrEqual(0)
                expect(result).toBeLessThanOrEqual(100)
            }),
        )
    })

    // Feature: real-estate-crm, Property 2: Percentage sold is bounded and well-defined
    it('returns exactly 0 when total is 0', () => {
        fcAssert(
            fc.property(fc.nat({ max: 100_000 }), fc.nat({ max: 100_000 }), (booked, sold) => {
                expect(computePercentSold(booked, sold, 0)).toBe(0)
            }),
        )
    })

    // Feature: real-estate-crm, Property 2: Percentage sold is bounded and well-defined
    it('clamps to [0, 100] for any arbitrary (even inconsistent) counts', () => {
        fcAssert(
            fc.property(
                fc.nat({ max: 1_000_000 }),
                fc.nat({ max: 1_000_000 }),
                fc.nat({ max: 1_000_000 }),
                (booked, sold, total) => {
                    const result = computePercentSold(booked, sold, total)
                    expect(Number.isInteger(result)).toBe(true)
                    expect(result).toBeGreaterThanOrEqual(0)
                    expect(result).toBeLessThanOrEqual(100)
                },
            ),
        )
    })
})

// ---------------------------------------------------------------------------
// Property 3 — Unit filtering soundness and completeness (Req 1.8)
// ---------------------------------------------------------------------------

describe('Property 3: Unit filtering soundness and completeness', () => {
    const filterableUnitArb: fc.Arbitrary<FilterableUnit> = fc.record({
        type: typeArb,
        status: statusArb,
        facing: facingArb,
        floorNumber: fc.nat({ max: 50 }),
        builtUpArea: fc
            .double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true })
            .map((n) => Math.round(n * 100) / 100),
        totalPrice: moneyArb,
    })

    /** Optionally produce a scalar-or-list filter from a value arbitrary. */
    function optionalScalarFilter<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | T[] | undefined> {
        return fc.oneof(
            fc.constant<undefined>(undefined),
            arb,
            fc.array(arb, { minLength: 1, maxLength: 4 }),
        )
    }

    const filtersArb: fc.Arbitrary<UnitFilters> = fc.record({
        type: optionalScalarFilter(typeArb),
        status: optionalScalarFilter(statusArb),
        facing: optionalScalarFilter(facingArb),
        floor: optionalScalarFilter(fc.nat({ max: 50 })),
        minPrice: fc.option(moneyArb, { nil: undefined }),
        maxPrice: fc.option(moneyArb, { nil: undefined }),
        minArea: fc.option(
            fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }),
            { nil: undefined },
        ),
        maxArea: fc.option(
            fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }),
            { nil: undefined },
        ),
    })

    // Feature: real-estate-crm, Property 3: Unit filtering soundness and completeness
    it('returns exactly the units satisfying all active filters (sound + complete)', () => {
        fcAssert(
            fc.property(
                fc.array(filterableUnitArb, { maxLength: 30 }),
                filtersArb,
                (units, filters) => {
                    const result = filterUnits(units, filters)

                    // Soundness: every returned unit satisfies all active filters.
                    for (const unit of result) {
                        expect(matchesUnitFilters(unit, filters)).toBe(true)
                    }

                    // Completeness: every excluded unit fails at least one filter.
                    const excluded = units.filter((u) => !result.includes(u))
                    for (const unit of excluded) {
                        expect(matchesUnitFilters(unit, filters)).toBe(false)
                    }

                    // Empty iff no unit in the set matches.
                    const anyMatch = units.some((u) => matchesUnitFilters(u, filters))
                    expect(result.length === 0).toBe(!anyMatch)
                },
            ),
        )
    })

    // Feature: real-estate-crm, Property 3: Unit filtering soundness and completeness
    it('returns all units when no filter is active', () => {
        fcAssert(
            fc.property(fc.array(filterableUnitArb, { maxLength: 30 }), (units) => {
                expect(filterUnits(units, {})).toEqual(units)
            }),
        )
    })
})

// ---------------------------------------------------------------------------
// Property 6 — Unit status transition table (Req 2.1, 2.2)
// ---------------------------------------------------------------------------

describe('Property 6: Unit status transition table', () => {
    // The permitted transitions, defined independently of the implementation.
    const PERMITTED = new Set<string>([
        'Available->Blocked',
        'Blocked->Available',
        'Blocked->Booked',
        'Available->Booked',
        'Booked->Sold',
        'Booked->Available',
        'Sold->Mortgaged',
    ])

    // Feature: real-estate-crm, Property 6: Unit status transition table
    it('canTransition is true iff the (from, to) pair is permitted', () => {
        fcAssert(
            fc.property(statusArb, statusArb, (from, to) => {
                const expected = PERMITTED.has(`${from}->${to}`)
                expect(canTransition(from, to)).toBe(expected)
            }),
        )
    })

    // Feature: real-estate-crm, Property 6: Unit status transition table
    it('rejects every self-transition', () => {
        fcAssert(
            fc.property(statusArb, (status) => {
                expect(canTransition(status, status)).toBe(false)
            }),
        )
    })

    it('exhaustively matches the permitted transition table', () => {
        for (const from of UNIT_STATUSES) {
            for (const to of UNIT_STATUSES) {
                expect(canTransition(from, to)).toBe(PERMITTED.has(`${from}->${to}`))
            }
        }
    })
})

// ---------------------------------------------------------------------------
// Property 11 — Inventory analytics aggregation (Req 2.8)
// ---------------------------------------------------------------------------

describe('Property 11: Inventory analytics aggregation', () => {
    const analyticsUnitArb = fc.record({
        status: statusArb,
        totalPrice: moneyArb,
    })

    // Feature: real-estate-crm, Property 11: Inventory analytics aggregation
    it('aggregates percentSold, revenuePotential, and availableStockValue', () => {
        fcAssert(
            fc.property(fc.array(analyticsUnitArb, { maxLength: 50 }), (units) => {
                const result = computeAnalytics(units)

                const booked = units.filter((u) => u.status === 'Booked').length
                const sold = units.filter((u) => u.status === 'Sold').length
                const revenueExpected = roundMoney(
                    units.reduce((sum, u) => sum + u.totalPrice, 0),
                )
                const availableExpected = roundMoney(
                    units
                        .filter((u) => u.status === 'Available')
                        .reduce((sum, u) => sum + u.totalPrice, 0),
                )

                expect(result.percentSold).toBe(computePercentSold(booked, sold, units.length))
                expect(result.revenuePotential).toBe(revenueExpected)
                expect(result.availableStockValue).toBe(availableExpected)
            }),
        )
    })

    // Feature: real-estate-crm, Property 11: Inventory analytics aggregation
    it('availableStockValue never exceeds revenuePotential', () => {
        fcAssert(
            fc.property(fc.array(analyticsUnitArb, { maxLength: 50 }), (units) => {
                const result = computeAnalytics(units)
                expect(result.availableStockValue).toBeLessThanOrEqual(result.revenuePotential)
            }),
        )
    })

    // Feature: real-estate-crm, Property 11: Inventory analytics aggregation
    it('returns zeroed analytics for an empty unit set', () => {
        const result = computeAnalytics([])
        expect(result).toEqual({
            percentSold: 0,
            revenuePotential: 0,
            availableStockValue: 0,
        })
    })
})
