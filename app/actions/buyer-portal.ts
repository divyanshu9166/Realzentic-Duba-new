'use server'

import { prisma } from '@/lib/db'
import {
    otpAccepted,
    isValidOtpFormat,
    DEFAULT_OTP_TTL_SECONDS,
    validateSupportTicket,
    type SupportTicketInput,
} from '@/lib/buyer-auth'
import {
    generateBuyerOtp,
    generateSessionToken,
    setBuyerSessionCookie,
    clearBuyerSessionCookie,
    getBuyerSession,
    isLockedOut,
    recordFailedAttempt,
    clearFailedAttempts,
    OTP_REQUEST_LIMIT,
    LOCKOUT_MS,
} from '@/lib/buyer-session'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
    normalizePhone,
    normalizePhoneForMetaUae,
    isValidE164,
} from '@/lib/whatsapp/phone-utils'

/**
 * Buyer Self-Service Portal authentication & session server actions
 * (Module 15 / Requirement 18, 21).
 *
 * Surface:
 *   - `requestBuyerOtp(phone)` — issue a 6-digit OTP to an existing buyer and
 *     deliver it over WhatsApp with SMS fallback (Req 18.2, A4). The OTP
 *     expires 300 seconds after generation; OTP requests are anti-spam rate
 *     limited and refused while the phone is locked out (Req 18.4).
 *   - `verifyBuyerOtp(phone, otp)` — verify the submitted OTP via the pure
 *     `otpAccepted` helper, reject expired/mismatched codes (Req 18.3), enforce
 *     the 5-attempt/15-minute lockout (Req 18.4), and on success issue a
 *     24-hour DB-backed session token in an httpOnly cookie (Req 18.5, 18.7).
 *   - `getBuyerSessionInfo()` — read-only view of the current session for the
 *     UI; every authenticated query elsewhere is scoped to its `contactId`
 *     (Req 18.6, 21.2).
 *   - `logoutBuyer()` — drop the session cookie and revoke the token.
 *
 * The stateful lockout, the cookie transport, and the `requireBuyerAuth`
 * server-component guard live in `lib/buyer-session.ts`; the time math lives in
 * the pure, property-tested `lib/buyer-auth.ts`.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string }

// ─── OTP delivery transport (Req 18.2, A4) ───────────
//
// WhatsApp first, SMS fallback. Transports are injectable so the dispatch flow
// can be exercised without a live Meta/SMS account; the defaults use the Meta
// Cloud API and the env-configured SMS gateway. Mirrors the proven pattern in
// `app/actions/field-visits.ts`.

export type OtpChannel = 'whatsapp' | 'sms'

export interface OtpTransports {
    sendWhatsApp?: (phoneE164: string, otp: string) => Promise<void>
    sendSms?: (phoneE164: string, otp: string) => Promise<void>
}

interface OtpDeliveryResult {
    ok: boolean
    channel?: OtpChannel
    error?: string
}

/** Default WhatsApp OTP sender — resolves the first configured account. */
async function defaultSendWhatsAppOtp(phoneE164: string, otp: string): Promise<void> {
    const config = await prisma.waWhatsappConfig.findFirst()
    if (!config) throw new Error('WhatsApp is not configured')

    const accessToken = decrypt(config.access_token)
    await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phoneE164,
        text: `Your buyer portal login code is ${otp}. It expires in 5 minutes. Do not share it with anyone.`,
    })
}

/**
 * Default SMS OTP sender. A real SMS gateway is configured via env
 * (`SMS_OTP_WEBHOOK_URL`); without it the SMS leg is unavailable and the caller
 * surfaces a delivery error rather than silently "succeeding".
 */
async function defaultSendSmsOtp(phoneE164: string, otp: string): Promise<void> {
    const endpoint = process.env.SMS_OTP_WEBHOOK_URL
    if (!endpoint) throw new Error('SMS gateway is not configured')

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(process.env.SMS_OTP_API_KEY
                ? { Authorization: `Bearer ${process.env.SMS_OTP_API_KEY}` }
                : {}),
        },
        body: JSON.stringify({
            to: phoneE164,
            message: `Your buyer portal login code is ${otp}. It expires in 5 minutes.`,
        }),
    })
    if (!res.ok) throw new Error(`SMS gateway error: ${res.status}`)
}

/** Try WhatsApp first, then SMS. Returns the channel that succeeded (Req 18.2, A4). */
async function deliverOtp(
    phoneE164: string,
    otp: string,
    transports?: OtpTransports
): Promise<OtpDeliveryResult> {
    const sendWhatsApp = transports?.sendWhatsApp ?? defaultSendWhatsAppOtp
    const sendSms = transports?.sendSms ?? defaultSendSmsOtp

    try {
        await sendWhatsApp(phoneE164, otp)
        return { ok: true, channel: 'whatsapp' }
    } catch (waErr) {
        const waMsg = waErr instanceof Error ? waErr.message : String(waErr)
        try {
            await sendSms(phoneE164, otp)
            return { ok: true, channel: 'sms' }
        } catch (smsErr) {
            const smsMsg = smsErr instanceof Error ? smsErr.message : String(smsErr)
            return { ok: false, error: `WhatsApp failed (${waMsg}); SMS failed (${smsMsg})` }
        }
    }
}

// ─── Helpers ─────────────────────────────────────────

/** Round milliseconds up to whole minutes for buyer-facing lockout messages. */
function minutesFromMs(ms: number): number {
    return Math.max(1, Math.ceil(ms / 60_000))
}

/**
 * Resolve an existing buyer Contact from a free-form phone number.
 *
 * `Contact.phone` may be stored in any human format, so we match on the last
 * ten significant digits (the national subscriber number) which is stable
 * across `+971`, `0`, and spaced variants.
 */
async function findBuyerContact(phone: string): Promise<{ id: number; phone: string } | null> {
    const last10 = normalizePhone(phone).slice(-10)
    if (last10.length < 10) return null
    const contact = await prisma.contact.findFirst({
        where: { phone: { endsWith: last10 } },
        select: { id: true, phone: true },
    })
    return contact
}

// ─── Request OTP (Req 18.2, 18.4, A4) ────────────────

/**
 * Issue and deliver a login OTP for `phone`.
 *
 * Steps:
 *   1. Refuse while the phone is locked out (Req 18.4).
 *   2. Anti-spam rate limit OTP requests per phone.
 *   3. Resolve the buyer Contact; unknown numbers are rejected.
 *   4. Generate a 6-digit OTP with a 300-second expiry, persist a fresh,
 *      unverified `BuyerSession`, and discard any earlier unverified rows for
 *      the buyer so only the latest code is live (Req 18.2).
 *   5. Deliver over WhatsApp with SMS fallback (Req 18.2, A4).
 *
 * Returns the channel the code was sent on. Never returns the OTP.
 */
export async function requestBuyerOtp(
    phone: unknown,
    transports?: OtpTransports
): Promise<Result<{ channel: OtpChannel }>> {
    if (typeof phone !== 'string' || phone.trim() === '') {
        return { success: false, error: 'A phone number is required' }
    }

    const phoneE164 = normalizePhoneForMetaUae(phone)
    if (!isValidE164(phoneE164)) {
        return { success: false, error: 'Enter a valid phone number' }
    }
    const lockKey = phoneE164
    const now = Date.now()

    // 1. Lockout (Req 18.4).
    const lock = isLockedOut(lockKey, now)
    if (lock.locked) {
        return {
            success: false,
            error: `Too many attempts. Try again in ${minutesFromMs(lock.retryAfterMs)} minute(s).`,
        }
    }

    // 2. Anti-spam: cap OTP requests per phone within the lockout window.
    const rl = checkRateLimit(`buyer-otp-request:${lockKey}`, {
        limit: OTP_REQUEST_LIMIT,
        windowMs: LOCKOUT_MS,
    })
    if (!rl.success) {
        const retryMin = minutesFromMs(rl.reset - now)
        return {
            success: false,
            error: `Too many code requests. Try again in ${retryMin} minute(s).`,
        }
    }

    // 3. Resolve the buyer.
    const contact = await findBuyerContact(phoneE164)
    if (!contact) {
        return { success: false, error: 'No buyer account found for this phone number' }
    }

    // 4. Generate + persist a fresh OTP (Req 18.2). Drop earlier unverified
    //    rows so only the most recent code can be redeemed.
    const otp = generateBuyerOtp()
    const otpExpiry = new Date(now + DEFAULT_OTP_TTL_SECONDS * 1000)

    await prisma.buyerSession.deleteMany({
        where: { contactId: contact.id, verified: false, sessionToken: null },
    })
    await prisma.buyerSession.create({
        data: {
            contactId: contact.id,
            phone: phoneE164,
            otp,
            otpExpiry,
            verified: false,
        },
    })

    // 5. Deliver (Req 18.2, A4).
    const delivery = await deliverOtp(phoneE164, otp, transports)
    if (!delivery.ok) {
        return { success: false, error: `Could not send the code. ${delivery.error ?? ''}`.trim() }
    }

    return { success: true, data: { channel: delivery.channel! } }
}

// ─── Verify OTP (Req 18.3, 18.4, 18.5, 18.7) ─────────

/**
 * Verify a submitted OTP and, on success, establish a 24-hour session.
 *
 * The OTP decision is delegated to the pure `otpAccepted` helper (matches the
 * stored code AND not expired); an expired or mismatched code is rejected
 * (Req 18.3). Each failure is recorded toward the 5-attempt/15-minute lockout
 * (Req 18.4); a successful verification clears the counter and issues an opaque
 * session token persisted on the `BuyerSession` row and set as an httpOnly
 * cookie (Req 18.5, 18.7).
 */
export async function verifyBuyerOtp(
    phone: unknown,
    otp: unknown
): Promise<Result<{ contactId: number }>> {
    if (typeof phone !== 'string' || phone.trim() === '') {
        return { success: false, error: 'A phone number is required' }
    }

    const phoneE164 = normalizePhoneForMetaUae(phone)
    if (!isValidE164(phoneE164)) {
        return { success: false, error: 'Enter a valid phone number' }
    }
    const lockKey = phoneE164
    const now = new Date()
    const nowMs = now.getTime()

    // Lockout gate (Req 18.4) — checked before consuming an attempt.
    const lock = isLockedOut(lockKey, nowMs)
    if (lock.locked) {
        return {
            success: false,
            error: `Too many attempts. Try again in ${minutesFromMs(lock.retryAfterMs)} minute(s).`,
        }
    }

    const reject = (message: string): Result<{ contactId: number }> => {
        const status = recordFailedAttempt(lockKey, nowMs)
        if (status.locked) {
            return {
                success: false,
                error: `Too many attempts. Try again in ${minutesFromMs(status.retryAfterMs)} minute(s).`,
            }
        }
        return { success: false, error: message }
    }

    if (typeof otp !== 'string' || !isValidOtpFormat(otp)) {
        return reject('Enter the 6-digit code')
    }

    // Most-recent unredeemed OTP for this phone.
    const session = await prisma.buyerSession.findFirst({
        where: { phone: phoneE164, verified: false, sessionToken: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, contactId: true, otp: true, otpExpiry: true },
    })

    if (!session) {
        return reject('No active code. Request a new one.')
    }

    // The pure helper works from the generation time + ttl; reconstruct the
    // generation instant from the stored expiry (expiry = generatedAt + ttl).
    const generatedAt = new Date(session.otpExpiry.getTime() - DEFAULT_OTP_TTL_SECONDS * 1000)
    if (!otpAccepted(session.otp, otp, generatedAt, now)) {
        return reject('That code is incorrect or has expired')
    }

    // Success — clear the lockout counter and establish the session.
    clearFailedAttempts(lockKey)

    const token = generateSessionToken()
    const updated = await prisma.buyerSession.update({
        where: { id: session.id },
        data: { verified: true, sessionToken: token, createdAt: now },
        select: { contactId: true, createdAt: true },
    })

    await setBuyerSessionCookie(token, updated.createdAt)

    return { success: true, data: { contactId: updated.contactId } }
}

// ─── Session read & logout (Req 18.5, 18.6, 21.2) ────

/**
 * Read-only summary of the current buyer session for the UI. Returns `null`
 * when there is no valid, verified, unexpired session.
 */
export async function getBuyerSessionInfo(): Promise<
    Result<{ contactId: number; phone: string } | null>
> {
    const session = await getBuyerSession()
    if (!session) return { success: true, data: null }
    return { success: true, data: { contactId: session.contactId, phone: session.phone } }
}

/** Log the buyer out: revoke the session token and clear the cookie. */
export async function logoutBuyer(): Promise<Result<{ loggedOut: true }>> {
    const session = await getBuyerSession()
    if (session) {
        await prisma.buyerSession
            .update({ where: { id: session.sessionId }, data: { sessionToken: null } })
            .catch(() => undefined)
    }
    await clearBuyerSessionCookie()
    return { success: true, data: { loggedOut: true } }
}

// ─────────────────────────────────────────────────────────────────────────
// Buyer-facing data features (Req 18.8–18.11)
//
// Every action below is scoped to the *authenticated* buyer resolved from the
// session cookie. The session's `contactId` — never a caller-supplied id — is
// the only scope used for reads and writes, so one buyer can never see or
// mutate another buyer's data (Req 18.6, 21.2). Actions that accept a
// `bookingId` additionally verify the booking belongs to the session contact
// before doing anything, returning an authorization error otherwise (Req 18.6).
// ─────────────────────────────────────────────────────────────────────────

/** Generic authorization error surfaced when the request is not (or no longer) a valid buyer session. */
const AUTH_ERROR = 'Your session has expired. Please sign in again.'

/**
 * Resolve the current buyer principal for a server action. Returns the
 * {@link BuyerAuthContext}-shaped scope or an error Result when the request is
 * unauthenticated / expired (Req 18.6, 18.7, 21.2). Unlike `requireBuyerAuth`,
 * this does NOT redirect — server actions return a structured error instead.
 */
async function resolveBuyer(): Promise<
    { ok: true; contactId: number; phone: string } | { ok: false; error: string }
> {
    const session = await getBuyerSession()
    if (!session) return { ok: false, error: AUTH_ERROR }
    return { ok: true, contactId: session.contactId, phone: session.phone }
}

/**
 * Confirm `bookingId` belongs to the authenticated `contactId` (Req 18.6).
 * Returns the booking's id when owned, or `null` when it does not exist or
 * belongs to another buyer — callers translate `null` into an auth error so we
 * never leak the existence of another buyer's booking.
 */
async function findOwnedBooking(
    contactId: number,
    bookingId: number
): Promise<{ id: number } | null> {
    if (!Number.isInteger(bookingId) || bookingId <= 0) return null
    return prisma.booking.findFirst({
        where: { id: bookingId, contactId },
        select: { id: true },
    })
}

// ─── Construction update timeline (Req 18.8) ─────────

/** One entry in the buyer's construction timeline. */
export interface ConstructionTimelineEntry {
    id: number
    projectId: number
    projectName: string
    title: string
    description: string | null
    photos: string[]
    date: Date
    milestonePct: number
    category: string | null
}

/**
 * Construction-update timeline for the authenticated buyer (Req 18.8).
 *
 * The buyer's projects are derived from their own bookings (booking → unit →
 * tower → project), so the timeline only ever contains updates for projects the
 * buyer has actually purchased into — the query is scoped to the session
 * `contactId` (Req 18.6, 21.2). Updates are returned newest-first to render as a
 * timeline.
 */
export async function getConstructionTimeline(): Promise<Result<ConstructionTimelineEntry[]>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    // Projects the buyer has a booking in (scoped to their contactId).
    const bookings = await prisma.booking.findMany({
        where: { contactId: auth.contactId },
        select: { unit: { select: { tower: { select: { projectId: true } } } } },
    })

    const projectIds = Array.from(
        new Set(bookings.map((b) => b.unit?.tower?.projectId).filter((id): id is number => typeof id === 'number'))
    )

    if (projectIds.length === 0) {
        return { success: true, data: [] }
    }

    const updates = await prisma.constructionUpdate.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { date: 'desc' },
        select: {
            id: true,
            projectId: true,
            title: true,
            description: true,
            photos: true,
            date: true,
            milestonePct: true,
            category: true,
            project: { select: { name: true } },
        },
    })

    return {
        success: true,
        data: updates.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            projectName: u.project?.name ?? '',
            title: u.title,
            description: u.description,
            photos: u.photos,
            date: u.date,
            milestonePct: u.milestonePct,
            category: u.category,
        })),
    }
}

// ─── Support tickets (Req 18.9) ──────────────────────

/** A support ticket as shown to the buyer who raised it. */
export interface BuyerSupportTicket {
    id: number
    bookingId: number | null
    subject: string
    description: string
    category: string | null
    status: string
    priority: string
    resolvedAt: Date | null
    resolutionNotes: string | null
    createdAt: Date
}

/** Fields a buyer may submit when raising a support ticket. */
export interface CreateSupportTicketInput {
    subject: string
    description: string
    category?: string | null
    bookingId?: number | null
}

/**
 * Create a support ticket for the authenticated buyer (Req 18.9).
 *
 * The `contactId` is taken from the session — never the caller — so a ticket is
 * always owned by the buyer who raised it (Req 18.6, 21.2). Required fields are
 * validated with the pure `validateSupportTicket` helper (subject 1–200 chars,
 * description 1–5000 chars); any missing/invalid field rejects creation with an
 * error (Req 18.9). When a `bookingId` is supplied it must belong to the buyer,
 * otherwise the request is denied (Req 18.6).
 */
export async function createSupportTicket(
    input: CreateSupportTicketInput
): Promise<Result<{ id: number }>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    const subject = typeof input?.subject === 'string' ? input.subject.trim() : ''
    const description = typeof input?.description === 'string' ? input.description.trim() : ''
    const category =
        typeof input?.category === 'string' && input.category.trim() !== ''
            ? input.category.trim()
            : null
    const bookingId =
        typeof input?.bookingId === 'number' && Number.isInteger(input.bookingId)
            ? input.bookingId
            : null

    // Validate required fields (Req 18.9) against the session contact.
    const validation: ReturnType<typeof validateSupportTicket> = validateSupportTicket({
        contactId: auth.contactId,
        subject,
        description,
        bookingId,
        category,
    } satisfies SupportTicketInput)
    if (!validation.valid) {
        return { success: false, error: validation.errors.join('; ') }
    }

    // If the ticket references a booking, it must be the buyer's own (Req 18.6).
    if (bookingId !== null) {
        const owned = await findOwnedBooking(auth.contactId, bookingId)
        if (!owned) return { success: false, error: AUTH_ERROR }
    }

    const ticket = await prisma.supportTicket.create({
        data: {
            contactId: auth.contactId,
            bookingId,
            subject,
            description,
            category,
        },
        select: { id: true },
    })

    return { success: true, data: { id: ticket.id } }
}

/**
 * List the authenticated buyer's support tickets, newest first (Req 18.9).
 * Scoped to the session `contactId` so a buyer only ever tracks their own
 * tickets (Req 18.6, 21.2).
 */
export async function listSupportTickets(): Promise<Result<BuyerSupportTicket[]>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    const tickets = await prisma.supportTicket.findMany({
        where: { contactId: auth.contactId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            bookingId: true,
            subject: true,
            description: true,
            category: true,
            status: true,
            priority: true,
            resolvedAt: true,
            resolutionNotes: true,
            createdAt: true,
        },
    })

    return { success: true, data: tickets }
}

// ─── Possession checklist: view / snag / sign-off (Req 18.10) ─────────

/** A single checklist line item stored in `PossessionChecklist.items` (Json). */
export interface ChecklistItem {
    id: string
    label: string
    /** 'Pending' until inspected; 'OK' when accepted; 'Snag' when the buyer flags a defect. */
    status: 'Pending' | 'OK' | 'Snag'
    snagNote?: string
    raisedAt?: string
}

/** The possession checklist view returned to the buyer. */
export interface BuyerPossessionChecklist {
    bookingId: number
    items: ChecklistItem[]
    inspectionDate: Date | null
    inspector: string | null
    buyerSigned: boolean
    signatureUrl: string | null
    handoverDate: Date | null
    keysHanded: boolean
}

/** Coerce the persisted `items` Json into a typed checklist array, defensively. */
function normalizeChecklistItems(raw: unknown): ChecklistItem[] {
    if (!Array.isArray(raw)) return []
    const items: ChecklistItem[] = []
    for (const entry of raw) {
        if (entry && typeof entry === 'object') {
            const e = entry as Record<string, unknown>
            const status =
                e.status === 'OK' || e.status === 'Snag' ? e.status : 'Pending'
            items.push({
                id: typeof e.id === 'string' ? e.id : String(items.length + 1),
                label: typeof e.label === 'string' ? e.label : '',
                status,
                ...(typeof e.snagNote === 'string' ? { snagNote: e.snagNote } : {}),
                ...(typeof e.raisedAt === 'string' ? { raisedAt: e.raisedAt } : {}),
            })
        }
    }
    return items
}

/**
 * View the possession checklist for one of the buyer's bookings (Req 18.10).
 * The booking must belong to the authenticated buyer (Req 18.6). Returns `null`
 * data when the buyer owns the booking but no checklist has been prepared yet.
 */
export async function getPossessionChecklist(
    bookingId: number
): Promise<Result<BuyerPossessionChecklist | null>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    const owned = await findOwnedBooking(auth.contactId, bookingId)
    if (!owned) return { success: false, error: AUTH_ERROR }

    const checklist = await prisma.possessionChecklist.findUnique({
        where: { bookingId },
        select: {
            items: true,
            inspectionDate: true,
            inspector: true,
            buyerSigned: true,
            signatureUrl: true,
            handoverDate: true,
            keysHanded: true,
        },
    })

    if (!checklist) return { success: true, data: null }

    return {
        success: true,
        data: {
            bookingId,
            items: normalizeChecklistItems(checklist.items),
            inspectionDate: checklist.inspectionDate,
            inspector: checklist.inspector,
            buyerSigned: checklist.buyerSigned,
            signatureUrl: checklist.signatureUrl,
            handoverDate: checklist.handoverDate,
            keysHanded: checklist.keysHanded,
        },
    }
}

/** Details for a snag the buyer raises against a possession checklist. */
export interface RaiseSnagInput {
    /** Optionally flag an existing checklist item by its id; omit to add a new snag line. */
    itemId?: string
    /** Label for a new snag item (used when `itemId` is omitted or not found). */
    label?: string
    /** The defect note. */
    note: string
}

/**
 * Raise a snag against the buyer's possession checklist (Req 18.10).
 *
 * Either flags an existing item (by `itemId`) as `Snag` with the note, or
 * appends a new `Snag` line when no matching item is given. The booking must
 * belong to the authenticated buyer (Req 18.6). Sign-off, once recorded, locks
 * further snags so a signed checklist is immutable.
 */
export async function raisePossessionSnag(
    bookingId: number,
    input: RaiseSnagInput
): Promise<Result<{ items: ChecklistItem[] }>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    const note = typeof input?.note === 'string' ? input.note.trim() : ''
    if (note === '') return { success: false, error: 'A snag description is required' }

    const owned = await findOwnedBooking(auth.contactId, bookingId)
    if (!owned) return { success: false, error: AUTH_ERROR }

    const existing = await prisma.possessionChecklist.findUnique({
        where: { bookingId },
        select: { items: true, buyerSigned: true },
    })
    if (!existing) {
        return { success: false, error: 'No possession checklist is available for this booking yet' }
    }
    if (existing.buyerSigned) {
        return { success: false, error: 'This checklist has been signed off and can no longer be changed' }
    }

    const items = normalizeChecklistItems(existing.items)
    const raisedAt = new Date().toISOString()

    const target = input.itemId ? items.find((it) => it.id === input.itemId) : undefined
    if (target) {
        target.status = 'Snag'
        target.snagNote = note
        target.raisedAt = raisedAt
    } else {
        const nextId = String(
            items.reduce((max, it) => Math.max(max, Number.parseInt(it.id, 10) || 0), 0) + 1
        )
        items.push({
            id: nextId,
            label: typeof input.label === 'string' && input.label.trim() !== '' ? input.label.trim() : 'Snag',
            status: 'Snag',
            snagNote: note,
            raisedAt,
        })
    }

    await prisma.possessionChecklist.update({
        where: { bookingId },
        data: { items: items as unknown as object[] },
    })

    return { success: true, data: { items } }
}

/** Sign-off details supplied by the buyer. */
export interface PossessionSignOffInput {
    /** URL of the captured buyer signature image (optional but recommended). */
    signatureUrl?: string | null
}

/**
 * Record the buyer's possession sign-off (Req 18.10).
 *
 * Sets the buyer-signed flag (and signature URL when supplied) on the checklist
 * for one of the buyer's own bookings (Req 18.6). Idempotent: signing an
 * already-signed checklist returns success without change.
 */
export async function signOffPossession(
    bookingId: number,
    input: PossessionSignOffInput = {}
): Promise<Result<{ buyerSigned: true }>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    const owned = await findOwnedBooking(auth.contactId, bookingId)
    if (!owned) return { success: false, error: AUTH_ERROR }

    const checklist = await prisma.possessionChecklist.findUnique({
        where: { bookingId },
        select: { buyerSigned: true },
    })
    if (!checklist) {
        return { success: false, error: 'No possession checklist is available for this booking yet' }
    }

    const signatureUrl =
        typeof input?.signatureUrl === 'string' && input.signatureUrl.trim() !== ''
            ? input.signatureUrl.trim()
            : undefined

    if (!checklist.buyerSigned || signatureUrl) {
        await prisma.possessionChecklist.update({
            where: { bookingId },
            data: {
                buyerSigned: true,
                ...(signatureUrl ? { signatureUrl } : {}),
            },
        })
    }

    return { success: true, data: { buyerSigned: true } }
}

// ─── Payment: Pay Now vs manual instructions (Req 18.11, A5) ─────────

/**
 * Whether the optional online payment gateway is enabled (assumption A5).
 *
 * The default deployment captures payments manually via bank transfer, with the
 * online gateway deferred behind this configurable feature flag. When the flag
 * is off, the buyer portal shows manual instructions instead of a "Pay Now"
 * action.
 */
function isOnlinePaymentEnabled(): boolean {
    return process.env.BUYER_PORTAL_ONLINE_PAYMENT === 'true'
}

/** Manual bank-transfer instructions, sourced from StoreSettings. */
export interface ManualPaymentInstructions {
    bankName: string | null
    accountName: string | null
    accountNumber: string | null
    iban: string | null
    qrUrl: string | null
}

/** Result of asking how the buyer should pay (Req 18.11). */
export interface PaymentOptions {
    /** 'online' exposes a Pay Now action; 'manual' shows transfer instructions. */
    mode: 'online' | 'manual'
    /** Outstanding amount for the booking, when a booking was specified. */
    amountDue: number | null
    /** Present only in 'manual' mode (Req 18.11). */
    manual: ManualPaymentInstructions | null
    /** Present only in 'online' mode — the Pay Now action is available. */
    payNowAvailable: boolean
}

/**
 * Resolve how the authenticated buyer should pay (Req 18.11, A5).
 *
 * WHERE online payment is enabled, exposes a "Pay Now" action; otherwise it
 * returns the manual bank-transfer instructions from StoreSettings. When a
 * `bookingId` is supplied it must belong to the buyer (Req 18.6) and the
 * outstanding milestone balance is computed for display.
 */
export async function getPaymentOptions(
    bookingId?: number
): Promise<Result<PaymentOptions>> {
    const auth = await resolveBuyer()
    if (!auth.ok) return { success: false, error: auth.error }

    let amountDue: number | null = null
    if (typeof bookingId === 'number') {
        const owned = await findOwnedBooking(auth.contactId, bookingId)
        if (!owned) return { success: false, error: AUTH_ERROR }

        const milestones = await prisma.bookingMilestone.findMany({
            where: { bookingId },
            select: { amount: true, paidAmount: true },
        })
        amountDue = milestones.reduce(
            (sum, m) => sum + Math.max(0, Number(m.amount) - Number(m.paidAmount)),
            0
        )
    }

    if (isOnlinePaymentEnabled()) {
        return {
            success: true,
            data: { mode: 'online', amountDue, manual: null, payNowAvailable: true },
        }
    }

    const settings = await prisma.storeSettings.findFirst({
        select: {
            bankName: true,
            bankAccountName: true,
            bankAccountNumber: true,
            bankIban: true,
            paymentQr: true,
        },
    })

    return {
        success: true,
        data: {
            mode: 'manual',
            amountDue,
            payNowAvailable: false,
            manual: {
                bankName: settings?.bankName ?? null,
                accountName: settings?.bankAccountName ?? null,
                accountNumber: settings?.bankAccountNumber ?? null,
                iban: settings?.bankIban ?? null,
                qrUrl: settings?.paymentQr ?? null,
            },
        },
    }
}
