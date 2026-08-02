/**
 * Geo and visit-analytics pure helpers for Site Visit 2.0 (Module 9).
 *
 * Every function in this module is PURE: it performs no DB/IO, does not read
 * the global clock, and does not call `Math.random()` implicitly. Any source
 * of randomness or "now" is passed in as a parameter so the helpers stay
 * deterministic and property-testable.
 *
 * Requirements:
 *   - 12.4 — Geo distance + 500m geofence threshold.
 *   - 12.6 — Visit analytics aggregation (count, avg rating, avg duration).
 */

/** Mean Earth radius in meters (WGS-84 spherical approximation). */
export const EARTH_RADIUS_M = 6_371_000

/** Default geofence radius in meters (Req 12.4). */
export const DEFAULT_GEOFENCE_RADIUS_M = 500

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/** Great-circle distance in meters between two WGS-84 coordinates. */
export function haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
): number {
    for (const value of [lat1, lng1, lat2, lng2]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`haversineMeters expects finite coordinates, received: ${String(value)}`)
        }
    }

    const dLat = toRadians(lat2 - lat1)
    const dLng = toRadians(lng2 - lng1)
    const lat1Rad = toRadians(lat1)
    const lat2Rad = toRadians(lat2)
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2
    const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)))
    return EARTH_RADIUS_M * c
}

/** Whether coordinates are within the configured project geofence. */
export function withinGeofence(
    agentLat: number,
    agentLng: number,
    projLat: number,
    projLng: number,
    radiusM: number = DEFAULT_GEOFENCE_RADIUS_M,
): boolean {
    if (typeof radiusM !== 'number' || !Number.isFinite(radiusM)) {
        throw new Error(`withinGeofence expects a finite radius, received: ${String(radiusM)}`)
    }
    return haversineMeters(agentLat, agentLng, projLat, projLng) <= radiusM
}

export interface VisitRecord {
    /** Buyer rating (1..5), if the visit was rated. */
    buyerRating?: number | null
    /** Visit duration in minutes, if the visit was timed. */
    visitDurationMin?: number | null
}

/** Aggregated analytics over a set of completed visits. */
export interface VisitAnalytics {
    /** Total number of visits in the input set. */
    visitCount: number
    /** Average buyer rating over rated visits, or `null` when none are rated. */
    averageRating: number | null
    /** Average duration (minutes) over timed visits, or `null` when none are timed. */
    averageDuration: number | null
}

/**
 * Aggregate analytics over a set of completed visits.
 *
 * Returns the visit count, the average buyer rating across visits that carry a
 * rating, and the average visit duration across visits that carry a duration.
 * Averages are `null` when there are no qualifying visits, avoiding a
 * divide-by-zero (design Property 47).
 *
 * Requirements: 12.6.
 */
export function computeVisitAnalytics(visits: VisitRecord[]): VisitAnalytics {
    const ratings: number[] = []
    const durations: number[] = []

    for (const visit of visits) {
        if (typeof visit.buyerRating === 'number' && Number.isFinite(visit.buyerRating)) {
            ratings.push(visit.buyerRating)
        }
        if (
            typeof visit.visitDurationMin === 'number' &&
            Number.isFinite(visit.visitDurationMin)
        ) {
            durations.push(visit.visitDurationMin)
        }
    }

    const average = (values: number[]): number | null =>
        values.length === 0
            ? null
            : values.reduce((sum, v) => sum + v, 0) / values.length

    return {
        visitCount: visits.length,
        averageRating: average(ratings),
        averageDuration: average(durations),
    }
}

// ─── Live agent-presence classification (Live Field-Force Tracking) ──────────

/**
 * Presence state derived from how long ago an agent's last GPS ping arrived.
 *   - `online`  — pinged within `onlineWithinSec`.
 *   - `away`    — pinged within `awayWithinSec` (but not recently enough for online).
 *   - `offline` — no ping within `awayWithinSec` (or never pinged).
 */
export type AgentPresence = 'online' | 'away' | 'offline'

/** Default: a ping is "online" if seen within the last 60s. */
export const DEFAULT_ONLINE_WITHIN_SEC = 60

/** Default: a ping is "away" if seen within the last 5 minutes. */
export const DEFAULT_AWAY_WITHIN_SEC = 300

/**
 * Classify an agent's live presence from the age of their most recent ping.
 *
 * Pure and deterministic: both "now" and the last-seen instant are passed in
 * as epoch-millisecond numbers. A `null`/`undefined` last-seen (the agent has
 * never pinged) is always `offline`. The boundaries are inclusive: an age of
 * exactly `onlineWithinSec` is still `online`, and exactly `awayWithinSec` is
 * still `away`. Future-dated pings (negative age, e.g. minor clock skew) are
 * treated as `online`.
 *
 * @param lastSeenMs       Epoch ms of the agent's latest ping, or null/undefined.
 * @param nowMs            Epoch ms of the current instant.
 * @param onlineWithinSec  Max age (seconds) to be considered online.
 * @param awayWithinSec    Max age (seconds) to be considered away.
 * @throws if `onlineWithinSec` or `awayWithinSec` is not a finite, non-negative
 *         number, or if `onlineWithinSec > awayWithinSec`.
 */
export function classifyPresence(
    lastSeenMs: number | null | undefined,
    nowMs: number,
    onlineWithinSec: number = DEFAULT_ONLINE_WITHIN_SEC,
    awayWithinSec: number = DEFAULT_AWAY_WITHIN_SEC
): AgentPresence {
    for (const [name, value] of [
        ['onlineWithinSec', onlineWithinSec],
        ['awayWithinSec', awayWithinSec],
        ['nowMs', nowMs],
    ] as const) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`classifyPresence expects a finite ${name}, received: ${String(value)}`)
        }
    }
    if (onlineWithinSec < 0 || awayWithinSec < 0) {
        throw new Error('classifyPresence thresholds must be non-negative')
    }
    if (onlineWithinSec > awayWithinSec) {
        throw new Error('classifyPresence requires onlineWithinSec <= awayWithinSec')
    }

    if (typeof lastSeenMs !== 'number' || !Number.isFinite(lastSeenMs)) {
        return 'offline'
    }

    const ageSec = (nowMs - lastSeenMs) / 1000
    // Future-dated or just-now pings are online.
    if (ageSec <= onlineWithinSec) return 'online'
    if (ageSec <= awayWithinSec) return 'away'
    return 'offline'
}
