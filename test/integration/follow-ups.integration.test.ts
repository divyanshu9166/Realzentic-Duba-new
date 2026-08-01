/**
 * Integration tests for the Follow-up section (`app/actions/follow-ups.ts`),
 * run against the real Postgres database.
 *
 * Covers: manual create, lead → follow-up conversion (with lead status bump),
 * the duplicate-open guard, status transitions, and listing with due buckets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => { }, revalidateTag: () => { } }))

import {
    createFollowUp,
    convertLeadToFollowUp,
    updateFollowUp,
    updateFollowUpStatus,
    deleteFollowUp,
    getFollowUps,
} from '@/app/actions/follow-ups'
import { Cleanup, disconnect, makeContact, prisma, uid } from './harness'

const cleanup = new Cleanup()
afterEach(async () => {
    await cleanup.run()
})
afterEach(() => vi.clearAllMocks())

function tomorrowISO(): string {
    return new Date(Date.now() + 86_400_000).toISOString().split('T')[0]
}

describe('createFollowUp', () => {
    it('creates a pending follow-up and find-or-creates the contact', async () => {
        const phone = `+9715${Math.floor(1000000 + Math.random() * 8999999)}`
        const res = await createFollowUp({
            name: `FU Buyer ${uid()}`,
            phone,
            interest: '2 Bedroom Apartment in Dubai Marina',
            followUpDate: tomorrowISO(),
            reason: 'Buying after 2 months',
            priority: 'High',
        })
        expect(res.success).toBe(true)
        const id = (res as { data: { id: number; contactId: number } }).data.id
        const contactId = (res as { data: { contactId: number } }).data.contactId
        cleanup.add(() => prisma.followUpEntry.deleteMany({ where: { id } }))
        cleanup.add(() => prisma.contact.deleteMany({ where: { id: contactId } }))

        const row = await prisma.followUpEntry.findUnique({ where: { id } })
        expect(row?.status).toBe('PENDING')
        expect(row?.priority).toBe('High')
        expect(row?.interest).toBe('2 Bedroom Apartment in Dubai Marina')
    })
})

describe('convertLeadToFollowUp', () => {
    it('converts a lead, links it, bumps a NEW lead to CONTACTED, and dedupes', async () => {
        const contact = await makeContact(cleanup)
        const lead = await prisma.lead.create({
            data: { contactId: contact.id, interest: '3 Bedroom Apartment', status: 'NEW', source: 'WhatsApp', budget: '500K-750K AED' },
        })
        cleanup.add(() => prisma.lead.deleteMany({ where: { id: lead.id } }))

        const res = await convertLeadToFollowUp({
            leadId: lead.id,
            followUpDate: tomorrowISO(),
            reason: 'Call after Diwali',
            priority: 'Medium',
        })
        expect(res.success).toBe(true)

        // Follow-up created, linked to the lead + contact, copying interest.
        const fu = await prisma.followUpEntry.findFirst({ where: { leadId: lead.id } })
        expect(fu).toBeTruthy()
        expect(fu?.contactId).toBe(contact.id)
        expect(fu?.interest).toBe('3 Bedroom Apartment')
        expect(fu?.status).toBe('PENDING')

        // NEW lead is bumped to CONTACTED.
        const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } })
        expect(updatedLead?.status).toBe('CONTACTED')

        // Dedupe: a second conversion for the same contact is rejected.
        const dup = await convertLeadToFollowUp({ leadId: lead.id, followUpDate: tomorrowISO() })
        expect(dup.success).toBe(false)
    })

    it('rejects an unknown lead', async () => {
        const res = await convertLeadToFollowUp({ leadId: 999_000_111, followUpDate: tomorrowISO() })
        expect(res.success).toBe(false)
    })
})

describe('status transitions + listing', () => {
    it('reschedule re-arms a REMINDED follow-up to PENDING', async () => {
        const contact = await makeContact(cleanup)
        const fu = await prisma.followUpEntry.create({
            data: {
                contactId: contact.id,
                interest: 'Plot',
                followUpDate: new Date(),
                status: 'REMINDED',
                priority: 'Medium',
            },
        })
        cleanup.add(() => prisma.followUpEntry.deleteMany({ where: { id: fu.id } }))

        const res = await updateFollowUp({ id: fu.id, followUpDate: tomorrowISO() })
        expect(res.success).toBe(true)
        const row = await prisma.followUpEntry.findUnique({ where: { id: fu.id } })
        expect(row?.status).toBe('PENDING')
    })

    it('updates status and stamps lastContactedAt on CONVERTED', async () => {
        const contact = await makeContact(cleanup)
        const fu = await prisma.followUpEntry.create({
            data: { contactId: contact.id, interest: 'Villa', followUpDate: new Date(), status: 'PENDING', priority: 'Low' },
        })
        cleanup.add(() => prisma.followUpEntry.deleteMany({ where: { id: fu.id } }))

        const res = await updateFollowUpStatus({ id: fu.id, status: 'CONVERTED' })
        expect(res.success).toBe(true)
        const row = await prisma.followUpEntry.findUnique({ where: { id: fu.id } })
        expect(row?.status).toBe('CONVERTED')
        expect(row?.lastContactedAt).toBeTruthy()
    })

    it('lists follow-ups with a due bucket and removes on delete', async () => {
        const contact = await makeContact(cleanup)
        const fu = await prisma.followUpEntry.create({
            data: { contactId: contact.id, interest: 'Office', followUpDate: new Date(), status: 'PENDING', priority: 'Medium' },
        })
        cleanup.add(() => prisma.followUpEntry.deleteMany({ where: { id: fu.id } }))

        const list = await getFollowUps()
        expect(list.success).toBe(true)
        const found = (list as { data: Array<{ id: number; dueBucket: string }> }).data.find((f) => f.id === fu.id)
        expect(found).toBeTruthy()
        expect(['overdue', 'today', 'upcoming']).toContain(found!.dueBucket)

        const del = await deleteFollowUp(fu.id)
        expect(del.success).toBe(true)
        expect(await prisma.followUpEntry.findUnique({ where: { id: fu.id } })).toBeNull()
    })
})

afterEach(async () => {
    // keep the pg pool from holding the process open across files
})

import { afterAll } from 'vitest'
afterAll(async () => {
    await disconnect()
})
