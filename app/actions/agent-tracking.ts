'use server'

/**
 * app/actions/agent-tracking.ts
 *
 * Live field-force tracking server actions.
 *
 *   - recordAgentLocation  — an on-shift agent's device pushes a GPS ping.
 *                            The owning staff is taken from the session, never
 *                            the client, so an agent can only write their own
 *                            location. Never throws.
 *   - getLiveAgentLocations — ADMIN/MANAGER only. Returns the newest ping per
 *                            agent within a recency window, enriched with the
 *                            agent's name/role, presence (online/away/offline),
 *                            and seconds-since-last-seen for the live map.
 *   - getAgentLocationTrail — ADMIN/MANAGER (or the agent themselves) reads a
 *                            single agent's recent movement trail.
 *
 * The newest-ping-per-agent read is done with a single grouped query plus one
 * batched fetch (no N+1). All presence math is delegated to the pure
 * `classifyPresence` helper in `lib/geo.ts`.
 */

import { prisma } from '@/lib/db'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import {
    classifyPresence,
    DEFAULT_AWAY_WITHIN_SEC,
    DEFAULT_ONLINE_WITHIN_SEC,
    type AgentPresence,
} from '@/lib/geo'
import {
    recordLocationSchema,
    liveLocationsSchema,
    locationTrailSchema,
} from '@/lib/validations/agent-tracking'
import {
    agentLocationSharingExpiresAt,
    dubaiAttendanceDate,
    shouldRecordAgentLocation,
} from '@/lib/agent-location'

// ─── Result types ────────────────────────────────────────────────────────────

export interface LiveAgentLocation {
    staffId: number
    name: string
    role: string
    latitude: number
    longitude: number
    accuracyM: number | null
    speed: number | null
    heading: number | null
    visitId: number | null
    recordedAt: string
    /** Whole seconds since the latest ping was recorded. */
    secondsAgo: number
    presence: AgentPresence
}

export interface TrailPoint {
    latitude: number
    longitude: number
    recordedAt: string
}

// ─── 1. Record a ping (agent → server) ─────────────────────────────────────────

/**
 * Persist one GPS ping for the currently-authenticated staff member.
 * The staffId is resolved from the session; the client cannot spoof it.
 * Returns `{ success: false }` (never throws) on auth/validation/DB errors so
 * the device beacon can keep retrying without crashing the page.
 */
export async function recordAgentLocation(
    input: unknown,
): Promise<{ success: boolean; error?: string; code?: 'NOT_CLOCKED_IN' | 'VISIT_NOT_ASSIGNED' }> {
    let staffId: number | null
    try {
        const session = await requireAuth()
        staffId = session.user.staffId
    } catch {
        return { success: false, error: 'Unauthorized' }
    }

    if (staffId == null) {
        return { success: false, error: 'Your account is not linked to a staff profile' }
    }

    const parsed = recordLocationSchema.safeParse(input)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    try {
        const now = new Date()
        const activeAttendance = await prisma.attendance.findFirst({
            where: {
                staffId,
                date: dubaiAttendanceDate(now),
                clockIn: { not: null },
                clockOut: null,
            },
            select: { id: true },
        })
        if (!activeAttendance) {
            return {
                success: false,
                code: 'NOT_CLOCKED_IN',
                error: 'Clock in before sharing live location',
            }
        }

        if (parsed.data.visitId != null) {
            const visit = await prisma.fieldVisit.findFirst({
                where: {
                    id: parsed.data.visitId,
                    staffId,
                    status: { in: ['Scheduled', 'In Progress'] },
                },
                select: { id: true },
            })
            if (!visit) {
                return {
                    success: false,
                    code: 'VISIT_NOT_ASSIGNED',
                    error: 'Only your assigned active site visits can be used for location tracking',
                }
            }
        }

        // The browser throttles to 30s, but this server-side guard prevents a
        // faulty or tampered client from turning the append-only GPS stream
        // into an unbounded write source.
        const previousPing = await prisma.agentLocation.findFirst({
            where: { staffId },
            orderBy: { recordedAt: 'desc' },
            select: { recordedAt: true },
        })
        if (!shouldRecordAgentLocation(previousPing?.recordedAt, now)) {
            // A user can stop and restart quickly. Make their most recent
            // in-window ping visible again without waiting for the next write.
            await prisma.staff.updateMany({
                where: { id: staffId, locationSharingStoppedAt: { not: null } },
                data: {
                    locationSharingStoppedAt: null,
                    locationSharingExpiresAt: agentLocationSharingExpiresAt(now),
                },
            })
            return { success: true }
        }

        await prisma.$transaction([
            prisma.agentLocation.create({
                data: {
                    staffId,
                    latitude: parsed.data.latitude,
                    longitude: parsed.data.longitude,
                    accuracyM: parsed.data.accuracyM ?? null,
                    speed: parsed.data.speed ?? null,
                    heading: parsed.data.heading ?? null,
                    visitId: parsed.data.visitId ?? null,
                },
            }),
            prisma.staff.update({
                where: { id: staffId },
                data: {
                    locationSharingStoppedAt: null,
                    locationSharingExpiresAt: agentLocationSharingExpiresAt(now),
                },
            }),
        ])
        return { success: true }
    } catch {
        return { success: false, error: 'Failed to record location' }
    }
}

/**
 * Mark the agent as no longer live immediately when they choose Stop sharing.
 * Historical pings remain available inside the short retention window, but the
 * manager roster excludes them on its next refresh.
 */
export async function stopAgentLocationSharing(): Promise<{ success: boolean; error?: string }> {
    let staffId: number | null
    try {
        const session = await requireAuth()
        staffId = session.user.staffId
    } catch {
        return { success: false, error: 'Unauthorized' }
    }

    if (staffId == null) {
        return { success: false, error: 'Your account is not linked to a staff profile' }
    }

    try {
        await prisma.staff.update({
            where: { id: staffId },
            data: {
                locationSharingStoppedAt: new Date(),
                locationSharingExpiresAt: null,
            },
        })
        return { success: true }
    } catch {
        return { success: false, error: 'Failed to stop location sharing' }
    }
}

// ─── 2. Live roster (manager → map) ─────────────────────────────────────────────

/**
 * Return the newest ping per agent within the recency window, enriched for the
 * live map. ADMIN/MANAGER only. Agents with no ping in the window are omitted.
 */
export async function getLiveAgentLocations(
    input: unknown = {},
): Promise<{ success: boolean; data?: LiveAgentLocation[]; error?: string }> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Forbidden' }
    }

    const parsed = liveLocationsSchema.safeParse(input)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const now = new Date()
    const withinMinutes = parsed.data.withinMinutes ?? 2
    const cutoff = new Date(now.getTime() - withinMinutes * 60_000)

    try {
        // Newest recordedAt per staff within the window (one grouped query).
        const latest = await prisma.agentLocation.groupBy({
            by: ['staffId'],
            where: { recordedAt: { gte: cutoff } },
            _max: { recordedAt: true },
        })

        if (latest.length === 0) {
            return { success: true, data: [] }
        }

        // Fetch the actual newest row for each staff in one batched query, then
        // pick the row matching each staff's max timestamp.
        const staffIds = latest.map((l) => l.staffId)
        const rows = await prisma.agentLocation.findMany({
            where: {
                staffId: { in: staffIds },
                recordedAt: { gte: cutoff },
            },
            orderBy: { recordedAt: 'desc' },
            include: {
                staff: {
                    select: {
                        id: true,
                        name: true,
                        role: true,
                        locationSharingStoppedAt: true,
                        locationSharingExpiresAt: true,
                    },
                },
            },
        })

        // First row per staff is the newest (rows are sorted desc).
        const newestByStaff = new Map<number, (typeof rows)[number]>()
        for (const row of rows) {
            if (!newestByStaff.has(row.staffId)) newestByStaff.set(row.staffId, row)
        }

        const nowMs = now.getTime()
        const data: LiveAgentLocation[] = [...newestByStaff.values()]
            .filter((row) =>
                row.staff?.locationSharingExpiresAt != null &&
                row.staff.locationSharingExpiresAt > now &&
                (row.staff.locationSharingStoppedAt == null || row.staff.locationSharingStoppedAt < row.recordedAt),
            )
            .map((row) => {
            const recordedMs = row.recordedAt.getTime()
            const secondsAgo = Math.max(0, Math.round((nowMs - recordedMs) / 1000))
            return {
                staffId: row.staffId,
                name: row.staff?.name ?? `Staff #${row.staffId}`,
                role: row.staff?.role ?? 'STAFF',
                latitude: row.latitude,
                longitude: row.longitude,
                accuracyM: row.accuracyM,
                speed: row.speed,
                heading: row.heading,
                visitId: row.visitId,
                recordedAt: row.recordedAt.toISOString(),
                secondsAgo,
                presence: classifyPresence(
                    recordedMs,
                    nowMs,
                    DEFAULT_ONLINE_WITHIN_SEC,
                    DEFAULT_AWAY_WITHIN_SEC,
                ),
            }
            })

        // Online first, then most-recently-seen.
        const order: Record<AgentPresence, number> = { online: 0, away: 1, offline: 2 }
        data.sort((a, b) => order[a.presence] - order[b.presence] || a.secondsAgo - b.secondsAgo)

        return { success: true, data }
    } catch (error) {
        console.error('Error loading live agent locations:', error)
        return { success: false, error: 'Failed to load live locations' }
    }
}

// ─── 3. Single-agent trail ──────────────────────────────────────────────────────

/**
 * Return one agent's recent movement trail (oldest → newest) for drawing a
 * path on the map. ADMIN/MANAGER may read any agent; a STAFF user may read
 * only their own trail.
 */
export async function getAgentLocationTrail(
    input: unknown,
): Promise<{ success: boolean; data?: TrailPoint[]; error?: string }> {
    let session
    try {
        session = await requireAuth()
    } catch {
        return { success: false, error: 'Unauthorized' }
    }

    const parsed = locationTrailSchema.safeParse(input)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { staffId, sinceMinutes, limit } = parsed.data
    const role = session.user.role
    const isManager = role === 'ADMIN' || role === 'MANAGER'
    if (!isManager && session.user.staffId !== staffId) {
        return { success: false, error: 'Forbidden' }
    }

    const cutoff = new Date(Date.now() - (sinceMinutes ?? 120) * 60_000)

    try {
        const rows = await prisma.agentLocation.findMany({
            where: { staffId, recordedAt: { gte: cutoff } },
            orderBy: { recordedAt: 'asc' },
            take: limit ?? 500,
            select: { latitude: true, longitude: true, recordedAt: true },
        })

        return {
            success: true,
            data: rows.map((r) => ({
                latitude: r.latitude,
                longitude: r.longitude,
                recordedAt: r.recordedAt.toISOString(),
            })),
        }
    } catch (error) {
        console.error('Error loading agent trail:', error)
        return { success: false, error: 'Failed to load agent trail' }
    }
}
