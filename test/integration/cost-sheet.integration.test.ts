/**
 * Integration tests for the Cost Sheet service (`app/actions/properties.ts`),
 * run against the real Postgres database.
 *
 * Covers the DB-backed cost-sheet tasks:
 *   - 5.5  Persistence round-trip (a CostSheet row is created with the correct
 *          netPayable) and at-most-one-default-per-project enforcement for
 *          payment plans (Req 3.2, 3.11).
 *   - 5.3  generateCostSheetPdf success path sets pdfUrl (uploadFile writes to
 *          local disk); a non-existent id returns { success: false } and never
 *          throws (Req 3.9).
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

import {
    buildCostSheet,
    generateCostSheetPdf,
    upsertPaymentPlan,
} from '@/app/actions/properties'
import {
    Cleanup,
    disconnect,
    makeContact,
    makeProject,
    makeTower,
    makeUnit,
    prisma,
    uid,
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

describe('Cost Sheet service — DB integration', () => {
    // ── 5.5 Persistence round-trip: netPayable is computed and stored ─────────
    // Requirements: 3.2
    it('buildCostSheet persists a CostSheet row with the correct netPayable', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { totalPrice: 5_000_000 })
        const contact = await makeContact(cleanup)
        cleanup.add(() => prisma.costSheet.deleteMany({ where: { unitId: unit.id } }))

        // Zero out the auto-computed charges so netPayable is deterministic:
        // netPayable = total + Σ(add-ons) − discount = 5,000,000.
        const res = await buildCostSheet(unit.id, contact.id, { dldTransferFee: 0, vatAmount: 0 }, 0)
        expect(res.success).toBe(true)
        if (!res.success) throw new Error(res.error)

        const sheet = res.data as { id: number; netPayable: number; total: number }
        expect(sheet.netPayable).toBe(5_000_000)

        // Round-trip: the row exists in the DB with the same netPayable.
        const row = await prisma.costSheet.findUnique({ where: { id: sheet.id } })
        expect(row).not.toBeNull()
        expect(Number(row!.netPayable)).toBe(5_000_000)
        expect(row!.unitId).toBe(unit.id)
        expect(row!.contactId).toBe(contact.id)
    })

    // ── 5.5 upsertPaymentPlan: at most one default per project ────────────────
    // Requirements: 3.11
    it('upsertPaymentPlan unsets the previous default when a 2nd default is created', async () => {
        const project = await makeProject(cleanup)
        cleanup.add(() => prisma.paymentPlan.deleteMany({ where: { projectId: project.id } }))

        const fullPlan = (name: string, isDefault: boolean) => ({
            name,
            isDefault,
            milestones: [{ name: 'On booking', dueOffsetDays: 0, percentage: 100 }],
        })

        const first = await upsertPaymentPlan(project.id, fullPlan(uid('Plan-A'), true))
        expect(first.success).toBe(true)
        if (!first.success) throw new Error(first.error)
        const planA = first.data as { id: number }

        const second = await upsertPaymentPlan(project.id, fullPlan(uid('Plan-B'), true))
        expect(second.success).toBe(true)
        if (!second.success) throw new Error(second.error)
        const planB = second.data as { id: number }

        // Exactly one default remains, and it is the second plan.
        const defaults = await prisma.paymentPlan.findMany({
            where: { projectId: project.id, isDefault: true },
        })
        expect(defaults).toHaveLength(1)
        expect(defaults[0].id).toBe(planB.id)

        const reloadedA = await prisma.paymentPlan.findUnique({ where: { id: planA.id } })
        expect(reloadedA?.isDefault).toBe(false)
    })

    it('upsertPaymentPlan rejects milestones that do not sum to 100', async () => {
        const project = await makeProject(cleanup)
        cleanup.add(() => prisma.paymentPlan.deleteMany({ where: { projectId: project.id } }))

        const res = await upsertPaymentPlan(project.id, {
            name: uid('Bad-Plan'),
            isDefault: false,
            milestones: [
                { name: 'A', dueOffsetDays: 0, percentage: 40 },
                { name: 'B', dueOffsetDays: 30, percentage: 40 },
            ],
        })
        expect(res.success).toBe(false)
    })

    // ── 5.3 generateCostSheetPdf: success sets pdfUrl; bad id never throws ────
    // Requirements: 3.9
    it('generateCostSheetPdf sets pdfUrl on success', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { totalPrice: 5_000_000 })
        const contact = await makeContact(cleanup)
        cleanup.add(() => prisma.costSheet.deleteMany({ where: { unitId: unit.id } }))

        const built = await buildCostSheet(unit.id, contact.id, { dldTransferFee: 0, vatAmount: 0 }, 0)
        expect(built.success).toBe(true)
        if (!built.success) throw new Error(built.error)
        const sheetId = (built.data as { id: number }).id

        const res = await generateCostSheetPdf(sheetId)
        expect(res.success).toBe(true)
        if (res.success) {
            expect(typeof res.data.pdfUrl).toBe('string')
            expect(res.data.pdfUrl.length).toBeGreaterThan(0)
        }

        // The URL is persisted back onto the record.
        const row = await prisma.costSheet.findUnique({ where: { id: sheetId } })
        expect(row?.pdfUrl).toBeTruthy()
    })

    it('generateCostSheetPdf with a non-existent id returns { success: false } and never throws', async () => {
        let res: Awaited<ReturnType<typeof generateCostSheetPdf>> | undefined
        await expect(
            (async () => {
                res = await generateCostSheetPdf(2_000_000_000)
            })(),
        ).resolves.toBeUndefined()
        expect(res?.success).toBe(false)
    })
})
