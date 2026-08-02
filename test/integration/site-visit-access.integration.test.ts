import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => { }, revalidateTag: () => { } }))
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
    createFieldVisit,
    getFieldVisits,
    geoCheckin,
    rescheduleFieldVisit,
    submitVisitFeedback,
} from '@/app/actions/field-visits'
import { Cleanup, disconnect, makeContact, makeProject, makeStaff, makeStage, prisma, uid } from './harness'
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
            email: `${uid('user').toLowerCase()}@test.local`,
            name: `${role} Tester`,
            role,
            staffId,
        },
    })
}

async function makeVisit(input: {
    staffId: number
    projectId: number
    buyerPhone?: string
    status?: string
    scheduledDate?: Date
    geoCheckinTime?: Date | null
}) {
    const scheduledDate = input.scheduledDate ?? new Date(Date.now() + 48 * 60 * 60_000)
    const visit = await prisma.fieldVisit.create({
        data: {
            displayId: uid('FV'),
            staffId: input.staffId,
            customer: 'Verified Buyer',
            address: 'Dubai Marina, Dubai',
            date: scheduledDate,
            time: '10:00 AM',
            scheduledDate,
            scheduledTime: '10:00 AM',
            status: input.status ?? 'Scheduled',
            type: 'Property Viewing',
            projectId: input.projectId,
            buyerPhone: input.buyerPhone ?? '+971501234567',
            geoCheckinTime: input.geoCheckinTime ?? null,
            photoUrls: [],
            unitIds: [],
        },
    })
    cleanup.add(() => prisma.fieldVisit.delete({ where: { id: visit.id } }))
    return visit
}

describe('Site Visit role boundaries and manager workflow', () => {
    it('scopes staff reads and reserves execution for the assigned agent', async () => {
        const [staffA, staffB, project] = await Promise.all([
            makeStaff(cleanup),
            makeStaff(cleanup),
            makeProject(cleanup, { latitude: 25.0808, longitude: 55.1403 }),
        ])
        const visitA = await makeVisit({ staffId: staffA.id, projectId: project.id })
        const visitB = await makeVisit({ staffId: staffB.id, projectId: project.id, scheduledDate: new Date(Date.now() + 72 * 60 * 60_000) })

        actAs('STAFF', staffA.id)
        const staffList = await getFieldVisits()
        expect(staffList.success).toBe(true)
        expect(staffList.data?.map((visit) => visit.id)).toEqual([visitA.id])

        actAs('MANAGER', staffA.id)
        const managerList = await getFieldVisits()
        expect(managerList.success).toBe(true)
        expect(managerList.data?.map((visit) => visit.id)).toEqual(expect.arrayContaining([visitA.id, visitB.id]))

        const impersonation = await geoCheckin({
            visitId: visitB.id,
            agentLat: 25.0808,
            agentLng: 55.1403,
            accuracyM: 20,
        })
        expect(impersonation).toEqual({ success: false, error: 'Forbidden' })

        actAs('STAFF', staffB.id)
        const assigned = await geoCheckin({
            visitId: visitB.id,
            agentLat: 25.0808,
            agentLng: 55.1403,
            accuracyM: 20,
        })
        expect(assigned.success).toBe(true)
    })

    it('lets managers reschedule/reassign while preventing double-booking and staff edits', async () => {
        const [staffA, staffB, project] = await Promise.all([
            makeStaff(cleanup),
            makeStaff(cleanup),
            makeProject(cleanup, { latitude: 25.0808, longitude: 55.1403 }),
        ])
        const scheduledAt = new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString()
        const payload = {
            staffId: staffA.id,
            customer: 'Schedule Buyer',
            address: 'Dubai Marina, Dubai',
            scheduledAt,
            type: 'Property Viewing',
            buyerPhone: '+971501234568',
            projectId: project.id,
            unitIds: [],
            notes: 'Bring project brochure',
        }

        actAs('MANAGER', staffA.id)
        const created = await createFieldVisit(payload)
        expect(created.success).toBe(true)
        if (!created.success || !created.data) throw new Error('Visit setup failed')
        cleanup.add(() => prisma.fieldVisit.delete({ where: { id: created.data!.id } }))

        const conflict = await createFieldVisit({ ...payload, buyerPhone: '+971501234569' })
        expect(conflict.success).toBe(false)
        expect(conflict.error).toContain('within 60 minutes')

        const movedAt = new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString()
        const moved = await rescheduleFieldVisit({ ...payload, visitId: created.data.id, staffId: staffB.id, scheduledAt: movedAt })
        expect(moved.success).toBe(true)
        const persisted = await prisma.fieldVisit.findUnique({ where: { id: created.data.id } })
        expect(persisted).toMatchObject({ staffId: staffB.id, geoCheckinTime: null })
        expect(persisted?.scheduledDate?.toISOString()).toBe(movedAt)

        actAs('STAFF', staffB.id)
        const staffEdit = await rescheduleFieldVisit({ ...payload, visitId: created.data.id, staffId: staffB.id, scheduledAt: movedAt })
        expect(staffEdit).toEqual({ success: false, error: 'Forbidden' })
    })

    it('only creates a deal for the buyer verified on the visit', async () => {
        const [staff, project, stage, buyer, unrelated] = await Promise.all([
            makeStaff(cleanup),
            makeProject(cleanup, { latitude: 25.0808, longitude: 55.1403 }),
            makeStage(cleanup),
            makeContact(cleanup, { phone: '+971501234570' }),
            makeContact(cleanup, { phone: '+971501234571' }),
        ])
        const visit = await makeVisit({
            staffId: staff.id,
            projectId: project.id,
            buyerPhone: buyer.phone,
            status: 'In Progress',
            geoCheckinTime: new Date(),
        })
        actAs('STAFF', staff.id)

        const base = {
            visitId: visit.id,
            followUpAction: 'Deal',
            stageId: stage.id,
            dealValue: 2_000_000,
            assignedAgentId: staff.id,
        }
        const forged = await submitVisitFeedback({ ...base, contactId: unrelated.id })
        expect(forged).toEqual({ success: false, error: 'The deal contact must match the buyer verified for this visit' })

        const valid = await submitVisitFeedback({ ...base, contactId: buyer.id })
        expect(valid.success).toBe(true)
        const dealId = valid.success ? valid.data?.dealId : null
        if (dealId) {
            cleanup.add(() => prisma.deal.delete({ where: { id: dealId } }))
        }
        const completed = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(completed?.status).toBe('Completed')
    })
})
