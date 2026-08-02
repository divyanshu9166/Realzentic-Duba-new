'use server'

import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
    setCpSessionCookie,
    clearCpSessionCookie,
    getCpSession,
    type CpSessionPayload,
} from '@/lib/cp-session'
import { checkRateLimit, peekRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { uploadFile } from '@/lib/r2'
import { autoAssignLeadForNewLead } from './lead-routing'
import { dispatchAutomatedEmailCampaign } from './email-campaigns'
import { resolveProjectIdForText } from '@/lib/project-resolution'

/**
 * Channel Partner Portal authentication server actions (Module 4 / Req 7, 21).
 *
 * Surface:
 *   - `loginChannelPartner(email, password)` — authenticate a partner with
 *     email + password, independent of the internal dashboard auth, granting
 *     access only to partners whose status is Active (Req 7.1). Failed attempts
 *     are rate-limited to 5 per 15 minutes per account, tripping a 15-minute
 *     block (Req 7.2). On success a signed `cp_session` cookie is issued.
 *   - `logoutChannelPartner()` — clear the portal session cookie.
 *   - `getChannelPartnerSessionInfo()` — read-only view of the current session
 *     for the portal UI.
 *
 * The signed-cookie transport and the `requireChannelPartnerAuth` page guard
 * live in `lib/cp-session.ts`; the failure lockout uses the shared in-memory
 * limiter in `lib/rate-limit.ts`.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string }

/** Round milliseconds up to whole minutes for partner-facing lockout messages. */
function minutesFromMs(ms: number): number {
    return Math.max(1, Math.ceil(ms / 60_000))
}

/**
 * Generic credential error. Deliberately identical for "no such email",
 * "wrong password", and "no password set" so the portal does not reveal which
 * emails are registered (account enumeration defence).
 */
const INVALID_CREDENTIALS = 'Invalid email or password'

/**
 * Authenticate a channel partner and, on success, establish a session.
 *
 * Steps:
 *   1. Validate the input shape and normalize the email.
 *   2. Refuse while the account is in its failure-lockout window (Req 7.2) —
 *      checked with a non-consuming peek so the gate itself never counts as an
 *      attempt.
 *   3. Look up the partner by email and verify the bcrypt password hash. A
 *      missing partner, missing hash, or mismatch is a failed attempt: it
 *      consumes one unit of the 5-per-15-minute budget and returns a generic
 *      error (Req 7.2).
 *   4. Grant access only when the partner's status is Active (Req 7.1).
 *   5. Issue the signed `cp_session` cookie scoped to the partner (Req 7.3).
 */
export async function loginChannelPartner(
    email: unknown,
    password: unknown
): Promise<Result<{ partnerId: number }>> {
    if (typeof email !== 'string' || email.trim() === '') {
        return { success: false, error: 'An email is required' }
    }
    if (typeof password !== 'string' || password === '') {
        return { success: false, error: 'A password is required' }
    }

    const normalizedEmail = email.trim().toLowerCase()
    const lockKey = `cp-login:${normalizedEmail}`

    // 2. Lockout gate (Req 7.2) — peek does not consume the failure budget.
    const peek = peekRateLimit(lockKey, RATE_LIMITS.cpLogin)
    if (peek.blocked) {
        const retryMin = minutesFromMs(peek.reset - Date.now())
        return {
            success: false,
            error: `Too many failed attempts. Try again in ${retryMin} minute(s).`,
        }
    }

    // Record a failed attempt against the 5/15-min budget and surface the
    // generic error (or the block message once the 5th failure trips it).
    const recordFailure = (): Result<{ partnerId: number }> => {
        const rl = checkRateLimit(lockKey, RATE_LIMITS.cpLogin)
        if (!rl.success) {
            const retryMin = minutesFromMs(rl.reset - Date.now())
            return {
                success: false,
                error: `Too many failed attempts. Try again in ${retryMin} minute(s).`,
            }
        }
        return { success: false, error: INVALID_CREDENTIALS }
    }

    // 3. Resolve the partner and verify the password.
    const partner = await prisma.channelPartner.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, passwordHash: true, status: true },
    })

    if (!partner || !partner.passwordHash) {
        return recordFailure()
    }

    const passwordOk = await bcrypt.compare(password, partner.passwordHash)
    if (!passwordOk) {
        return recordFailure()
    }

    // 4. Active-only access (Req 7.1). Credentials are valid here, so this is
    //    not a failed-credential attempt; it is a distinct authorization denial
    //    and does not consume the failure budget.
    if (partner.status !== 'Active') {
        return {
            success: false,
            error: 'This channel partner account is not active. Please contact the admin.',
        }
    }

    // 5. Success — issue the signed session cookie scoped to this partner.
    await setCpSessionCookie(partner.id, partner.email)

    return { success: true, data: { partnerId: partner.id } }
}

/** Log the partner out: clear the portal session cookie. */
export async function logoutChannelPartner(): Promise<Result<{ loggedOut: true }>> {
    await clearCpSessionCookie()
    return { success: true, data: { loggedOut: true } }
}

/**
 * Read-only summary of the current channel-partner session for the portal UI.
 * Returns `null` when there is no valid, unexpired session.
 */
export async function getChannelPartnerSessionInfo(): Promise<
    Result<{ partnerId: number; email: string } | null>
> {
    const session = await getCpSession()
    if (!session) return { success: true, data: null }
    return { success: true, data: { partnerId: session.partnerId, email: session.email } }
}

// ===========================================================================
// Channel Portal data actions — scoped to the authenticated partner
// Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 21.2
// ===========================================================================
//
// Every action below resolves the acting partner from the signed `cp_session`
// cookie via `getCpSession()` and scopes ALL queries to that signed
// `partnerId`. The partner id is NEVER taken from a caller-supplied argument,
// so a partner can only ever read or write their own data (Req 7.3, 7.4, 21.2).
// An unauthenticated request is denied with an authorization error.

/** Generic message for a request that carries no valid portal session. */
const NOT_AUTHENTICATED = 'You must be signed in to the channel portal'

/**
 * Resolve the current partner session or fail with an authorization error.
 * Returns a `Result` so callers can early-return without throwing, keeping the
 * partner-scoping decision in one place (Req 7.4, 21.2).
 */
async function requireCpSession(): Promise<Result<CpSessionPayload>> {
    const session = await getCpSession()
    if (!session) return { success: false, error: NOT_AUTHENTICATED }
    return { success: true, data: session }
}

/** Coerce a Prisma `Decimal` (or number/null) to a client-safe plain number. */
function decimalToNumber(value: unknown): number {
    if (value === null || value === undefined) return 0
    return typeof value === 'number' ? value : Number(value)
}

// ─── Req 7.5 — cpBrowseInventory (live Available units) ─────────────────────

/** A single Available unit as shown in the channel-portal inventory browser. */
export interface CpInventoryUnit {
    id: number
    unitNumber: string
    floorNumber: number
    type: string
    facing: string
    netArea: number
    builtUpArea: number
    totalPrice: number
    projectName: string
    towerName: string
    city: string
}

/**
 * List the Available units sourced live from inventory for the portal browser
 * (Req 7.5). Only units whose status is currently `Available` are returned, so
 * a partner never sees blocked, booked, or sold stock. The data is read live on
 * every call; IF the inventory store is unavailable the action returns an error
 * state (rather than stale data) so the portal can surface an error instead of
 * a misleading empty/old list (Req 7.5).
 *
 * Inventory is shared across the platform, so it is not partner-scoped — but
 * the call still requires a valid partner session, so unauthenticated requests
 * are denied (Req 21.2).
 */
export async function cpBrowseInventory(): Promise<Result<CpInventoryUnit[]>> {
    const auth = await requireCpSession()
    if (!auth.success) return auth

    try {
        const units = await prisma.unit.findMany({
            where: { status: 'Available' },
            orderBy: [{ floorNumber: 'asc' }, { unitNumber: 'asc' }],
            select: {
                id: true,
                unitNumber: true,
                floorNumber: true,
                type: true,
                facing: true,
                netArea: true,
                builtUpArea: true,
                totalPrice: true,
                tower: {
                    select: {
                        name: true,
                        project: { select: { name: true, city: true } },
                    },
                },
            },
        })

        const inventory: CpInventoryUnit[] = units.map((unit) => ({
            id: unit.id,
            unitNumber: unit.unitNumber,
            floorNumber: unit.floorNumber,
            type: unit.type,
            facing: unit.facing,
            netArea: unit.netArea,
            builtUpArea: unit.builtUpArea,
            totalPrice: decimalToNumber(unit.totalPrice),
            projectName: unit.tower.project.name,
            towerName: unit.tower.name,
            city: unit.tower.project.city,
        }))

        return { success: true, data: inventory }
    } catch {
        // Inventory_Service unavailable — surface an error state, never stale data.
        return { success: false, error: 'Inventory is currently unavailable. Please try again.' }
    }
}

// ─── Req 7.6 — cpSubmitLead (required-field validation) ─────────────────────

/**
 * Required fields for a partner-submitted lead (Req 7.6): client name, phone,
 * interested property, and budget. Each must be a non-empty string; a missing
 * or blank field is rejected with a field-naming validation error before any
 * write.
 */
const cpSubmitLeadSchema = z.object({
    clientName: z
        .string({ message: 'Client name is required' })
        .trim()
        .min(1, 'Client name is required')
        .max(200, 'Client name must not exceed 200 characters'),
    phone: z
        .string({ message: 'Phone is required' })
        .trim()
        .min(1, 'Phone is required')
        .max(20, 'Phone must not exceed 20 characters'),
    interestedProperty: z
        .string({ message: 'Interested property is required' })
        .trim()
        .min(1, 'Interested property is required')
        .max(200, 'Interested property must not exceed 200 characters'),
    budget: z
        .string({ message: 'Budget is required' })
        .trim()
        .min(1, 'Budget is required')
        .max(100, 'Budget must not exceed 100 characters'),
})

/**
 * Submit a lead from the channel portal (Req 7.6). The four required fields are
 * validated first; IF any is missing the submission is rejected with a
 * validation error and nothing is written.
 *
 * On valid input a `CPLead` is created and attributed to the session partner —
 * the `partnerId` comes from the signed session, never from the caller (Req
 * 7.3, 21.2). A backing `Lead` (and its `Contact`, found-or-created by phone to
 * match the rest of the app) is created in the same transaction so the lead
 * surfaces in the internal CRM, attributed to this partner. Returns the new
 * CPLead id as the confirmation.
 */
export async function cpSubmitLead(
    data: unknown
): Promise<Result<{ cpLeadId: number; leadId: number }>> {
    const auth = await requireCpSession()
    if (!auth.success) return auth
    const { partnerId } = auth.data

    const parsed = cpSubmitLeadSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const { clientName, phone, interestedProperty, budget } = parsed.data

    try {
        const projectId = await resolveProjectIdForText(prisma, [interestedProperty])
        const result = await prisma.$transaction(async (tx) => {
            // Reuse an existing Contact for this phone, else create one — keeps a
            // single customer identity per number, matching the rest of the app.
            let contact = await tx.contact.findFirst({ where: { phone } })
            if (!contact) {
                contact = await tx.contact.create({
                    data: { name: clientName, phone, source: 'Channel Partner' },
                })
            }

            const lead = await tx.lead.create({
                data: {
                    contactId: contact.id,
                    projectId,
                    interest: interestedProperty,
                    budget,
                    source: 'Channel Partner',
                },
            })

            const cpLead = await tx.cPLead.create({
                data: {
                    partnerId,
                    leadId: lead.id,
                    status: 'Submitted',
                },
                select: { id: true },
            })

            return { cpLeadId: cpLead.id, leadId: lead.id, contactId: contact.id }
        })

        await autoAssignLeadForNewLead(result.leadId, { source: 'Channel Partner' })
        await dispatchAutomatedEmailCampaign('new_lead', result.contactId)

        return { success: true, data: result }
    } catch {
        return { success: false, error: 'Failed to submit lead. Please try again.' }
    }
}

// ─── Req 7.3 / 7.4 / 7.7 — cpCommissionStatements (own data only) ───────────

/** A commission row as shown in the partner's own commission statements. */
export interface CpCommissionRow {
    id: number
    amount: number
    percentage: number
    status: string
    paymentDate: string | null
    utr: string | null
    dealId: number | null
    bookingId: number | null
}

/**
 * List the calling partner's commissions with their status (Req 7.7). The query
 * is scoped to the signed-session `partnerId`, so a partner only ever sees their
 * own commissions and can never read another partner's data (Req 7.3, 7.4,
 * 21.2). Money fields are coerced to plain numbers for client use.
 */
export async function cpCommissionStatements(): Promise<Result<CpCommissionRow[]>> {
    const auth = await requireCpSession()
    if (!auth.success) return auth
    const { partnerId } = auth.data

    try {
        const commissions = await prisma.cPCommission.findMany({
            where: { partnerId },
            orderBy: { id: 'desc' },
            select: {
                id: true,
                amount: true,
                percentage: true,
                status: true,
                paymentDate: true,
                utr: true,
                dealId: true,
                bookingId: true,
            },
        })

        const rows: CpCommissionRow[] = commissions.map((c) => ({
            id: c.id,
            amount: decimalToNumber(c.amount),
            percentage: decimalToNumber(c.percentage),
            status: c.status,
            paymentDate: c.paymentDate ? c.paymentDate.toISOString() : null,
            utr: c.utr,
            dealId: c.dealId,
            bookingId: c.bookingId,
        }))

        return { success: true, data: rows }
    } catch {
        return { success: false, error: 'Failed to load commission statements. Please try again.' }
    }
}

/**
 * Generate a downloadable commission-statement PDF for the calling partner
 * (Req 7.7). The statement covers only the session partner's commissions —
 * scoped to the signed `partnerId`, never a caller-supplied id (Req 7.3, 7.4,
 * 21.2). The PDF is rendered server-side with `jspdf` and stored via the shared
 * upload path, mirroring the document/cost-sheet PDF flow; IF generation or
 * storage fails the action returns an error (Req 7.7).
 */
export async function cpCommissionStatementPdf(): Promise<Result<{ pdfUrl: string }>> {
    const auth = await requireCpSession()
    if (!auth.success) return auth
    const { partnerId } = auth.data

    try {
        const partner = await prisma.channelPartner.findUnique({
            where: { id: partnerId },
            select: { id: true, name: true, company: true, brnNumber: true },
        })
        if (!partner) return { success: false, error: 'Channel partner not found' }

        const commissions = await prisma.cPCommission.findMany({
            where: { partnerId },
            orderBy: { id: 'desc' },
            select: { id: true, amount: true, percentage: true, status: true, paymentDate: true },
        })

        const { jsPDF } = await import('jspdf')
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        const marginX = 15
        let cursorY = 20

        doc.setFontSize(16)
        doc.text('Commission Statement', marginX, cursorY)
        cursorY += 10

        doc.setFontSize(11)
        doc.text(`Partner: ${partner.name}`, marginX, cursorY)
        cursorY += 6
        if (partner.company) {
            doc.text(`Company: ${partner.company}`, marginX, cursorY)
            cursorY += 6
        }
        doc.text(`RERA Broker No: ${partner.brnNumber}`, marginX, cursorY)
        cursorY += 6
        doc.text(`Generated: ${new Date().toLocaleString('en-AE')}`, marginX, cursorY)
        cursorY += 10

        doc.setFontSize(10)
        doc.text('ID', marginX, cursorY)
        doc.text('Amount', marginX + 25, cursorY)
        doc.text('Percent', marginX + 70, cursorY)
        doc.text('Status', marginX + 105, cursorY)
        doc.text('Payment Date', marginX + 140, cursorY)
        cursorY += 6

        const pageHeight = doc.internal.pageSize.getHeight()
        let totalAmount = 0
        for (const c of commissions) {
            if (cursorY > pageHeight - 20) {
                doc.addPage()
                cursorY = 20
            }
            const amount = decimalToNumber(c.amount)
            totalAmount += amount
            doc.text(String(c.id), marginX, cursorY)
            doc.text(amount.toFixed(2), marginX + 25, cursorY)
            doc.text(`${decimalToNumber(c.percentage).toFixed(2)}%`, marginX + 70, cursorY)
            doc.text(c.status, marginX + 105, cursorY)
            doc.text(
                c.paymentDate ? c.paymentDate.toLocaleDateString('en-AE') : '-',
                marginX + 140,
                cursorY
            )
            cursorY += 6
        }

        cursorY += 4
        if (cursorY > pageHeight - 20) {
            doc.addPage()
            cursorY = 20
        }
        doc.setFontSize(11)
        doc.text(`Total: ${totalAmount.toFixed(2)}`, marginX, cursorY)

        const pdfBuffer = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
        const fileName = `commission-statement-${partnerId}-${Date.now()}.pdf`
        const pdfUrl = await uploadFile(
            pdfBuffer,
            fileName,
            'application/pdf',
            'channel-portal/statements'
        )

        return { success: true, data: { pdfUrl } }
    } catch {
        return { success: false, error: 'Failed to generate commission statement PDF' }
    }
}
