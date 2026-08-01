import { z } from 'zod'

/**
 * Zod schemas for live agent-location tracking (`app/actions/agent-tracking.ts`).
 *
 * Coordinates are validated against WGS-84 bounds so a malformed device ping
 * can never reach the database. Optional telemetry (accuracy/speed/heading)
 * is bounded to physically sensible ranges and silently dropped when absent.
 */

/** A single GPS ping pushed by an on-shift agent device. */
export const recordLocationSchema = z.object({
    latitude: z
        .number()
        .finite()
        .min(-90, 'latitude must be between -90 and 90')
        .max(90, 'latitude must be between -90 and 90'),
    longitude: z
        .number()
        .finite()
        .min(-180, 'longitude must be between -180 and 180')
        .max(180, 'longitude must be between -180 and 180'),
    accuracyM: z.number().finite().min(0).max(100_000).optional(),
    speed: z.number().finite().min(0).max(1_000).optional(),
    heading: z.number().finite().min(0).max(360).optional(),
    visitId: z.number().int().positive().optional(),
})

export type RecordLocationInput = z.infer<typeof recordLocationSchema>

/** Options for the manager-facing live roster query. */
export const liveLocationsSchema = z.object({
    /**
     * Only include agents whose latest ping is within this many minutes.
     * Defaults to two minutes. Active location-sharing leases are additionally
     * enforced by the server, so a stale ping is never treated as live.
     */
    withinMinutes: z.number().int().positive().max(1440).optional(),
})

export type LiveLocationsInput = z.infer<typeof liveLocationsSchema>

/** Options for a single agent's recent movement trail. */
export const locationTrailSchema = z.object({
    staffId: z.number().int().positive(),
    sinceMinutes: z.number().int().positive().max(1440).optional(),
    limit: z.number().int().positive().max(2000).optional(),
})

export type LocationTrailInput = z.infer<typeof locationTrailSchema>
