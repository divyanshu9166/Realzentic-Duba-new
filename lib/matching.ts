/**
 * AI Property Matching — PURE scoring helpers (no DB/IO).
 *
 * These functions back Module 13 (AI Property Matching). They are kept free of
 * any database or side-effecting logic so the scoring math can be unit- and
 * property-tested in isolation and reused by the `app/actions/ai-matching.ts`
 * server actions.
 *
 * Design references:
 *   - Property 55 — match scoring is bounded ([0,100]) and ranked
 *     (non-increasing order).                                        Req 16.1
 *   - Property 56 — matching considers only Available units.         Req 16.2
 *
 * Buyer preferences (Req 16.1) cover: budget range, location or project, property type
 * (Dubai property type), facing, floor, carpet area, and amenities. Every preference is
 * OPTIONAL — only the preferences a buyer actually supplies ("active"
 * dimensions) constrain the score. When no preference is active, every unit is
 * a vacuous full match (score 100).
 *
 * Requirements: 16.1, 16.2
 */

import type { UnitFacing, UnitStatus, UnitType } from '@/lib/inventory'

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/**
 * Buyer preferences used to score units. Every field is optional; an omitted
 * field imposes no constraint and contributes no weight to the score.
 *
 * Range filters are inclusive bounds. Scalar enum filters may be a single value
 * or a list of accepted values (any match counts).
 */
export interface BuyerPreferences {
    /** Minimum acceptable total price (money). */
    minBudget?: number
    /** Maximum acceptable total price (money). */
    maxBudget?: number
    /** Preferred project id (exact match against {@link MatchableUnit.projectId}). */
    projectId?: number
    /** Preferred location/city text (case-insensitive substring match). */
    location?: string
    /** Preferred Dubai property type(s) / bedroom configuration. */
    type?: UnitType | UnitType[]
    /** Preferred facing(s). */
    facing?: UnitFacing | UnitFacing[]
    /** Minimum acceptable floor number. */
    minFloor?: number
    /** Maximum acceptable floor number. */
    maxFloor?: number
    /** Minimum acceptable carpet area (sq ft). */
    minCarpetArea?: number
    /** Maximum acceptable carpet area (sq ft). */
    maxCarpetArea?: number
    /** Desired amenities (matched against the unit's project amenities). */
    amenities?: string[]
}

/**
 * The subset of unit (and parent project) fields needed to score a match.
 * `projectId`, `location`, and `amenities` originate from the unit's project
 * and may be absent when unknown.
 */
export interface MatchableUnit {
    status: UnitStatus
    type: UnitType
    facing: UnitFacing
    floorNumber: number
    /** Carpet area in square feet. */
    carpetArea: number
    /** Total price (money). */
    totalPrice: number
    /** Parent project id, used for the location/project preference. */
    projectId?: number
    /** Project location/city text, used for the location preference. */
    location?: string
    /** Project amenities, used for the amenities preference. */
    amenities?: string[]
}

/** A unit paired with its computed match percentage. */
export interface MatchResult<U extends MatchableUnit = MatchableUnit> {
    unit: U
    /** Match percentage, an integer in [0, 100]. */
    matchPercentage: number
}

// ---------------------------------------------------------------------------
// Dimension weights
// ---------------------------------------------------------------------------

/**
 * Relative importance of each preference dimension. Only the dimensions a buyer
 * supplies contribute; the final score normalizes by the sum of active weights
 * so the result is always a percentage in [0, 100].
 */
const WEIGHTS = {
    budget: 25,
    type: 20,
    carpetArea: 15,
    location: 15,
    facing: 10,
    floor: 10,
    amenities: 5,
} as const

/** Bedroom rank for graceful partial matching between apartment configurations. */
const BEDROOM_RANK: Partial<Record<UnitType, number>> = {
    Studio: 0,
    Apartment1: 1,
    Apartment2: 2,
    Apartment3: 3,
    Apartment4Plus: 4,
}

// ---------------------------------------------------------------------------
// Subscore helpers (each returns a value in [0, 1])
// ---------------------------------------------------------------------------

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Score a value against an inclusive range with a relative falloff outside it.
 * Inside the range scores 1; outside, the score decays linearly with the
 * relative deviation from the nearest bound, reaching 0 once the deviation
 * exceeds `toleranceFraction` of that bound.
 */
function relativeRangeSubscore(
    value: number,
    min: number | undefined,
    max: number | undefined,
    toleranceFraction: number
): number {
    if (min !== undefined && value < min) {
        const ref = Math.abs(min) > 0 ? Math.abs(min) : 1
        return clamp01(1 - (min - value) / ref / toleranceFraction)
    }
    if (max !== undefined && value > max) {
        const ref = Math.abs(max) > 0 ? Math.abs(max) : 1
        return clamp01(1 - (value - max) / ref / toleranceFraction)
    }
    return 1
}

/**
 * Score a value against an inclusive range with an absolute falloff (in the
 * same units as the value). Used for floor numbers, where a relative falloff
 * would be ill-behaved for small integers.
 */
function absoluteRangeSubscore(
    value: number,
    min: number | undefined,
    max: number | undefined,
    tolerance: number
): number {
    if (min !== undefined && value < min) return clamp01(1 - (min - value) / tolerance)
    if (max !== undefined && value > max) return clamp01(1 - (value - max) / tolerance)
    return 1
}

/** Coerce a scalar-or-array preference into an array of accepted values. */
function asList<T>(filter: T | T[] | undefined): T[] {
    if (filter === undefined) return []
    return Array.isArray(filter) ? filter : [filter]
}

/** Score the unit type against preferred type(s), with bedroom-count proximity. */
function typeSubscore(prefTypes: UnitType[], unitType: UnitType): number {
    if (prefTypes.includes(unitType)) return 1

    const unitRank = BEDROOM_RANK[unitType]
    if (unitRank === undefined) return 0

    // Best proximity to any preferred apartment type (adjacent bedroom count is a near match).
    let best = 0
    for (const pref of prefTypes) {
        const prefRank = BEDROOM_RANK[pref]
        if (prefRank === undefined) continue
        best = Math.max(best, clamp01(1 - Math.abs(unitRank - prefRank) / 3))
    }
    return best
}

/** Score the location/project dimension from whichever signals are supplied. */
function locationSubscore(preferences: BuyerPreferences, unit: MatchableUnit): number {
    let best = 0

    if (preferences.projectId !== undefined && unit.projectId !== undefined) {
        best = Math.max(best, preferences.projectId === unit.projectId ? 1 : 0)
    }

    const wanted = preferences.location?.trim().toLowerCase()
    if (wanted && unit.location) {
        const have = unit.location.trim().toLowerCase()
        if (have === wanted || have.includes(wanted) || wanted.includes(have)) best = Math.max(best, 1)
    }

    return best
}

/** True when the location/project dimension is active for these preferences. */
function locationActive(preferences: BuyerPreferences): boolean {
    return preferences.projectId !== undefined || !!preferences.location?.trim()
}

/** Score desired amenities as the fraction present in the unit's project. */
function amenitiesSubscore(desired: string[], available: string[] | undefined): number {
    const norm = (s: string) => s.trim().toLowerCase()
    const have = new Set((available ?? []).map(norm))
    if (desired.length === 0) return 1
    let matched = 0
    for (const want of desired) {
        if (have.has(norm(want))) matched += 1
    }
    return matched / desired.length
}

// ---------------------------------------------------------------------------
// Req 16.1 — Match scorer (design Property 55)
// ---------------------------------------------------------------------------

/**
 * Score how well a unit matches a buyer's preferences.
 *
 * Returns an integer in `[0, 100]` (design Property 55 / Req 16.1). Only the
 * preferences the buyer supplies contribute; the score is the active-weighted
 * average of per-dimension subscores, scaled to a percentage. When no
 * preference is active the unit is a vacuous full match and the score is `100`.
 *
 * Pure and deterministic: the same `(preferences, unit)` always yield the same
 * score, independent of any other unit.
 */
export function scoreMatch(preferences: BuyerPreferences, unit: MatchableUnit): number {
    let weighted = 0
    let totalWeight = 0

    // Budget range.
    if (preferences.minBudget !== undefined || preferences.maxBudget !== undefined) {
        totalWeight += WEIGHTS.budget
        weighted +=
            WEIGHTS.budget *
            relativeRangeSubscore(unit.totalPrice, preferences.minBudget, preferences.maxBudget, 0.2)
    }

    // Unit type / bedroom configuration.
    const prefTypes = asList(preferences.type)
    if (prefTypes.length > 0) {
        totalWeight += WEIGHTS.type
        weighted += WEIGHTS.type * typeSubscore(prefTypes, unit.type)
    }

    // Carpet area range.
    if (preferences.minCarpetArea !== undefined || preferences.maxCarpetArea !== undefined) {
        totalWeight += WEIGHTS.carpetArea
        weighted +=
            WEIGHTS.carpetArea *
            relativeRangeSubscore(
                unit.carpetArea,
                preferences.minCarpetArea,
                preferences.maxCarpetArea,
                0.2
            )
    }

    // Location / project.
    if (locationActive(preferences)) {
        totalWeight += WEIGHTS.location
        weighted += WEIGHTS.location * locationSubscore(preferences, unit)
    }

    // Facing.
    const prefFacings = asList(preferences.facing)
    if (prefFacings.length > 0) {
        totalWeight += WEIGHTS.facing
        weighted += WEIGHTS.facing * (prefFacings.includes(unit.facing) ? 1 : 0)
    }

    // Floor range.
    if (preferences.minFloor !== undefined || preferences.maxFloor !== undefined) {
        totalWeight += WEIGHTS.floor
        weighted +=
            WEIGHTS.floor *
            absoluteRangeSubscore(unit.floorNumber, preferences.minFloor, preferences.maxFloor, 5)
    }

    // Amenities.
    if (preferences.amenities && preferences.amenities.length > 0) {
        totalWeight += WEIGHTS.amenities
        weighted += WEIGHTS.amenities * amenitiesSubscore(preferences.amenities, unit.amenities)
    }

    // No active preference → vacuous full match.
    if (totalWeight === 0) return 100

    const percentage = Math.round((weighted / totalWeight) * 100)
    // Clamp defensively so the contract (an integer in [0, 100]) always holds.
    return Math.max(0, Math.min(100, percentage))
}

// ---------------------------------------------------------------------------
// Req 16.2 — Available-only filter (design Property 56)
// ---------------------------------------------------------------------------

/** True when a unit is sellable, i.e. its status is `Available`. */
export function isAvailable(unit: MatchableUnit): boolean {
    return unit.status === 'Available'
}

/** Return only the units whose status is `Available` (design Property 56). */
export function filterAvailable<U extends MatchableUnit>(units: readonly U[]): U[] {
    return units.filter(isAvailable)
}

// ---------------------------------------------------------------------------
// Req 16.1 — Ranking (design Property 55)
// ---------------------------------------------------------------------------

/**
 * Rank units against preferences in non-increasing order of match percentage
 * (design Property 55). Does NOT filter by status — pair with
 * {@link filterAvailable} (or use {@link matchUnits}) when only Available units
 * should be considered.
 *
 * The sort is stable: units with equal scores keep their input order.
 */
export function rankByMatch<U extends MatchableUnit>(
    preferences: BuyerPreferences,
    units: readonly U[]
): MatchResult<U>[] {
    return units
        .map((unit, index) => ({ unit, index, matchPercentage: scoreMatch(preferences, unit) }))
        .sort((a, b) => b.matchPercentage - a.matchPercentage || a.index - b.index)
        .map(({ unit, matchPercentage }) => ({ unit, matchPercentage }))
}

/**
 * Produce a ranked list of **Available-only** units with a match percentage for
 * each (Req 16.1 + 16.2 / design Properties 55 & 56): filter to Available
 * units, score each against the preferences, and order the result in
 * non-increasing order of match percentage.
 */
export function matchUnits<U extends MatchableUnit>(
    preferences: BuyerPreferences,
    units: readonly U[]
): MatchResult<U>[] {
    return rankByMatch(preferences, filterAvailable(units))
}
