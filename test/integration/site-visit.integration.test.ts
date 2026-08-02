/**
 * Integration tests for site-visit OTP dispatch (`app/actions/field-visits.ts`),
 * run against the real Postgres database with a MOCKED OTP transport.
 *
 * Covers task 17.7:
 *   - WhatsApp leg succeeds → result.data.channel === 'whatsapp'
 *   - WhatsApp throws, SMS succeeds → result.data.channel === 'sms'
 *   - only a protected OTP state is persisted, while verifyCheckinOtp with
 *     the buyer's dispatched code succeeds (Req 12.2, 12.3).
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

import { sendCheckinOtp, verifyCheckinOtp } from '@/app/actions/field-visits'
import { Cleanup, disconnect, makeStaff, prisma, uid } from './harness'
import { resetTestSession, setTestStaffId } from './_session'

let cleanup: Cleanup
beforeEach(() => {
    resetTestSession()
    cleanup = new Cleanup()
})
afterEach(async () => {
    await cleanup.run()
    resetTestSession()
})
afterAll(async () => {
    await disconnect()
})

const BUYER_PHONE = '+971512345678'

/** Create a FieldVisit row with the required columns. */
async function makeFieldVisit() {
    const staff = await makeStaff(cleanup)
    setTestStaffId(staff.id)
    const visit = await prisma.fieldVisit.create({
        data: {
            displayId: uid('FV'),
            staffId: staff.id,
            customer: 'Test Buyer',
            address: '123 Test Street, Dubai',
            date: new Date(),
            time: '10:00 AM',
            status: 'Scheduled',
            type: 'Site Visit',
            photoUrls: [],
        },
    })
    cleanup.add(() => prisma.fieldVisit.delete({ where: { id: visit.id } }))
    return visit
}

describe('Site-visit OTP dispatch — DB integration (task 17.7)', () => {
    // 17.7 WhatsApp leg succeeds → channel 'whatsapp', OTP persisted + verifiable.
    it('sends over WhatsApp and persists a verifiable OTP', async () => {
        const visit = await makeFieldVisit()

        let sentOtp: string | undefined
        const res = await sendCheckinOtp(
            { visitId: visit.id, buyerPhone: BUYER_PHONE },
            {
                sendWhatsApp: async (_phone, otp) => {
                    sentOtp = otp
                },
                sendSms: async () => {
                    throw new Error('SMS should not be used when WhatsApp succeeds')
                },
            },
        )

        expect(res.success).toBe(true)
        if (res.success) expect(res.data.channel).toBe('whatsapp')

        // The plaintext OTP is never persisted on the visit.
        const persisted = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(persisted?.otpCode).toBeTruthy()
        expect(persisted?.otpCode).not.toBe(sentOtp)
        expect(persisted?.otpCode).toMatch(/^v1:/)
        expect(persisted?.otpVerified).toBe(false)

        // Verifying with the dispatched code succeeds.
        const verify = await verifyCheckinOtp({ visitId: visit.id, enteredOtp: sentOtp! })
        expect(verify.success).toBe(true)
        if (verify.success) expect(verify.data.otpVerified).toBe(true)
    })

    // 17.7 WhatsApp fails → SMS fallback → channel 'sms'.
    it('falls back to SMS when WhatsApp throws', async () => {
        const visit = await makeFieldVisit()

        let smsOtp: string | undefined
        const res = await sendCheckinOtp(
            { visitId: visit.id, buyerPhone: BUYER_PHONE },
            {
                sendWhatsApp: async () => {
                    throw new Error('WhatsApp transport down')
                },
                sendSms: async (_phone, otp) => {
                    smsOtp = otp
                },
            },
        )

        expect(res.success).toBe(true)
        if (res.success) expect(res.data.channel).toBe('sms')

        const persisted = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(persisted?.otpCode).not.toBe(smsOtp)
        expect(persisted?.otpCode).toMatch(/^v1:/)

        const verify = await verifyCheckinOtp({ visitId: visit.id, enteredOtp: smsOtp! })
        expect(verify.success).toBe(true)
    })

    // A wrong code is rejected and the visit stays unverified (Req 12.3).
    it('verifyCheckinOtp rejects an incorrect code', async () => {
        const visit = await makeFieldVisit()
        let sentOtp = ''
        await sendCheckinOtp(
            { visitId: visit.id, buyerPhone: BUYER_PHONE },
            { sendWhatsApp: async (_phone, otp) => { sentOtp = otp } },
        )

        const wrongCode = sentOtp === '000000' ? '111111' : '000000'
        const wrong = await verifyCheckinOtp({ visitId: visit.id, enteredOtp: wrongCode })
        const persisted = await prisma.fieldVisit.findUnique({ where: { id: visit.id } })
        expect(wrong.success).toBe(false)
        expect(persisted?.otpVerified).toBe(false)
    })
})
