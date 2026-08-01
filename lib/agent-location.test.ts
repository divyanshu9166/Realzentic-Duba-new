import { describe, expect, it } from 'vitest'
import {
    AGENT_LOCATION_RETENTION_DAYS,
    MIN_AGENT_LOCATION_PING_INTERVAL_MS,
    agentLocationRetentionCutoff,
    dubaiAttendanceDate,
    shouldRecordAgentLocation,
} from './agent-location'

describe('agent location policy', () => {
    it('retains history for exactly seven days', () => {
        const now = new Date('2026-08-01T12:00:00.000Z')
        expect(AGENT_LOCATION_RETENTION_DAYS).toBe(7)
        expect(agentLocationRetentionCutoff(now).toISOString()).toBe('2026-07-25T12:00:00.000Z')
    })

    it('enforces the server-side write interval at the boundary', () => {
        const now = new Date('2026-08-01T12:00:00.000Z')
        expect(shouldRecordAgentLocation(null, now)).toBe(true)
        expect(shouldRecordAgentLocation(new Date(now.getTime() - MIN_AGENT_LOCATION_PING_INTERVAL_MS + 1), now)).toBe(false)
        expect(shouldRecordAgentLocation(new Date(now.getTime() - MIN_AGENT_LOCATION_PING_INTERVAL_MS), now)).toBe(true)
    })

    it("uses Dubai's calendar date for attendance checks", () => {
        expect(dubaiAttendanceDate(new Date('2026-07-31T21:30:00.000Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z')
    })
})
