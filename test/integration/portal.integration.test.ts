/**
 * Integration test for the Portal Integration service
 * (`app/actions/portal-integration.ts`), run against the real Postgres database.
 *
 * Covers:
 *   - 20.6 Portal webhook end-to-end ingestion: a valid payload for an enabled
 *     portal creates a Contact + Lead (with source attribution and auto-assign)
 *     and a PortalLead, and notifies the assignee (Req 15.2, 15.3, 15.5).
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

import { ingestPortalLead } from '@/app/actions/portal-integration'
import { Cleanup, disconnect, makeStaff, prisma, uid } from './harness'

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

describe('Portal integration — DB integration (20.6)', () => {
    it('ingests a valid Bayut webhook end-to-end: Contact + Lead + PortalLead + assignee notification', async () => {
        const staff = await makeStaff(cleanup)

        const config = await prisma.portalConfig.create({
            data: {
                portalName: 'Bayut',
                enabled: true,
                autoAssignStaffId: staff.id,
            },
        })
        cleanup.add(() => prisma.portalConfig.delete({ where: { id: config.id } }))

        // Unique phone/email so dedup never matches a pre-existing contact.
        const payload = {
            portalLeadId: uid('PL'),
            name: `Portal Buyer ${uid()}`,
            phone: `+9715${Math.floor(10000000 + Math.random() * 89999999)}`,
            email: `${uid('portbuyer').toLowerCase()}@test.local`,
        }

        const res = await ingestPortalLead('Bayut', payload)

        expect(res.success).toBe(true)
        if (!res.success) return
        expect(res.data.status).toBe('created')
        if (res.data.status !== 'created') return

        const { contactId, leadId, portalLeadDbId, assignedToId } = res.data

        // Register cleanup for everything ingestion created (reverse-dependency order).
        cleanup.add(() => prisma.notification.deleteMany({ where: { metadata: { path: ['leadId'], equals: leadId } } }))
        cleanup.add(() => prisma.portalLead.deleteMany({ where: { id: portalLeadDbId } }))
        cleanup.add(() => prisma.lead.deleteMany({ where: { id: leadId } }))
        cleanup.add(() => prisma.contact.deleteMany({ where: { id: contactId } }))

        // A Contact was created with the portal source attribution.
        const contact = await prisma.contact.findUnique({ where: { id: contactId } })
        expect(contact).not.toBeNull()
        expect(contact?.name).toBe(payload.name)
        expect(contact?.source).toBe('Bayut')

        // A Lead was created: source attribution recorded, auto-assigned to staff.
        const lead = await prisma.lead.findUnique({ where: { id: leadId } })
        expect(lead).not.toBeNull()
        expect(lead?.source).toBe('Bayut')
        expect(lead?.assignedToId).toBe(staff.id)
        expect(assignedToId).toBe(staff.id)

        // The PortalLead was persisted and linked to the new Lead.
        const portalLead = await prisma.portalLead.findUnique({ where: { id: portalLeadDbId } })
        expect(portalLead).not.toBeNull()
        expect(portalLead?.leadId).toBe(leadId)
        expect(portalLead?.deduplicated).toBe(false)

        // A notification was created for the assignee.
        const notifications = await prisma.notification.findMany({
            where: { type: 'portal_lead', metadata: { path: ['leadId'], equals: leadId } },
        })
        expect(notifications.length).toBeGreaterThanOrEqual(1)
        expect(notifications[0].metadata).toMatchObject({ leadId, assignedToId: staff.id })
    })
})
