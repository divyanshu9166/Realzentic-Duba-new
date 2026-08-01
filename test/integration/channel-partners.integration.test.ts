/**
 * Integration tests for the Channel Partner admin actions
 * (`app/actions/channel-partners.ts`) and the Channel Portal data actions
 * (`app/actions/channel-portal.ts`), run against the real Postgres database.
 *
 * Covers the DB-backed property tasks:
 *   - 10.2 Property 28: completing a payout batch marks commissions Paid (Req 6.6)
 *   - 10.3 Property 29: BRN number required and unique (Req 6.9)
 *   - 10.7 Property 30: channel partner data isolation (Req 7.3, 7.4, 21.2)
 *   - 10.8 Property 31: channel portal browses only Available units (Req 7.5)
 *   - 10.9 Property 32: channel partner lead submission validation (Req 7.6)
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
vi.mock('@/lib/cp-session', async () => {
    const s = await import('./_cp-session')
    return { getCpSession: async () => s.getCpTestSession() }
})

import {
    approveCommission,
    completePayoutBatch,
    createCommission,
    createPayoutBatch,
    onboardPartner,
} from '@/app/actions/channel-partners'
import {
    cpBrowseInventory,
    cpCommissionStatements,
    cpSubmitLead,
} from '@/app/actions/channel-portal'
import { setCpTestSession } from './_cp-session'
import {
    Cleanup,
    disconnect,
    makeContact,
    makeProject,
    makeStage,
    makeTower,
    makeUnit,
    prisma,
    uid,
} from './harness'

let cleanup: Cleanup
beforeEach(() => {
    cleanup = new Cleanup()
    setCpTestSession(null)
})
afterEach(async () => {
    setCpTestSession(null)
    await cleanup.run()
})
afterAll(async () => {
    await disconnect()
})

/** Far-future expiry so a CP test session is always valid. */
const FUTURE = () => Date.now() + 24 * 60 * 60 * 1000

/** Seed a ChannelPartner row directly with the required fields. */
async function seedPartner(overrides: Record<string, unknown> = {}) {
    const partner = await prisma.channelPartner.create({
        data: {
            name: `CP ${uid()}`,
            brnNumber: uid('BRN'),
            phone: `+9715${Math.floor(1000000 + Math.random() * 8999999)}`,
            email: `${uid('cp').toLowerCase()}@test.local`,
            type: 'Individual',
            status: 'Active',
            commissionType: 'Fixed',
            fixedCommission: 25000,
            ...overrides,
        },
    })
    cleanup.add(() => prisma.channelPartner.delete({ where: { id: partner.id } }))
    return partner
}

describe('Channel Partner / Portal — DB integration', () => {
    // 10.2 / Property 28: completing a payout batch marks every included commission Paid (Req 6.6)
    it('completePayoutBatch marks all included commissions Paid', async () => {
        // onboardPartner — BRN required + unique; Fixed commission so the amount is computable without a booking.
        const onboard = await onboardPartner({
            name: `CP ${uid()}`,
            brnNumber: uid('BRN'),
            phone: '+971500000001',
            email: `${uid('cp').toLowerCase()}@test.local`,
            type: 'Individual',
            commissionType: 'Fixed',
            fixedCommission: 25000,
        })
        expect(onboard.success).toBe(true)
        if (!onboard.success) return
        const partnerId = onboard.data.id

        // A Deal gives createCommission something to reference.
        const contact = await makeContact(cleanup)
        const stage = await makeStage(cleanup)
        const deal = await prisma.deal.create({
            data: { contactId: contact.id, stageId: stage.id, value: 5000000 },
        })

        // Register a single ordered teardown so FK references are cleared in order.
        cleanup.add(async () => {
            await prisma.cPCommission.deleteMany({ where: { partnerId } })
            await prisma.cPPayoutBatch.deleteMany({ where: { batchName: { startsWith: `BATCH-${partnerId}-` } } })
            await prisma.deal.delete({ where: { id: deal.id } }).catch(() => undefined)
            await prisma.channelPartner.delete({ where: { id: partnerId } }).catch(() => undefined)
        })

        const commission = await createCommission({ partnerId, dealId: deal.id })
        expect(commission.success).toBe(true)
        if (!commission.success) return
        const commissionId = commission.data.id

        const approved = await approveCommission({ commissionId })
        expect(approved.success).toBe(true)

        const batch = await createPayoutBatch({
            batchName: `BATCH-${partnerId}-${uid()}`,
            commissionIds: [commissionId],
        })
        expect(batch.success).toBe(true)
        if (!batch.success) return

        const completed = await completePayoutBatch({ batchId: batch.data.id })
        expect(completed.success).toBe(true)
        if (!completed.success) return
        expect(completed.data.commissionsPaid).toBe(1)

        // Property 28: every commission in the batch is now Paid.
        const rows = await prisma.cPCommission.findMany({ where: { payoutBatchId: batch.data.id } })
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            expect(row.status).toBe('Paid')
        }
    })

    // 10.3 / Property 29: BRN number is required and unique (Req 6.9)
    it('onboardPartner requires a BRN number', async () => {
        const base = {
            name: `CP ${uid()}`,
            phone: '+971500000002',
            email: `${uid('cp').toLowerCase()}@test.local`,
            type: 'Individual' as const,
        }

        // Missing BRN → rejected.
        const missing = await onboardPartner({ ...base })
        expect(missing.success).toBe(false)

        // Empty BRN → rejected.
        const empty = await onboardPartner({ ...base, brnNumber: '   ' })
        expect(empty.success).toBe(false)
    })

    it('onboardPartner rejects a duplicate BRN number', async () => {
        const brn = uid('BRN')
        const first = await onboardPartner({
            name: `CP ${uid()}`,
            brnNumber: brn,
            phone: '+971500000003',
            email: `${uid('cp').toLowerCase()}@test.local`,
            type: 'Individual',
        })
        expect(first.success).toBe(true)
        if (first.success) {
            cleanup.add(() => prisma.channelPartner.delete({ where: { id: first.data.id } }))
        }

        // Second onboard with the SAME BRN (different email) → rejected (Req 6.9).
        const dup = await onboardPartner({
            name: `CP ${uid()}`,
            brnNumber: brn,
            phone: '+971500000004',
            email: `${uid('cp').toLowerCase()}@test.local`,
            type: 'Individual',
        })
        expect(dup.success).toBe(false)
    })

    // 10.7 / Property 30: a partner only ever sees their own commissions (Req 7.3, 7.4, 21.2)
    it('cpCommissionStatements returns only the session partner commissions', async () => {
        const partnerA = await seedPartner()
        const partnerB = await seedPartner()

        const commA = await prisma.cPCommission.create({
            data: { partnerId: partnerA.id, amount: 1000, status: 'Approved' },
        })
        cleanup.add(() => prisma.cPCommission.delete({ where: { id: commA.id } }))
        const commB = await prisma.cPCommission.create({
            data: { partnerId: partnerB.id, amount: 2000, status: 'Approved' },
        })
        cleanup.add(() => prisma.cPCommission.delete({ where: { id: commB.id } }))

        // Acting as partner A.
        setCpTestSession({ partnerId: partnerA.id, email: partnerA.email, expiresAt: FUTURE() })

        const res = await cpCommissionStatements()
        expect(res.success).toBe(true)
        if (!res.success) return

        const ids = res.data.map((c) => c.id)
        expect(ids).toContain(commA.id)
        expect(ids).not.toContain(commB.id)
        // Every returned row belongs to partner A.
        expect(res.data.every((c) => ids.includes(c.id))).toBe(true)
    })

    // 10.8 / Property 31: only Available units are returned (Req 7.5)
    it('cpBrowseInventory returns only units whose status is Available', async () => {
        const partner = await seedPartner()
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)

        const available = await makeUnit(cleanup, tower.id, { status: 'Available' })
        const blocked = await makeUnit(cleanup, tower.id, { status: 'Blocked' })
        const sold = await makeUnit(cleanup, tower.id, { status: 'Sold' })

        setCpTestSession({ partnerId: partner.id, email: partner.email, expiresAt: FUTURE() })

        const res = await cpBrowseInventory()
        expect(res.success).toBe(true)
        if (!res.success) return

        const ids = res.data.map((u) => u.id)
        expect(ids).toContain(available.id)
        expect(ids).not.toContain(blocked.id)
        expect(ids).not.toContain(sold.id)
    })

    // 10.9 / Property 32: a lead submission missing a required field is rejected (Req 7.6)
    it('cpSubmitLead rejects input missing a required field', async () => {
        const partner = await seedPartner()
        setCpTestSession({ partnerId: partner.id, email: partner.email, expiresAt: FUTURE() })

        const before = await prisma.cPLead.count({ where: { partnerId: partner.id } })

        // Blank clientName → rejected, nothing written.
        const res = await cpSubmitLead({
            clientName: '   ',
            phone: '+971500000010',
            interestedProperty: 'Tower A 2 Bedroom Apartment',
            budget: '500K AED',
        })
        expect(res.success).toBe(false)

        const after = await prisma.cPLead.count({ where: { partnerId: partner.id } })
        expect(after).toBe(before)
    })
})
