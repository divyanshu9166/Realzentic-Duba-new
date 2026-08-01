/**
 * Integration test for the AI Matching service (`app/actions/ai-matching.ts`),
 * run against the real Postgres database.
 *
 * Covers:
 *   - 22.6 notifyMatchingAgents(unitId): when new inventory is added, agents of
 *     open buyers whose derived preferences match the unit are notified
 *     (Req 16.3).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => { }, revalidateTag: () => { } }))
vi.mock('@/lib/auth-helpers', async () => {
    const s = await import('./_session')
    return {
        getSession: async () => s.getTestSession(),
        requireAuth: async () => {
            const sess = s.getTestSession()
            if (!sess) throw new Error('Unauthorized')
            return sess
        },
        requireRole: async (...roles: string[]) => {
            const sess = s.getTestSession()
            if (!sess) throw new Error('Unauthorized')
            if (!roles.includes(sess.user.role)) throw new Error('Forbidden')
            return sess
        },
    }
})

import { notifyMatchingAgents } from '@/app/actions/ai-matching'
import {
    Cleanup,
    disconnect,
    makeContact,
    makeProject,
    makeStaff,
    makeTower,
    makeUnit,
    prisma,
} from './harness'

let cleanup: Cleanup
beforeEach(() => {
    cleanup = new Cleanup()
})
afterEach(async () => {
    await cleanup.run()
})
afterAll(async () => {
    await disconnect()
})

describe('AI matching — DB integration (22.6)', () => {
    it('notifyMatchingAgents notifies the agent of a matching open buyer for new inventory', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        // Available 2 Bedroom Apartment priced within the buyer's budget.
        const unit = await makeUnit(cleanup, tower.id, {
            status: 'Available',
            type: 'Apartment2',
            totalPrice: 7500000,
        })

        const agent = await makeStaff(cleanup)
        const contact = await makeContact(cleanup)

        // Open lead assigned to the agent, with budget + interest that derive
        // preferences matching the unit (2 Bedroom Apartment, max budget covers 75L).
        const lead = await prisma.lead.create({
            data: {
                contactId: contact.id,
                interest: '2 Bedroom Apartment',
                budget: '7M-9M AED',
                status: 'NEW',
                assignedToId: agent.id,
            },
        })
        cleanup.add(() => prisma.lead.delete({ where: { id: lead.id } }))

        const res = await notifyMatchingAgents(unit.id)

        // Clean up any notifications produced for this unit.
        cleanup.add(() =>
            prisma.notification.deleteMany({
                where: { metadata: { path: ['unitId'], equals: unit.id } },
            }),
        )

        expect(res.success).toBe(true)
        if (!res.success) return
        expect(res.data.matchedBuyerCount).toBeGreaterThanOrEqual(1)
        expect(res.data.notifiedAgentCount).toBeGreaterThanOrEqual(1)

        // A property_match notification was created for the agent.
        const notifications = await prisma.notification.findMany({
            where: { type: 'property_match', metadata: { path: ['unitId'], equals: unit.id } },
        })
        expect(notifications.length).toBeGreaterThanOrEqual(1)
        expect(notifications[0].metadata).toMatchObject({ unitId: unit.id, agentId: agent.id })
    })
})
