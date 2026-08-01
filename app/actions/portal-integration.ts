'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { sendEmail } from '@/lib/email'
import { isDuplicate, normalizePhone } from '@/lib/dedup'
import { uaePhoneVariants } from '@/lib/whatsapp/phone-utils'
import {
    sourceForPortal,
    validatePortalPayload,
    type ParsedPortalLead,
} from '@/lib/portal'
import { upsertPortalConfigSchema } from '@/lib/validations/portal-integration'
import type { Prisma } from '@prisma/client'

/**
 * Portal_Integration_Service server actions (Module 12 / Requirement 15).
 *
 * Backs the property-portal integration surface:
 *   - `upsertPortalConfig` / `listPortalConfigs` — persist and read
 *     PortalConfig records (portal name, enabled flag, API key, webhook URL,
 *     last-sync timestamp, auto-assign Staff) (Req 15.1).
 *   - `ingestPortalLead` — the core webhook-ingestion path. Disabled portals
 *     are ignored (Req 15.4); payloads are validated by the pure
 *     `validatePortalPayload` helper and rejected without writes on failure
 *     (Req 15.6); inbound inquiries are deduplicated against existing contacts;
 *     when no duplicate exists a Contact and Lead are created, auto-assigned per
 *     PortalConfig, and the assignee is notified (Req 15.3); a PortalLead record
 *     is always persisted with the raw payload and dedup flag (Req 15.2); the
 *     source attribution (Bayut/Property Finder/Dubizzle) is recorded on
 *     the created Lead (Req 15.5, A7).
 *
 * `ingestPortalLead` is invoked by the unauthenticated webhook route
 * (`app/api/webhooks/portals/[portal]`, task 20.5), so it performs NO session
 * check — the portal is authenticated by its config + API key, not a user
 * session. The PortalConfig admin actions require ADMIN/MANAGER.
 */

const ADMIN_PATH = '/settings/portals'

type Result<T> = { success: true; data: T } | { success: false; error: string }

/** Outcome of an ingestion attempt. */
export type IngestOutcome =
    /** The portal is unknown or disabled; nothing was written (Req 15.4). */
    | { status: 'ignored'; reason: string }
    /** The payload failed validation; nothing was written (Req 15.6). */
    | { status: 'rejected'; field: string; error: string }
    /** A duplicate contact existed; a deduplicated PortalLead was recorded. */
    | { status: 'duplicate'; portalLeadDbId: number; contactId: number }
    /** A new Contact + Lead were created and the assignee notified (Req 15.3). */
    | {
        status: 'created'
        portalLeadDbId: number
        contactId: number
        leadId: number
        assignedToId: number | null
    }

// ─── PortalConfig persistence (Req 15.1) ─────────────

/**
 * Create or update a PortalConfig by its unique `portalName` (Req 15.1).
 * Admin/manager only. Validates input with Zod before any write (Req 20.4).
 */
export async function upsertPortalConfig(data: unknown): Promise<Result<{ id: number }>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = upsertPortalConfigSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { portalName, enabled, apiKey, webhookUrl, autoAssignStaffId } = parsed.data

    // Validate the auto-assign staff reference before persisting it.
    if (autoAssignStaffId !== undefined && autoAssignStaffId !== null) {
        const staff = await prisma.staff.findUnique({
            where: { id: autoAssignStaffId },
            select: { id: true },
        })
        if (!staff) return { success: false, error: 'Auto-assign staff member not found' }
    }

    const config = await prisma.portalConfig.upsert({
        where: { portalName },
        create: {
            portalName,
            enabled,
            apiKey: apiKey ?? null,
            webhookUrl: webhookUrl ?? null,
            autoAssignStaffId: autoAssignStaffId ?? null,
        },
        update: {
            enabled,
            webhookUrl: webhookUrl ?? null,
            autoAssignStaffId: autoAssignStaffId ?? null,
            // Only overwrite the stored API key when a new one was provided —
            // the admin UI masks the saved secret and omits it on re-save, so
            // omitting it must preserve (not clear) the existing key.
            ...(apiKey !== undefined ? { apiKey } : {}),
        },
        select: { id: true },
    })

    revalidatePath(ADMIN_PATH)
    return { success: true, data: { id: config.id } }
}

/** List all PortalConfig records for the admin surface (Req 15.1). */
export async function listPortalConfigs(): Promise<
    Result<
        Array<{
            id: number
            portalName: string
            enabled: boolean
            hasApiKey: boolean
            webhookUrl: string | null
            lastSyncAt: string | null
            autoAssignStaffId: number | null
        }>
    >
> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const configs = await prisma.portalConfig.findMany({
        orderBy: { portalName: 'asc' },
    })

    return {
        success: true,
        data: configs.map((c) => ({
            id: c.id,
            portalName: c.portalName,
            enabled: c.enabled,
            // Never echo the secret back; expose only its presence.
            hasApiKey: Boolean(c.apiKey),
            webhookUrl: c.webhookUrl,
            lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
            autoAssignStaffId: c.autoAssignStaffId,
        })),
    }
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Find an existing Contact that duplicates the inbound portal lead
 * (Req 15.3). Queries candidates by every common UAE phone representation or email (the strong,
 * indexed signals) and confirms with the shared `isDuplicate` predicate so the
 * decision matches the rest of the dedup pipeline (`lib/dedup.ts`).
 */
async function findDuplicateContact(
    lead: ParsedPortalLead
): Promise<{ id: number; name: string; phone: string; email: string | null } | null> {
    const or: Prisma.ContactWhereInput[] = [{ phone: { in: uaePhoneVariants(lead.phone) } }]
    if (lead.email) or.push({ email: lead.email })

    const candidates = await prisma.contact.findMany({
        where: { OR: or },
        select: { id: true, name: true, phone: true, email: true },
    })

    const match = candidates.find((c) =>
        isDuplicate(
            { name: lead.name, phone: lead.phone, email: lead.email },
            { name: c.name, phone: normalizePhone(c.phone), email: c.email }
        )
    )

    return match ?? null
}

/**
 * Best-effort notification of the auto-assigned staff member (Req 15.3).
 *
 * Records an in-app Notification and, when the staff member has an email,
 * sends an email (fire-and-forget). Failures are swallowed: a notification
 * problem must never roll back a successfully ingested lead.
 */
async function notifyAssignee(params: {
    staffId: number | null
    leadId: number
    contactName: string
    portalName: string
    propertyName: string | null
}): Promise<void> {
    const { staffId, leadId, contactName, portalName, propertyName } = params

    const subtitle = propertyName
        ? `${contactName} inquired about ${propertyName} via ${portalName}`
        : `${contactName} submitted an inquiry via ${portalName}`

    try {
        await prisma.notification.create({
            data: {
                type: 'portal_lead',
                title: `New ${portalName} lead`,
                subtitle,
                href: '/leads',
                metadata: { leadId, assignedToId: staffId },
            },
        })
    } catch (err) {
        console.error('[portal-integration] failed to create notification:', err)
    }

    if (staffId === null) return

    try {
        const staff = await prisma.staff.findUnique({
            where: { id: staffId },
            select: { email: true, name: true },
        })
        if (staff?.email) {
            sendEmail({
                to: staff.email,
                subject: `New ${portalName} lead assigned to you`,
                html: `<p>Hi ${staff.name || 'there'},</p><p>${subtitle}.</p><p>Open the leads dashboard to follow up.</p>`,
            }).catch((err) =>
                console.error('[portal-integration] assignee email failed:', err)
            )
        }
    } catch (err) {
        console.error('[portal-integration] failed to look up assignee:', err)
    }
}

// ─── Webhook ingestion (Req 15.2, 15.3, 15.4, 15.5) ──

/**
 * Ingest an inbound portal webhook for `portalIdentifier` (the `[portal]`
 * route slug, a display name, or a header value).
 *
 * Sequence:
 *   1. Resolve the PortalConfig. If none exists or `enabled` is false, ignore
 *      the webhook and write nothing (Req 15.4).
 *   2. Validate the payload with the pure `validatePortalPayload` helper. On
 *      failure, reject without writing anything (Req 15.6).
 *   3. Deduplicate against existing contacts (Req 15.3). When a duplicate
 *      exists, persist only a PortalLead flagged `deduplicated` (Req 15.2) and
 *      create no new Contact/Lead.
 *   4. When no duplicate exists, create a Contact and Lead in one transaction,
 *      auto-assign per config, record the source attribution on the Lead
 *      (Req 15.5, A7), and persist the PortalLead linked to the new Lead.
 *   5. Notify the assignee (Req 15.3).
 */
export async function ingestPortalLead(
    portalIdentifier: string,
    payload: unknown
): Promise<Result<IngestOutcome>> {
    // 1. Resolve config — unknown or disabled portals are ignored (Req 15.4).
    const canonical = sourceForPortal(portalIdentifier)
    const config = await prisma.portalConfig.findFirst({
        where: {
            OR: [
                { portalName: portalIdentifier },
                ...(canonical ? [{ portalName: canonical }] : []),
            ],
        },
    })

    if (!config) {
        return {
            success: true,
            data: { status: 'ignored', reason: `No portal configured for "${portalIdentifier}"` },
        }
    }
    if (!config.enabled) {
        return {
            success: true,
            data: { status: 'ignored', reason: `Portal "${config.portalName}" is disabled` },
        }
    }

    // 2. Validate the payload — reject without writes on failure (Req 15.6).
    const validation = validatePortalPayload(payload)
    if (!validation.ok) {
        return {
            success: true,
            data: { status: 'rejected', field: validation.field, error: validation.error },
        }
    }
    const lead = validation.lead

    // Source attribution recorded on the created Lead (Req 15.5, A7). Fall back
    // to the configured portal name when the identifier is not a known portal.
    const source = canonical ?? config.portalName

    const rawPayload = JSON.parse(JSON.stringify(payload ?? {})) as Prisma.InputJsonValue
    const inquiryDate = lead.inquiryDate ?? new Date()

    // 3. Deduplicate against existing contacts (Req 15.3).
    const duplicate = await findDuplicateContact(lead)
    if (duplicate) {
        const portalLead = await prisma.portalLead.create({
            data: {
                portalConfigId: config.id,
                leadId: null,
                portalLeadId: lead.portalLeadId,
                portalName: config.portalName,
                inquiryDate,
                propertyName: lead.propertyName,
                buyerMessage: lead.buyerMessage,
                rawPayload,
                deduplicated: true,
            },
            select: { id: true },
        })

        await prisma.portalConfig.update({
            where: { id: config.id },
            data: { lastSyncAt: new Date() },
        })

        revalidatePath('/leads')
        return {
            success: true,
            data: { status: 'duplicate', portalLeadDbId: portalLead.id, contactId: duplicate.id },
        }
    }

    // 4. No duplicate: create Contact + Lead + PortalLead atomically (Req 15.3,
    //    15.2). Auto-assign per config and record source attribution (Req 15.5).
    const assignedToId = config.autoAssignStaffId ?? null

    const created = await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.create({
            data: {
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                source,
            },
            select: { id: true, name: true },
        })

        const newLead = await tx.lead.create({
            data: {
                contactId: contact.id,
                interest: lead.propertyName ?? 'Property inquiry',
                status: 'NEW',
                source,
                notes: lead.buyerMessage,
                assignedToId,
            },
            select: { id: true },
        })

        const portalLead = await tx.portalLead.create({
            data: {
                portalConfigId: config.id,
                leadId: newLead.id,
                portalLeadId: lead.portalLeadId,
                portalName: config.portalName,
                inquiryDate,
                propertyName: lead.propertyName,
                buyerMessage: lead.buyerMessage,
                rawPayload,
                deduplicated: false,
            },
            select: { id: true },
        })

        await tx.portalConfig.update({
            where: { id: config.id },
            data: { lastSyncAt: new Date() },
        })

        return {
            contactId: contact.id,
            contactName: contact.name,
            leadId: newLead.id,
            portalLeadDbId: portalLead.id,
        }
    })

    // 5. Notify the assignee (Req 15.3) — outside the transaction so a delivery
    //    failure cannot roll back the ingested lead.
    await notifyAssignee({
        staffId: assignedToId,
        leadId: created.leadId,
        contactName: created.contactName,
        portalName: config.portalName,
        propertyName: lead.propertyName,
    })

    revalidatePath('/leads')
    return {
        success: true,
        data: {
            status: 'created',
            portalLeadDbId: created.portalLeadDbId,
            contactId: created.contactId,
            leadId: created.leadId,
            assignedToId,
        },
    }
}
