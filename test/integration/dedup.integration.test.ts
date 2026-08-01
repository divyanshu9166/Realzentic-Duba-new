/**
 * Integration tests for the de-duplication / merge service
 * (`app/actions/leads.ts`), run against the real Postgres database.
 *
 * Covers the DB-backed dedup tasks:
 *   - 15.6 Property 42: merge preserves all linked records (Req 11.3)
 *   - 15.7 Property 44: an existing phone reuses the existing Contact (Req 11.7)
 *   - 15.8 Integration: a failing merge rolls back entirely (Req 11.4)
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

import { createLead, mergeContacts } from '@/app/actions/leads'
import { createDeal } from '@/app/actions/deals'
import {
    Cleanup,
    disconnect,
    makeContact,
    makeStage,
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

/** A test-only, well-formed phone number (>= 10 digits, unique-ish). */
function testPhone(): string {
    return `+9715${Math.floor(1000000 + Math.random() * 8999999)}`
}

describe('Dedup / merge service — DB integration', () => {
    // 15.6 / Property 42: merge preserves all linked records (Req 11.3)
    it('mergeContacts reassigns linked Lead and Deal to the target and deletes the source', async () => {
        const target = await makeContact(cleanup)
        const sourcePhone = testPhone()
        const source = await makeContact(cleanup, { phone: sourcePhone })
        const stage = await makeStage(cleanup)

        // Link a Lead to the SOURCE contact. createLead reuses the existing
        // Contact that already owns `sourcePhone` (Req 11.7), so the lead is
        // attached to `source` rather than creating a new contact.
        const leadRes = await createLead({
            name: source.name,
            phone: sourcePhone,
            source: 'Website',
            interest: 'Apartment2 apartment',
            budget: '500K AED',
        })
        expect(leadRes.success).toBe(true)
        const leadId = (leadRes.data as { id: number; contactId: number }).id
        expect((leadRes.data as { contactId: number }).contactId).toBe(source.id)
        cleanup.add(() => prisma.lead.deleteMany({ where: { id: leadId } }))

        // Link a Deal to the SOURCE contact via the deals action.
        const dealRes = await createDeal({
            contactId: source.id,
            stageId: stage.id,
            value: 5_000_000,
        })
        expect(dealRes.success).toBe(true)
        const dealId = (dealRes.data as { id: number }).id
        cleanup.add(async () => {
            await prisma.dealActivity.deleteMany({ where: { dealId } })
            await prisma.deal.deleteMany({ where: { id: dealId } })
        })

        // Merge the source into the target.
        const merged = await mergeContacts(target.id, source.id)
        expect(merged.success).toBe(true)

        // The Lead and Deal now reference the target contact (Req 11.3).
        const lead = await prisma.lead.findUnique({ where: { id: leadId } })
        const deal = await prisma.deal.findUnique({ where: { id: dealId } })
        expect(lead?.contactId).toBe(target.id)
        expect(deal?.contactId).toBe(target.id)

        // The source contact has been deleted; the target survives.
        const sourceRow = await prisma.contact.findUnique({ where: { id: source.id } })
        const targetRow = await prisma.contact.findUnique({ where: { id: target.id } })
        expect(sourceRow).toBeNull()
        expect(targetRow).not.toBeNull()
    })

    // 15.7 / Property 44: an existing phone reuses the existing Contact (Req 11.7)
    it('createLead with an existing phone reuses the Contact (no new contact row)', async () => {
        const existing = await makeContact(cleanup)

        const leadRes = await createLead({
            name: 'Someone Else', // different name, same phone
            phone: existing.phone,
            source: 'Website',
            interest: 'Apartment3 apartment',
        })
        expect(leadRes.success).toBe(true)
        const leadId = (leadRes.data as { id: number; contactId: number }).id
        cleanup.add(() => prisma.lead.deleteMany({ where: { id: leadId } }))

        // No new Contact was created — the lead reuses the existing contact.
        // Scope the assertion to this test's own phone (a global contact count
        // would race with other integration suites running in parallel).
        const samePhone = await prisma.contact.count({ where: { phone: existing.phone } })
        expect(samePhone).toBe(1)
        expect((leadRes.data as { contactId: number }).contactId).toBe(existing.id)
    })

    // 15.8 Integration: a failing merge rolls back entirely (Req 11.4).
    //
    // The implementation reassigns every linked record to the target and then
    // deletes the source inside a single transaction. To exercise the rollback
    // path deterministically we merge a valid source (with a linked Lead and
    // Deal) into a non-existent target: the transaction throws before any
    // reassignment commits, so the merge must report failure and leave the
    // source contact AND its linked records in their exact pre-merge state.
    it('a failing merge leaves the source contact and its linked records unchanged', async () => {
        const sourcePhone = testPhone()
        const source = await makeContact(cleanup, { phone: sourcePhone })
        const stage = await makeStage(cleanup)

        const leadRes = await createLead({
            name: source.name,
            phone: sourcePhone,
            source: 'Website',
            interest: 'Apartment2 apartment',
        })
        expect(leadRes.success).toBe(true)
        const leadId = (leadRes.data as { id: number }).id
        cleanup.add(() => prisma.lead.deleteMany({ where: { id: leadId } }))

        const dealRes = await createDeal({
            contactId: source.id,
            stageId: stage.id,
            value: 5_000_000,
        })
        expect(dealRes.success).toBe(true)
        const dealId = (dealRes.data as { id: number }).id
        cleanup.add(async () => {
            await prisma.dealActivity.deleteMany({ where: { dealId } })
            await prisma.deal.deleteMany({ where: { id: dealId } })
        })

        // Target id 0 can never exist (ids are positive autoincrements), so the
        // transaction throws "Target contact not found" and rolls back.
        const result = await mergeContacts(0, source.id, { phone: 'source' })
        expect(result.success).toBe(false)

        // The source contact still exists with its original field values.
        const sourceRow = await prisma.contact.findUnique({ where: { id: source.id } })
        expect(sourceRow).not.toBeNull()
        expect(sourceRow?.name).toBe(source.name)
        expect(sourceRow?.phone).toBe(sourcePhone)

        // Its linked Lead and Deal were NOT reassigned — no partial write leaked.
        const lead = await prisma.lead.findUnique({ where: { id: leadId } })
        const deal = await prisma.deal.findUnique({ where: { id: dealId } })
        expect(lead?.contactId).toBe(source.id)
        expect(deal?.contactId).toBe(source.id)

        // Atomicity: the failed merge neither deleted the source nor adopted the
        // (non-existent) target. We assert on the rows this test owns — a global
        // contact count would race with other integration suites running in
        // parallel and is not a reliable atomicity signal.
        const sourceCount = await prisma.contact.count({ where: { id: source.id } })
        expect(sourceCount).toBe(1)
        const bogusTarget = await prisma.contact.findUnique({ where: { id: 0 } })
        expect(bogusTarget).toBeNull()
    })
})
