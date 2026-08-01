/**
 * Integration tests for Document Management & KYC (`app/actions/documents.ts`),
 * run against the real Postgres database.
 *
 * Covers task 12.7:
 *   - createKycRecord persists a KYCRecord (round-trip).
 *   - upsertDocumentTemplate persists a DocumentTemplate; generateFromTemplate
 *     rejects an unresolved merge field and succeeds when all are provided.
 *   - uploadDocument persists a Document row (when a global File is available).
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
    createKycRecord,
    generateFromTemplate,
    uploadDocument,
    upsertDocumentTemplate,
} from '@/app/actions/documents'
import { Cleanup, disconnect, makeContact, prisma, uid } from './harness'

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

describe('Document & KYC persistence — DB integration (task 12.7)', () => {
    // createKycRecord round-trip (Req 8.4)
    it('createKycRecord persists a KYCRecord linked to the contact', async () => {
        const contact = await makeContact(cleanup)

        const res = await createKycRecord(contact.id, {
            documentType: 'Emirates ID',
            documentNumber: `784-${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(100 + Math.random() * 899)}`,
            verified: true,
        })

        expect(res.success).toBe(true)
        const kyc = (res as { data: { id: number } }).data
        cleanup.add(() => prisma.kYCRecord.deleteMany({ where: { id: kyc.id } }))

        const persisted = await prisma.kYCRecord.findUnique({ where: { id: kyc.id } })
        expect(persisted).toBeTruthy()
        expect(persisted?.contactId).toBe(contact.id)
        expect(persisted?.documentType).toBe('Emirates ID')
        expect(persisted?.verified).toBe(true)
    })

    it('createKycRecord rejects a non-existent contact', async () => {
        const res = await createKycRecord(2_000_000_000, {
            documentType: 'Emirates ID',
            documentNumber: '784-0000-0000000-000',
        })
        expect(res.success).toBe(false)
    })

    // upsertDocumentTemplate + generateFromTemplate merge-field gate (Req 8.5, 8.6)
    it('upsertDocumentTemplate persists; generateFromTemplate enforces merge fields', async () => {
        const res = await upsertDocumentTemplate({
            name: `Welcome Letter ${uid()}`,
            type: 'Letter',
            category: 'Onboarding',
            htmlBody: '<p>Dear {{buyerName}}, welcome to {{projectName}}.</p>',
        })
        expect(res.success).toBe(true)
        const template = (res as { data: { id: number } }).data
        cleanup.add(() => prisma.documentTemplate.deleteMany({ where: { id: template.id } }))

        const persisted = await prisma.documentTemplate.findUnique({ where: { id: template.id } })
        expect(persisted).toBeTruthy()
        expect(persisted?.category).toBe('Onboarding')

        // Missing merge field → rejected.
        const missing = await generateFromTemplate(template.id, { buyerName: 'Asha' })
        expect(missing.success).toBe(false)

        // All merge fields supplied → succeeds and writes a PDF.
        const ok = await generateFromTemplate(template.id, {
            buyerName: 'Asha',
            projectName: 'Skyline Heights',
        })
        expect(ok.success).toBe(true)
        if (ok.success) expect(ok.data.pdfUrl).toMatch(/\.pdf$/)
    })

    // uploadDocument persists a Document row (Req 8.1).
    it('uploadDocument persists a Document row', async () => {
        // Node 20+ exposes a global File; skip gracefully if unavailable.
        if (typeof File === 'undefined') {
            console.warn('Global File is unavailable; skipping uploadDocument assertion')
            return
        }

        const contact = await makeContact(cleanup)
        const file = new File([Buffer.from('x')], 'a.pdf', { type: 'application/pdf' })

        const res = await uploadDocument('Contact', contact.id, 'KYC', file)
        expect(res.success).toBe(true)
        const doc = (res as { data: { id: number } }).data
        cleanup.add(() => prisma.document.deleteMany({ where: { id: doc.id } }))

        const persisted = await prisma.document.findUnique({ where: { id: doc.id } })
        expect(persisted).toBeTruthy()
        expect(persisted?.entityType).toBe('Contact')
        expect(persisted?.entityId).toBe(contact.id)
        expect(persisted?.type).toBe('KYC')
        expect(persisted?.fileName).toBe('a.pdf')
    })
})
