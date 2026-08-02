/**
 * Shared rules for a project pin used by geo-verified site visits.
 *
 * A project pin represents the actual arrival point for the visit — normally
 * the sales gallery, building entrance, or agreed meeting point — not merely
 * the centre of a community or a text address.
 */

export const UAE_COORDINATE_BOUNDS = {
    minLatitude: 22.5,
    maxLatitude: 26.3,
    minLongitude: 51.4,
    maxLongitude: 56.5,
} as const

/** A practical default for project arrivals while allowing site-specific tuning. */
export const DEFAULT_PROJECT_GEOFENCE_RADIUS_M = 200
export const MIN_PROJECT_GEOFENCE_RADIUS_M = 50
export const MAX_PROJECT_GEOFENCE_RADIUS_M = 1_000

/** Whether a finite WGS-84 point falls inside the UAE operating boundary. */
export function isWithinUaeCoordinates(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= UAE_COORDINATE_BOUNDS.minLatitude
        && latitude <= UAE_COORDINATE_BOUNDS.maxLatitude
        && longitude >= UAE_COORDINATE_BOUNDS.minLongitude
        && longitude <= UAE_COORDINATE_BOUNDS.maxLongitude
}

/** A project is ready for geo-verified visits only after an explicit confirmation. */
export function isProjectLocationReady(input: {
    latitude: number | null | undefined
    longitude: number | null | undefined
    locationConfirmedAt: Date | string | null | undefined
}): boolean {
    return input.latitude != null
        && input.longitude != null
        && isWithinUaeCoordinates(input.latitude, input.longitude)
        && input.locationConfirmedAt != null
}
