'use server'

/**
 * app/actions/lead-qualification.ts
 *
 * Server action: given a WaContact ID and their first inbound message text,
 * qualify the lead with Groq and update the matching CRM Lead record.
 *
 * Contract:
 * - Never throws to the caller — all errors are caught and returned as
 *   { success: false }.
 * - If GROQ_API_KEY is absent, returns success:true / updated:false silently.
 * - Appends to lead.notes (never overwrites).
 * - Updates lead.interest and lead.budget only when the existing value is
 *   empty/null and the qualifier extracted something non-null.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { normalizePhoneForMetaUae, phonesMatch, uaePhoneVariants } from '@/lib/whatsapp/phone-utils'
import {
    qualifyLeadFromMessage,
    type QualificationResult,
} from '@/lib/lead-qualification'
import { getGroqApiKey } from '@/lib/ai-agent/groq'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NULL_RESULT: QualificationResult = {
    budget: null,
    propertyType: null,
    location: null,
    purpose: null,
    possession: null,
    confidence: 'low',
}

function isAllNull(result: QualificationResult): boolean {
    return (
        result.budget === null &&
        result.propertyType === null &&
        result.location === null &&
        result.purpose === null &&
        result.possession === null
    )
}

/**
 * Normalize a UAE phone string to the nine-digit local subscriber number.
 * Returns null when the input is empty or produces fewer than 7 digits
 * (too short to be a valid mobile number).
 */
function localUaeMobile(phone: string): string | null {
    const canonical = normalizePhoneForMetaUae(phone)
    if (!canonical.startsWith('9715') || canonical.length !== 12) return null
    return canonical.slice(3)
}

/**
 * Build a human-readable addendum summarising the extracted fields.
 * Only non-null values are included.
 */
function buildNotesAddendum(result: QualificationResult): string {
    const lines: string[] = ['[Auto-qualification from WhatsApp message]']

    if (result.budget) lines.push(`  Budget: ${result.budget}`)
    if (result.propertyType) lines.push(`  Property Type: ${result.propertyType}`)
    if (result.location) lines.push(`  Location: ${result.location}`)
    if (result.purpose) lines.push(`  Purpose: ${result.purpose}`)
    if (result.possession) lines.push(`  Possession: ${result.possession}`)
    lines.push(`  Confidence: ${result.confidence}`)

    return lines.join('\n')
}

// ─── Main action ─────────────────────────────────────────────────────────────

export async function autoQualifyLeadFromWhatsApp(
    waContactId: string,
    messageText: string
): Promise<{ success: boolean; updated: boolean; result: QualificationResult }> {
    // Guard: if GROQ_API_KEY isn't configured, skip silently.
    try {
        getGroqApiKey()
    } catch {
        return { success: true, updated: false, result: { ...NULL_RESULT } }
    }

    try {
        // 1. Run the LLM qualifier.
        const result = await qualifyLeadFromMessage(messageText)

        // 2. Skip if confidence is low AND every field is null — nothing to persist.
        if (result.confidence === 'low' && isAllNull(result)) {
            return { success: true, updated: false, result }
        }

        // 3. Load the WaContact to get its phone number.
        const waContact = await prisma.waContact.findUnique({
            where: { id: waContactId },
            select: { phone: true },
        })

        if (!waContact?.phone) {
            return { success: true, updated: false, result }
        }

        // 4. Find the matching CRM Contact by phone.
        //    Search common UAE local and E.164 representations.
        const localPhone = localUaeMobile(waContact.phone)
        if (!localPhone) {
            return { success: true, updated: false, result }
        }
        const phoneVariants = uaePhoneVariants(waContact.phone)

        const candidates = await prisma.contact.findMany({
            where: {
                OR: [
                    ...phoneVariants.map((phone) => ({ phone: { contains: phone } })),
                    { phone: { contains: localPhone } },
                ],
            },
            select: { id: true, phone: true },
            take: 10,
        })

        // Resolve to the best match using the existing phonesMatch utility.
        const crmContact = candidates.find(
            (c) =>
                phonesMatch(c.phone, waContact.phone) ||
                phonesMatch(c.phone, localPhone)
        )

        if (!crmContact) {
            return { success: true, updated: false, result }
        }

        // 5. Find the most recent CRM Lead for this contact.
        const lead = await prisma.lead.findFirst({
            where: { contactId: crmContact.id },
            orderBy: { date: 'desc' },
            select: { id: true, notes: true, interest: true, budget: true },
        })

        if (!lead) {
            return { success: true, updated: false, result }
        }

        // 6. Build and apply the update — never overwrite existing data.
        const addendum = buildNotesAddendum(result)
        const separator = lead.notes ? '\n\n' : ''
        const updatedNotes = `${lead.notes ?? ''}${separator}${addendum}`

        const dataToUpdate: {
            notes: string
            interest?: string
            budget?: string
        } = { notes: updatedNotes }

        if (result.propertyType && !lead.interest?.trim()) {
            dataToUpdate.interest = result.propertyType
        }

        if (result.budget && !lead.budget?.trim()) {
            dataToUpdate.budget = result.budget
        }

        await prisma.lead.update({
            where: { id: lead.id },
            data: dataToUpdate,
        })

        revalidatePath('/leads')

        return { success: true, updated: true, result }
    } catch (err) {
        console.error('[autoQualifyLeadFromWhatsApp] unexpected error:', err)
        return { success: false, updated: false, result: { ...NULL_RESULT } }
    }
}
