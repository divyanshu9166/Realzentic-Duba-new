'use server'

/**
 * Timeline_Service — server actions for the Unified Contact Timeline (Module 11).
 *
 * Backs Requirements 14.1, 14.2 and 14.5. The deterministic merge / filter /
 * pagination logic lives in the pure helpers in `lib/timeline.ts`; this module
 * is responsible only for fetching the raw rows from each source table for a
 * contact, mapping them into the source-agnostic `TimelineEntry` shape, and
 * delegating ordering and paging to those helpers.
 *
 *   - getContactTimeline(contactId, cursor, type?) — aggregate calls, WhatsApp/
 *     other messages, emails, site visits, payments, documents, deal-stage
 *     changes, and notes for a contact into a single reverse-chronological,
 *     paginated timeline (Req 14.1, 14.2, 14.5).
 *
 * Source → TimelineEntryType mapping (Req 14.1):
 *   CallLog                       → 'call'
 *   Conversation                  → 'message'
 *   EmailRecipient (sent)         → 'email'
 *   FieldVisit (by contact name)  → 'visit'
 *   DailyPayment                  → 'payment'
 *   Document (entity = Contact)   → 'document'
 *   DealActivity (stage changes)  → 'deal_stage'
 *   DealActivity (note) / Contact → 'note'
 */

import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import {
    mergeTimeline,
    filterByType,
    paginate,
    type TimelineEntry,
    type TimelineEntryType,
    type TimelinePage,
} from '@/lib/timeline'

// ─── Shared types ──────────────────────────────────────

type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string }

/** Default number of entries returned per page for infinite scroll (Req 14.5). */
const DEFAULT_TIMELINE_PAGE_SIZE = 20

/** The set of valid timeline entry types, used to validate the optional filter. */
const VALID_TYPES: ReadonlySet<TimelineEntryType> = new Set<TimelineEntryType>([
    'call',
    'message',
    'email',
    'visit',
    'payment',
    'document',
    'deal_stage',
    'note',
])

// ─── Helpers ───────────────────────────────────────────

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalize the optional `type` argument into a set of requested types, or
 * `null` for "all types". Returns `{ error }` when an unknown type is supplied.
 */
function normalizeTypeFilter(
    type: TimelineEntryType | ReadonlyArray<TimelineEntryType> | null | undefined
): { types: Set<TimelineEntryType> | null } | { error: string } {
    if (type == null) {
        return { types: null }
    }
    const list = Array.isArray(type) ? type : [type]
    if (list.length === 0) {
        return { types: null }
    }
    for (const t of list) {
        if (!VALID_TYPES.has(t as TimelineEntryType)) {
            return { error: `Invalid timeline type: ${String(t)}` }
        }
    }
    return { types: new Set(list as TimelineEntryType[]) }
}

/** Whether a source of the given type should be queried under the active filter. */
function wants(types: Set<TimelineEntryType> | null, t: TimelineEntryType): boolean {
    return types == null || types.has(t)
}

function ms(date: Date | null | undefined): number | null {
    if (!date) return null
    const t = date.getTime()
    return Number.isNaN(t) ? null : t
}

// ─── getContactTimeline (Req 14.1, 14.2, 14.5) ─────────

export async function getContactTimeline(
    contactId: number,
    cursor: number = 0,
    type?: TimelineEntryType | ReadonlyArray<TimelineEntryType> | null,
    pageSize: number = DEFAULT_TIMELINE_PAGE_SIZE
): Promise<ActionResult<TimelinePage>> {
    try {
        await requireAuth()

        if (!isPositiveInt(contactId)) {
            return { success: false, error: 'contactId must be a positive integer' }
        }
        if (
            typeof cursor !== 'number' ||
            !Number.isInteger(cursor) ||
            cursor < 0
        ) {
            return { success: false, error: 'cursor must be a non-negative integer' }
        }
        if (!isPositiveInt(pageSize)) {
            return { success: false, error: 'pageSize must be a positive integer' }
        }

        const filter = normalizeTypeFilter(type)
        if ('error' in filter) {
            return { success: false, error: filter.error }
        }
        const { types } = filter

        const contact = await prisma.contact.findUnique({
            where: { id: contactId },
            select: { id: true, name: true, notes: true, updatedAt: true, phone: true },
        })
        if (!contact) {
            return { success: false, error: `Contact ${contactId} not found` }
        }

        // ── Resolve WaContact by phone (exact or with 91-prefix normalisation) ──
        let waContactId: string | null = null
        if (contact.phone) {
            const phone = contact.phone.trim()

            // 1. Exact match.
            const waExact = await prisma.waContact.findFirst({ where: { phone } })
            if (waExact) {
                waContactId = waExact.id
            } else {
                // 2. Try prepending country code 91 to the last 10 digits.
                const last10 = phone.replace(/\D/g, '').slice(-10)
                const waWith91 = await prisma.waContact.findFirst({
                    where: { phone: '91' + last10 },
                })
                if (waWith91) {
                    waContactId = waWith91.id
                } else if (/^91\d{10}$/.test(phone.replace(/\D/g, ''))) {
                    // 3. Try stripping the leading 91 from a 12-digit number.
                    const stripped = phone.replace(/\D/g, '').slice(2)
                    const waStripped = await prisma.waContact.findFirst({
                        where: { phone: stripped },
                    })
                    if (waStripped) {
                        waContactId = waStripped.id
                    }
                }
            }
        }

        // Fetch only the sources needed for the active filter (Req 14.1, 14.4).
        const [
            calls,
            conversations,
            emails,
            visits,
            payments,
            documents,
            dealActivities,
            waMessages,
        ] = await Promise.all([
            wants(types, 'call')
                ? prisma.callLog.findMany({ where: { contactId } })
                : Promise.resolve([]),
            wants(types, 'message')
                ? prisma.conversation.findMany({ where: { contactId } })
                : Promise.resolve([]),
            wants(types, 'email')
                ? prisma.emailRecipient.findMany({
                    where: { contactId, sentAt: { not: null } },
                    include: { campaign: { select: { subject: true, name: true } } },
                })
                : Promise.resolve([]),
            wants(types, 'visit')
                ? prisma.fieldVisit.findMany({
                    where: { customer: { equals: contact.name, mode: 'insensitive' } },
                    include: { staff: { select: { id: true, name: true } } },
                })
                : Promise.resolve([]),
            wants(types, 'payment')
                ? prisma.dailyPayment.findMany({
                    where: { contactId },
                    include: { receivedByStaff: { select: { id: true, name: true } } },
                })
                : Promise.resolve([]),
            wants(types, 'document')
                ? prisma.document.findMany({
                    where: { entityType: 'Contact', entityId: contactId },
                })
                : Promise.resolve([]),
            wants(types, 'deal_stage') || wants(types, 'note')
                ? prisma.dealActivity.findMany({
                    where: { deal: { contactId } },
                })
                : Promise.resolve([]),
            wants(types, 'message') && waContactId != null
                ? prisma.waMessage.findMany({
                    where: {
                        conversation: { contact_id: waContactId },
                        content_type: { not: 'template' },
                    },
                    include: { conversation: { select: { id: true } } },
                    orderBy: { created_at: 'desc' },
                    take: 100,
                })
                : Promise.resolve([]),
        ])

        // Resolve staff names referenced by plain-Int columns (no FK relation).
        const staffIds = new Set<number>()
        for (const d of documents) if (d.uploadedById != null) staffIds.add(d.uploadedById)
        for (const a of dealActivities) if (a.performedById != null) staffIds.add(a.performedById)

        const staffById = new Map<number, string>()
        if (staffIds.size > 0) {
            const staff = await prisma.staff.findMany({
                where: { id: { in: Array.from(staffIds) } },
                select: { id: true, name: true },
            })
            for (const s of staff) staffById.set(s.id, s.name)
        }

        // ── Map each source row into a TimelineEntry ──

        const callEntries: TimelineEntry[] = calls.map((c): TimelineEntry => ({
            id: `call:${c.id}`,
            type: 'call',
            timestamp: ms(c.date) ?? ms(c.createdAt) ?? 0,
            description:
                `${c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call` +
                ` (${c.status})` +
                (c.purpose ? ` — ${c.purpose}` : ''),
            performedBy: c.agent || null,
            metadata: {
                direction: c.direction,
                status: c.status,
                durationSec: c.durationSec,
                phone: c.phone,
                outcome: c.outcome ?? null,
            },
        }))

        const messageEntries: TimelineEntry[] = conversations.map((m): TimelineEntry => ({
            id: `message:${m.id}`,
            type: 'message',
            timestamp: ms(m.date) ?? ms(m.createdAt) ?? 0,
            description:
                `${m.channel} message` +
                (m.lastMessage ? `: ${m.lastMessage}` : ''),
            performedBy: null,
            metadata: {
                channel: m.channel,
                status: m.status,
                unread: m.unread,
            },
        }))

        const emailEntries: TimelineEntry[] = emails.map((e): TimelineEntry => ({
            id: `email:${e.id}`,
            type: 'email',
            timestamp: ms(e.sentAt) ?? 0,
            description:
                `Email: ${e.campaign?.subject || e.campaign?.name || 'Campaign'}`,
            performedBy: null,
            metadata: {
                status: e.status,
                email: e.email,
                opens: e.opens,
                clicks: e.clicks,
            },
        }))

        const visitEntries: TimelineEntry[] = visits.map((v): TimelineEntry => ({
            id: `visit:${v.id}`,
            type: 'visit',
            timestamp:
                ms(v.completedAt) ?? ms(v.scheduledDate) ?? ms(v.date) ?? 0,
            description:
                `Site visit (${v.status})` +
                (v.address ? ` — ${v.address}` : ''),
            performedBy: v.staff?.name ?? null,
            metadata: {
                status: v.status,
                visitType: v.type,
                address: v.address,
                buyerRating: v.buyerRating ?? null,
            },
        }))

        const paymentEntries: TimelineEntry[] = payments.map((p): TimelineEntry => ({
            id: `payment:${p.id}`,
            type: 'payment',
            timestamp: ms(p.date) ?? ms(p.createdAt) ?? 0,
            description:
                `Payment ${p.type === 'OUT' ? 'out' : 'in'}` +
                ` AED ${p.amount} via ${p.method} (${p.status})`,
            performedBy: p.receivedByStaff?.name ?? null,
            metadata: {
                amount: p.amount,
                method: p.method,
                status: p.status,
                direction: p.type,
                reference: p.reference ?? null,
            },
        }))

        const documentEntries: TimelineEntry[] = documents.map((d): TimelineEntry => ({
            id: `document:${d.id}`,
            type: 'document',
            timestamp: ms(d.createdAt) ?? 0,
            description: `Document: ${d.type} — ${d.fileName}`,
            performedBy:
                d.uploadedById != null ? staffById.get(d.uploadedById) ?? null : null,
            metadata: {
                docType: d.type,
                fileName: d.fileName,
                status: d.status,
                fileUrl: d.fileUrl,
            },
        }))

        // ── Map WaMessage rows into TimelineEntry ──
        const waMessageEntries: TimelineEntry[] = waMessages.map((m): TimelineEntry => ({
            id: `wa_message:${m.id}`,
            type: 'message' as const,
            timestamp: m.created_at.getTime(),
            description: m.sender_type === 'customer'
                ? `WhatsApp: ${m.content_text ?? '[media]'}`
                : `WhatsApp reply: ${m.content_text ?? (m.template_name ? `[template: ${m.template_name}]` : '[media]')}`,
            performedBy: m.sender_type === 'customer' ? null : 'Agent/Bot',
            metadata: {
                channel: 'WhatsApp',
                senderType: m.sender_type,
                contentType: m.content_type,
                messageId: m.message_id,
                status: m.status,
                conversationId: m.conversation_id,
            },
        }))

        // DealActivity rows split into deal-stage changes vs notes (Req 14.1).
        const dealStageEntries: TimelineEntry[] = []
        const dealNoteEntries: TimelineEntry[] = []
        for (const a of dealActivities) {
            const isNote = a.type === 'note'
            const performedBy =
                a.performedById != null ? staffById.get(a.performedById) ?? null : null
            const entry: TimelineEntry = {
                id: `dealactivity:${a.id}`,
                type: isNote ? 'note' : 'deal_stage',
                timestamp: ms(a.createdAt) ?? 0,
                description: a.description,
                performedBy,
                metadata: {
                    dealId: a.dealId,
                    activityType: a.type,
                    oldStageId: a.oldStageId ?? null,
                    newStageId: a.newStageId ?? null,
                },
            }
            if (isNote) dealNoteEntries.push(entry)
            else dealStageEntries.push(entry)
        }

        // Contact-level free-text note (single entry, if present).
        const contactNoteEntries: TimelineEntry[] = []
        if (wants(types, 'note') && isNonEmptyString(contact.notes)) {
            contactNoteEntries.push({
                id: `contactnote:${contact.id}`,
                type: 'note',
                timestamp: ms(contact.updatedAt) ?? 0,
                description: `Note: ${contact.notes}`,
                performedBy: null,
                metadata: { source: 'contact' },
            })
        }

        // Merge (union + reverse-chronological sort) via the pure helper (Req 14.1, 14.2).
        const merged = mergeTimeline([
            callEntries,
            messageEntries,
            waMessageEntries,
            emailEntries,
            visitEntries,
            paymentEntries,
            documentEntries,
            dealStageEntries,
            dealNoteEntries,
            contactNoteEntries,
        ])

        // Defensive: enforce the requested type filter on the merged result (Req 14.4).
        const filtered = types == null ? merged : filterByType(merged, Array.from(types))

        // Page the ordered list for infinite scroll (Req 14.5).
        const page = paginate(filtered, pageSize, cursor)

        return { success: true, data: page }
    } catch (error) {
        console.error('Error building contact timeline:', error)
        return { success: false, error: 'Failed to build contact timeline' }
    }
}
