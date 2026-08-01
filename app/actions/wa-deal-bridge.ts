'use server'

/**
 * app/actions/wa-deal-bridge.ts
 *
 * Bridge a WhatsApp CRM deal (WaDeal) to the main CRM deal pipeline.
 *
 * The bridge key is the phone number: WaContact.phone ↔ Contact.phone.
 * On first call the action:
 *   1. Loads the WaDeal with its contact, stage, and pipeline.
 *   2. Finds or creates a CRM Contact matched by phone.
 *   3. Finds or creates a CRM DealStage matched by stage name.
 *   4. Creates a CRM Deal with source = 'WhatsApp CRM'.
 *   5. Writes back crm_deal_id so the bridge is idempotent.
 *   6. Creates a DealActivity audit note.
 *
 * Guards:
 *   - If crm_deal_id is already set, returns immediately (idempotent).
 *   - requireRole('ADMIN', 'MANAGER') enforced.
 *   - waDealId must be a non-empty string.
 */

import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { normalizePhoneForMetaUae, uaePhoneVariants } from '@/lib/whatsapp/phone-utils'

// ---------------------------------------------------------------------------
// Phone normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Canonicalize a UAE mobile phone for CRM storage. Returns null for a value
 * that cannot be recognized as a UAE mobile number.
 */
function canonicalUaePhone(raw: string): string | null {
    const normalized = normalizePhoneForMetaUae(raw)
    return normalized.startsWith('9715') && normalized.length === 12 ? normalized : null
}

/**
 * Build the candidate phone variants used when looking up a CRM Contact.
 * Returns an array of unique, non-empty strings so prisma can search with
 * `{ phone: { in: candidates } }`.
 *
 * Variants produced:
 *   - The raw value as-is (handles e.g. "+971XXXXXXXXXX" already in DB).
 *   - Canonical UAE E.164 digits (e.g. "971501234567").
 *   - UAE domestic forms with and without the `0` trunk prefix.
 */
function phoneVariants(raw: string): string[] {
    return uaePhoneVariants(raw)
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

export interface BridgeResult {
    success: boolean
    crmDealId?: number
    error?: string
}

/**
 * Bridge a WaDeal to the CRM deal pipeline.
 *
 * @param waDealId  CUID of the WaDeal row to bridge.
 * @returns         { success, crmDealId } on success or { success: false, error }.
 */
export async function bridgeWaDealToCrm(waDealId: string): Promise<BridgeResult> {
    // --- guard: role ---
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Forbidden: ADMIN or MANAGER role required' }
    }

    // --- guard: input ---
    if (!waDealId || typeof waDealId !== 'string' || !waDealId.trim()) {
        return { success: false, error: 'waDealId must be a non-empty string' }
    }

    const id = waDealId.trim()

    // -----------------------------------------------------------------------
    // 1. Load WaDeal with contact, stage and pipeline
    // -----------------------------------------------------------------------
    const waDeal = await prisma.waDeal.findUnique({
        where: { id },
        include: {
            contact: true,
            stage: true,
            pipeline: true,
        },
    })

    if (!waDeal) {
        return { success: false, error: `WaDeal not found: ${id}` }
    }

    // --- guard: idempotent ---
    if (waDeal.crm_deal_id != null) {
        return { success: true, crmDealId: waDeal.crm_deal_id }
    }

    // -----------------------------------------------------------------------
    // 2. Find or create the CRM Contact matched by phone
    // -----------------------------------------------------------------------
    const waContact = waDeal.contact
    if (!waContact) {
        return { success: false, error: 'WaDeal has no linked WhatsApp contact' }
    }

    const variants = phoneVariants(waContact.phone)

    let crmContact = await prisma.contact.findFirst({
        where: { phone: { in: variants } },
    })

    if (!crmContact) {
        // Store the canonical UAE number for new CRM contacts.
        const storagePhone = canonicalUaePhone(waContact.phone) ?? waContact.phone.trim()
        crmContact = await prisma.contact.create({
            data: {
                name: waContact.name ?? waContact.phone,
                phone: storagePhone,
                email: waContact.email ?? null,
                source: 'WhatsApp CRM',
            },
        })
    }

    // -----------------------------------------------------------------------
    // 3. Find or create the CRM DealStage matched by WhatsApp stage name
    // -----------------------------------------------------------------------
    const waStageName = waDeal.stage.name.trim()

    // Try case-insensitive match first.
    let allStages = await prisma.dealStage.findMany({ orderBy: { order: 'asc' } })

    let crmStage = allStages.find(
        (s) => s.name.trim().toLowerCase() === waStageName.toLowerCase(),
    ) ?? null

    if (!crmStage) {
        // Fall back to the first non-won, non-lost stage.
        crmStage =
            allStages.find((s) => !s.isWon && !s.isLost) ??
            allStages[0] ??
            null
    }

    if (!crmStage) {
        // No stages exist at all — create a minimal default.
        crmStage = await prisma.dealStage.create({
            data: {
                name: waStageName,
                order: 1,
                isWon: false,
                isLost: false,
            },
        })
    }

    // -----------------------------------------------------------------------
    // 4–6. Create the CRM Deal, write back crm_deal_id (idempotency marker),
    //      and record the audit note — atomically.
    //
    // These three writes MUST commit together. If the Deal were created but
    // the crm_deal_id write-back failed, the idempotency guard above would be
    // bypassed on a retry and a duplicate CRM Deal would be created. A single
    // interactive transaction guarantees all-or-nothing.
    // -----------------------------------------------------------------------
    const crmDeal = await prisma.$transaction(async (tx) => {
        const deal = await tx.deal.create({
            data: {
                contactId: crmContact.id,
                stageId: crmStage.id,
                value: waDeal.value,
                source: 'WhatsApp CRM',
                notes: waDeal.notes ?? null,
            },
        })

        await tx.waDeal.update({
            where: { id },
            data: { crm_deal_id: deal.id },
        })

        await tx.dealActivity.create({
            data: {
                dealId: deal.id,
                type: 'note',
                description: 'Linked from WhatsApp CRM deal',
            },
        })

        return deal
    })

    return { success: true, crmDealId: crmDeal.id }
}
