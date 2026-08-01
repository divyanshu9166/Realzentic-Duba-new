/**
 * Shared policy helpers for the live field-force location stream.
 *
 * Location is useful only while it is recent. Keeping the policy in one small,
 * testable module keeps the client throttle, server write guard, and cleanup
 * job aligned.
 */

/** Retain agent GPS history for a short, operationally useful period. */
export const AGENT_LOCATION_RETENTION_DAYS = 7

/** Server-side backstop; the browser beacon normally sends at most every 30s. */
export const MIN_AGENT_LOCATION_PING_INTERVAL_MS = 25_000

/** Dubai does not observe daylight saving time. */
const DUBAI_UTC_OFFSET_MS = 4 * 60 * 60 * 1000

export function agentLocationRetentionCutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - AGENT_LOCATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

export function shouldRecordAgentLocation(
    lastRecordedAt: Date | null | undefined,
    now: Date = new Date(),
): boolean {
    return !lastRecordedAt || now.getTime() - lastRecordedAt.getTime() >= MIN_AGENT_LOCATION_PING_INTERVAL_MS
}

/**
 * Attendance dates are stored as midnight UTC for Dubai's calendar date.
 * Build the same value here before checking that an agent is currently on shift.
 */
export function dubaiAttendanceDate(now: Date = new Date()): Date {
    const dubaiNow = new Date(now.getTime() + DUBAI_UTC_OFFSET_MS)
    return new Date(Date.UTC(
        dubaiNow.getUTCFullYear(),
        dubaiNow.getUTCMonth(),
        dubaiNow.getUTCDate(),
    ))
}
