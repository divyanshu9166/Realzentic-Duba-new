/**
 * Pure, property-testable inventory helpers for the Real Estate CRM
 * (Module 1 — Inventory).
 *
 * Every function in this module is PURE: it performs no database access, no
 * I/O, and has no side effects. This keeps the core inventory math and the
 * unit-status state machine directly property-testable (see design Properties
 * 1, 2, 3, 6, and 11) and lets the server actions in
 * `app/actions/properties.ts` compose them inside transactions.
 *
 * Monetary computation reuses the shared semantics in `lib/money.ts`
 * (`roundMoney` round-half-up to 2 dp, `assertMoneyRange` 0.00–999,999,999.99).
 *
 * Requirements: 1.5, 1.6, 1.8, 2.1, 2.2, 2.8
 */

import { assertMoneyRange, roundMoney } from '@/lib/money'

// ---------------------------------------------------------------------------
// Domain enums (mirror the Prisma enums in `prisma/schema.prisma`)
// ---------------------------------------------------------------------------

/** Unit status state machine values (Prisma enum `UnitStatus`). */
export type UnitStatus = 'Available' | 'Blocked' | 'Booked' | 'Sold' | 'Mortgaged'

/** Unit type values (Prisma enum `UnitType`). */
export type UnitType = 'Studio' | 'Apartment1' | 'Apartment2' | 'Apartment3' | 'Apartment4Plus' | 'Penthouse' | 'Villa' | 'Townhouse' | 'Duplex' | 'Retail' | 'Office' | 'Warehouse' | 'LandPlot' | 'BHK1' | 'BHK2' | 'BHK3' | 'BHK4' | 'Shop' | 'Plot'

/** Unit facing values (Prisma enum `UnitFacing`). */
export type UnitFacing = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW'

// ---------------------------------------------------------------------------
// Req 1.5 — Unit total price composition (design Property 1)
// ---------------------------------------------------------------------------

/**
 * Compute a unit's total price as the sum of the base cost (base price per
 * square foot × super-built-up area, rounded to 2 dp) plus the floor-rise
 * premium and the view premium.
 *
 * Per design Property 1, the result equals
 * `round(basePsf × superBuiltUpArea, 2) + floorRisePremium + viewPremium`.
 *
 * @param basePricePerSqft   Base price per square foot (money).
 * @param superBuiltUpArea   Super-built-up area in square feet.
 * @param floorRisePremium   Floor-rise premium (money, default 0).
 * @param viewPremium        View premium (money, default 0).
 * @returns The total price rounded to 2 dp, asserted within the money range.
 */
export function computeTotalPrice(
    basePricePerSqft: number,
    superBuiltUpArea: number,
    floorRisePremium: number = 0,
    viewPremium: number = 0
): number {
    const baseCost = roundMoney(basePricePerSqft * superBuiltUpArea)
    const total = roundMoney(baseCost + floorRisePremium + viewPremium)
    return assertMoneyRange(total)
}

// ---------------------------------------------------------------------------
// Req 1.6 — Percentage sold (design Property 2)
// ---------------------------------------------------------------------------

/**
 * Compute the percentage of a project's units that are sold, defined as
 * `(booked + sold) / total × 100` rounded to the nearest integer, and exactly
 * `0` when `total` is `0` (or non-positive).
 *
 * The result is always an integer clamped to `[0, 100]` (design Property 2).
 *
 * @param booked Count of Booked units.
 * @param sold   Count of Sold units.
 * @param total  Total unit count.
 */
export function computePercentSold(booked: number, sold: number, total: number): number {
    if (!Number.isFinite(total) || total <= 0) return 0

    const ratio = ((booked + sold) / total) * 100
    const rounded = Math.round(ratio)

    // Clamp defensively so the contract (an integer in [0, 100]) always holds,
    // even if callers pass inconsistent counts.
    if (rounded < 0) return 0
    if (rounded > 100) return 100
    return rounded
}

// ---------------------------------------------------------------------------
// Req 2.1 / 2.2 — Unit status transition table (design Property 6)
// ---------------------------------------------------------------------------

/**
 * The complete set of permitted unit-status transitions, keyed by the source
 * status. Any `(from, to)` pair not represented here is rejected.
 *
 * Permitted: Available→Blocked, Blocked→Available, Blocked→Booked,
 * Available→Booked, Booked→Sold, Booked→Available, Sold→Mortgaged.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<UnitStatus, readonly UnitStatus[]>> = {
    Available: ['Blocked', 'Booked'],
    Blocked: ['Available', 'Booked'],
    Booked: ['Sold', 'Available'],
    Sold: ['Mortgaged'],
    Mortgaged: [],
}

/**
 * Return `true` if and only if moving a unit from `from` to `to` is one of the
 * permitted transitions (design Property 6). Self-transitions and any pair not
 * in the table return `false`.
 */
export function canTransition(from: UnitStatus, to: UnitStatus): boolean {
    const allowed = ALLOWED_TRANSITIONS[from]
    if (!allowed) return false
    return allowed.includes(to)
}

// ---------------------------------------------------------------------------
// Req 1.8 — Unit filtering (design Property 3)
// ---------------------------------------------------------------------------

/** The subset of unit fields used for filtering. */
export interface FilterableUnit {
    type: UnitType
    status: UnitStatus
    facing: UnitFacing
    floorNumber: number
    /** Super-built-up area in square feet, used as the "area" filter basis. */
    superBuiltUpArea: number
    /** Total price (money), used as the "price" filter basis. */
    totalPrice: number
}

/**
 * Filter criteria. Every field is optional; only provided ("active") filters
 * constrain the result. Scalar enum filters may be a single value or a list of
 * accepted values. Range filters are inclusive bounds.
 */
export interface UnitFilters {
    type?: UnitType | UnitType[]
    status?: UnitStatus | UnitStatus[]
    facing?: UnitFacing | UnitFacing[]
    floor?: number | number[]
    minPrice?: number
    maxPrice?: number
    minArea?: number
    maxArea?: number
}

function matchesScalar<T>(value: T, filter: T | T[] | undefined): boolean {
    if (filter === undefined) return true
    return Array.isArray(filter) ? filter.includes(value) : value === filter
}

/**
 * Pure predicate: return `true` when `unit` satisfies every active filter in
 * `filters`. An absent filter field imposes no constraint.
 *
 * Used as the basis for {@link filterUnits} and is the unit of soundness for
 * design Property 3.
 */
export function matchesUnitFilters<U extends FilterableUnit>(
    unit: U,
    filters: UnitFilters
): boolean {
    if (!matchesScalar(unit.type, filters.type)) return false
    if (!matchesScalar(unit.status, filters.status)) return false
    if (!matchesScalar(unit.facing, filters.facing)) return false
    if (!matchesScalar(unit.floorNumber, filters.floor)) return false

    if (filters.minPrice !== undefined && unit.totalPrice < filters.minPrice) return false
    if (filters.maxPrice !== undefined && unit.totalPrice > filters.maxPrice) return false
    if (filters.minArea !== undefined && unit.superBuiltUpArea < filters.minArea) return false
    if (filters.maxArea !== undefined && unit.superBuiltUpArea > filters.maxArea) return false

    return true
}

/**
 * Pure filter: return the subset of `units` that satisfy all active filters.
 *
 * By construction every unit in the result satisfies all active filters, and
 * the result is empty if and only if no unit in `units` satisfies all active
 * filters (design Property 3 — soundness and completeness).
 */
export function filterUnits<U extends FilterableUnit>(units: U[], filters: UnitFilters): U[] {
    return units.filter((unit) => matchesUnitFilters(unit, filters))
}

// ---------------------------------------------------------------------------
// Req 2.8 — Inventory analytics aggregation (design Property 11)
// ---------------------------------------------------------------------------

/** The subset of unit fields needed to aggregate inventory analytics. */
export interface AnalyticsUnit {
    status: UnitStatus
    totalPrice: number
}

/** Aggregated inventory analytics for a project. */
export interface InventoryAnalytics {
    /** Percentage of units that are Booked or Sold, integer in [0, 100]. */
    percentSold: number
    /** Sum of total price across all units (money). */
    revenuePotential: number
    /** Sum of total price across Available units (money). */
    availableStockValue: number
}

/**
 * Aggregate inventory analytics over a set of units (design Property 11):
 * - `percentSold` per {@link computePercentSold} over Booked + Sold counts,
 * - `revenuePotential` = sum of total price across all units,
 * - `availableStockValue` = sum of total price across Available units.
 *
 * Because available stock is a subset of all units (and prices are
 * non-negative money), `availableStockValue` never exceeds `revenuePotential`.
 */
export function computeAnalytics(units: AnalyticsUnit[]): InventoryAnalytics {
    let booked = 0
    let sold = 0
    let revenuePotential = 0
    let availableStockValue = 0

    for (const unit of units) {
        revenuePotential += unit.totalPrice
        if (unit.status === 'Booked') booked += 1
        else if (unit.status === 'Sold') sold += 1
        else if (unit.status === 'Available') availableStockValue += unit.totalPrice
    }

    return {
        percentSold: computePercentSold(booked, sold, units.length),
        revenuePotential: roundMoney(revenuePotential),
        availableStockValue: roundMoney(availableStockValue),
    }
}
