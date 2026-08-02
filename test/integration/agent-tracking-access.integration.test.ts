import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-helpers', async () => {
    const s = await import('./_session')
    return {
        getSession: async () => s.getTestSession(),
        requireAuth: async () => {
            const session = s.getTestSession()
            if (!session) throw new Error('Unauthorized')
            return session
        },
        requireRole: async (...roles: string[]) => {
            const session = s.getTestSession()
            if (!session) throw new Error('Unauthorized')
            if (!roles.includes(session.user.role)) throw new Error('Forbidden')
            return session
        },
    }
})

import {
    getAgentLocationTrail,
    getLiveAgentLocations,
    recordAgentLocation,
    stopAgentLocationSharing,
} from '@/app/actions/agent-tracking'
import { getFieldVisits } from '@/app/actions/field-visits'
import { dubaiAttendanceDate } from '@/lib/agent-location'
import { Cleanup, disconnect, makeProject, makeStaff, prisma, uid } from './harness'
import { resetTestSession, setTestSession } from './_session'

let cleanup: Cleanup

beforeEach(() => {
    cleanup = new Cleanup()
    resetTestSession()
})

afterEach(async () => {
    await cleanup.run()
    resetTestSession()
})

afterAll(async () => {
    await disconnect()
})

function actAs(role: 'ADMIN' | 'MANAGER' | 'STAFF', staffId: number | null) {
    setTestSession({
        user: {
            id: uid('USER'),
            email: `${uid('tracking').toLowerCase()}@test.local`,
            name: `${role} Tracking Tester`,
            role,
            staffId,
        },
    })
}

async function clockIn(staffId: number) {
    const attendance = await prisma.attendance.create({
        data: {
            staffId,
            date: dubaiAttendanceDate(),
            clockIn: '09:00',
            status: 'Present',
            method: 'gps',
        },
    })
    cleanup.add(() => prisma.attendance.delete({ where: { id: attendance.id } }))
}

describe('Live agent tracking role boundaries', () => {
    it('records only the signed-in active agent and only their assigned visit', async () => {
        const [staff, otherStaff, project] = await Promise.all([
            makeStaff(cleanup),
            makeStaff(cleanup),
            makeProject(cleanup, { latitude: 25.0808, longitude: 55.1403 }),
        ])
        await clockIn(staff.id)
        const visit = await prisma.fieldVisit.create({
            data: {
                displayId: uid('FV'), staffId: staff.id, customer: 'Tracking Buyer', address: 'Dubai Marina',
                date: new Date(), time: '10:00 AM', status: 'Scheduled', type: 'Property Viewing',
                projectId: project.id, buyerPhone: '+971501234580', unitIds: [], photoUrls: [],
            },
        })
        const otherVisit = await prisma.fieldVisit.create({
            data: {
                displayId: uid('FV'), staffId: otherStaff.id, customer: 'Other Buyer', address: 'Dubai Hills',
                date: new Date(), time: '11:00 AM', status: 'Scheduled', type: 'Property Viewing',
                projectId: project.id, buyerPhone: '+971501234581', unitIds: [], photoUrls: [],
            },
        })
        cleanup.add(() => prisma.fieldVisit.delete({ where: { id: visit.id } }))
        cleanup.add(() => prisma.fieldVisit.delete({ where: { id: otherVisit.id } }))

        actAs('STAFF', staff.id)
        const forgedTag = await recordAgentLocation({ latitude: 25.0808, longitude: 55.1403, visitId: otherVisit.id })
        expect(forgedTag).toMatchObject({ success: false, code: 'VISIT_NOT_ASSIGNED' })

        const recorded = await recordAgentLocation({ latitude: 25.0808, longitude: 55.1403, accuracyM: 8, visitId: visit.id })
        expect(recorded.success).toBe(true)
        expect(recorded.visitCheckin).toMatchObject({ visitId: visit.id })
        const checkedInVisit = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(checkedInVisit).toMatchObject({ status: 'In Progress', geoCheckinTime: expect.any(Date) })
        const ping = await prisma.agentLocation.findFirst({ where: { staffId: staff.id }, orderBy: { recordedAt: 'desc' } })
        expect(ping).toMatchObject({ staffId: staff.id, visitId: visit.id, accuracyM: 8 })
        if (ping) cleanup.add(() => prisma.agentLocation.delete({ where: { id: ping.id } }))

        const staffRoster = await getLiveAgentLocations()
        expect(staffRoster).toEqual({ success: false, error: 'Forbidden' })

        actAs('MANAGER', null)
        const managerRoster = await getLiveAgentLocations()
        expect(managerRoster.success).toBe(true)
        expect(managerRoster.data?.some((item) => item.staffId === staff.id && item.visitId === visit.id)).toBe(true)
        const managerVisits = await getFieldVisits()
        expect(managerVisits.success).toBe(true)
        expect(managerVisits.data?.find((item) => item.id === visit.id)).toMatchObject({
            geoCheckinTime: expect.any(String),
            liveLinked: true,
        })

        actAs('STAFF', staff.id)
        const ownTrail = await getAgentLocationTrail({ staffId: staff.id })
        expect(ownTrail.success).toBe(true)
        const otherTrail = await getAgentLocationTrail({ staffId: otherStaff.id })
        expect(otherTrail).toEqual({ success: false, error: 'Forbidden' })

        const stopped = await stopAgentLocationSharing()
        expect(stopped.success).toBe(true)
        actAs('MANAGER', null)
        const stoppedRoster = await getLiveAgentLocations()
        expect(stoppedRoster.data?.some((item) => item.staffId === staff.id)).toBe(false)
    })

    it('rejects inactive staff even when an attendance row exists', async () => {
        const staff = await makeStaff(cleanup, { status: 'Inactive' })
        await clockIn(staff.id)
        actAs('STAFF', staff.id)
        const result = await recordAgentLocation({ latitude: 25.2048, longitude: 55.2708 })
        expect(result).toEqual({ success: false, error: 'Your staff profile is inactive' })
    })

    it('auto-links a sole active visit when the agent has no visit selector', async () => {
        const [staff, project] = await Promise.all([
            makeStaff(cleanup),
            makeProject(cleanup, { latitude: 25.0808, longitude: 55.1403 }),
        ])
        await clockIn(staff.id)
        const visit = await prisma.fieldVisit.create({
            data: {
                displayId: uid('FV'), staffId: staff.id, customer: 'Auto-link Buyer', address: 'Dubai Marina',
                date: new Date(), time: '10:00 AM', status: 'Scheduled', type: 'Property Viewing',
                projectId: project.id, buyerPhone: '+971501234582', unitIds: [], photoUrls: [],
            },
        })
        cleanup.add(() => prisma.fieldVisit.delete({ where: { id: visit.id } }))

        actAs('STAFF', staff.id)
        const recorded = await recordAgentLocation({ latitude: 25.0808, longitude: 55.1403, accuracyM: 8 })
        expect(recorded).toMatchObject({ success: true, visitCheckin: { visitId: visit.id } })
        const savedVisit = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(savedVisit).toMatchObject({ status: 'In Progress', geoCheckinTime: expect.any(Date) })
        const ping = await prisma.agentLocation.findFirst({ where: { staffId: staff.id }, orderBy: { recordedAt: 'desc' } })
        expect(ping).toMatchObject({ staffId: staff.id, visitId: visit.id })
    })
})
