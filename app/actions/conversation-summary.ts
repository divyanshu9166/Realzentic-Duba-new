'use server'

/**
 * app/actions/conversation-summary.ts
 *
 * Server action: summarise a CRM contact's WhatsApp conversation using Groq.
 *
 * Logic:
 *  1. Load the CRM Contact.phone from DB.
 *  2. Find the matching WaContact by phone (tries exact, +971 prefix, without-91 prefix).
 *  3. Load the last 40 WaMessages via WaConversation, ordered asc.
 *  4. Build a compact transcript (skip empty / template messages).
 *  5. Call Groq with a structured JSON prompt.
 *  6. Parse the response and return it — NEVER throws.
 */

import { prisma } from '@/lib/db'
import { groqChat } from '@/lib/ai-agent/groq'
import { uaePhoneVariants } from '@/lib/whatsapp/phone-utils'

// ─── Public result type ──────────────────────────────────────────────────────

export interface ConversationSummaryResult {
    /** 3-5 sentence plain-text summary of the conversation. */
    summary: string
    keyFacts: {
        budget: string | null
        propertyType: string | null
        location: string | null
        /** Overall buyer sentiment derived from the conversation. */
        sentiment: 'positive' | 'neutral' | 'negative'
        /** Suggested or agreed next step. */
        nextStep: string | null
    }
    /** Number of messages included in the transcript. */
    messageCount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the candidate phone strings to try when looking up a WaContact.
 * WhatsApp and the CRM can store UAE numbers locally or in E.164 form.
 */
function phoneVariants(phone: string): string[] {
    return uaePhoneVariants(phone)
}

// ─── Server action ────────────────────────────────────────────────────────────

/**
 * Summarise the WhatsApp conversation for a CRM contact.
 *
 * @param contactCrmId The `Contact.id` from the CRM database.
 */
export async function summarizeWaConversation(
    contactCrmId: number,
): Promise<{ success: boolean; data?: ConversationSummaryResult; error?: string }> {
    // ── Guardrail: Groq API key must be configured ───────────────────────────
    if (!process.env.GROQ_API_KEY?.trim()) {
        return { success: false, error: 'AI not configured' }
    }

    // ── 1. Load CRM contact phone ────────────────────────────────────────────
    let crmPhone: string | null = null
    try {
        const contact = await prisma.contact.findUnique({
            where: { id: contactCrmId },
            select: { phone: true },
        })
        if (!contact) {
            return { success: false, error: 'Contact not found' }
        }
        crmPhone = contact.phone ?? null
    } catch {
        return { success: false, error: 'Failed to load contact' }
    }

    if (!crmPhone) {
        return { success: false, error: 'No WhatsApp conversation found' }
    }

    // ── 2. Find WaContact by phone (try multiple variants) ───────────────────
    let waContact: { id: string } | null = null
    try {
        const candidates = phoneVariants(crmPhone)
        waContact = await prisma.waContact.findFirst({
            where: { phone: { in: candidates } },
            select: { id: true },
        })
    } catch {
        return { success: false, error: 'Failed to look up WhatsApp contact' }
    }

    if (!waContact) {
        return { success: false, error: 'No WhatsApp conversation found' }
    }

    // ── 3. Load the WaConversation and the last 40 messages ──────────────────
    let messages: Array<{
        sender_type: string
        content_text: string | null
        template_name: string | null
        content_type: string
        created_at: Date
    }> = []

    try {
        const conversation = await prisma.waConversation.findFirst({
            where: { contact_id: waContact.id },
            select: { id: true },
            orderBy: { updated_at: 'desc' },
        })

        if (!conversation) {
            return { success: false, error: 'No WhatsApp conversation found' }
        }

        messages = await prisma.waMessage.findMany({
            where: { conversation_id: conversation.id },
            orderBy: { created_at: 'asc' },
            take: 40,
            select: {
                sender_type: true,
                content_text: true,
                template_name: true,
                content_type: true,
                created_at: true,
            },
        })
    } catch {
        return { success: false, error: 'Failed to load conversation messages' }
    }

    // ── 4. Build compact transcript ──────────────────────────────────────────
    const transcriptLines: string[] = []

    for (const msg of messages) {
        // Skip template messages and messages with no text
        const text = msg.content_text?.trim()
        if (!text || msg.template_name) continue

        const role = msg.sender_type === 'customer' ? 'Customer' : 'Agent'
        transcriptLines.push(`[${role}] ${text}`)
    }

    if (transcriptLines.length === 0) {
        return { success: false, error: 'No messages to summarize' }
    }

    const transcript = transcriptLines.join('\n')
    const messageCount = transcriptLines.length

    // ── 5–6. Call Groq and parse ─────────────────────────────────────────────
    const systemPrompt = `You are a real estate CRM assistant. Analyse the WhatsApp conversation transcript and return a JSON object — nothing else. The JSON must follow this exact shape:
{
  "summary": "3-5 sentence plain-text summary of what was discussed",
  "keyFacts": {
    "budget": "budget as a string or null if unknown",
    "propertyType": "property type or null if unknown",
    "location": "preferred location or null if unknown",
    "sentiment": "positive | neutral | negative",
    "nextStep": "next step or null if unclear"
  }
}
Rules:
- summary must be 3–5 sentences, plain text, no markdown
- sentiment must be exactly one of: positive, neutral, negative
- null (not the string "null") for unknown fields
- Do NOT include any text outside the JSON object`

    const userPrompt = `Transcript:\n${transcript}`

    let rawResponse = ''
    try {
        rawResponse = await groqChat({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            maxTokens: 300,
            temperature: 0.2,
        })
    } catch {
        return { success: false, error: 'AI summary unavailable' }
    }

    // ── 7. Parse JSON from Groq response ─────────────────────────────────────
    try {
        // Strip possible markdown code fences
        const cleaned = rawResponse
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim()

        const parsed = JSON.parse(cleaned) as {
            summary: string
            keyFacts: {
                budget: string | null
                propertyType: string | null
                location: string | null
                sentiment: string
                nextStep: string | null
            }
        }

        // Validate sentiment — fall back to neutral if Groq returns something unexpected
        const validSentiments = ['positive', 'neutral', 'negative'] as const
        const sentiment = validSentiments.includes(
            parsed.keyFacts?.sentiment as (typeof validSentiments)[number],
        )
            ? (parsed.keyFacts.sentiment as 'positive' | 'neutral' | 'negative')
            : 'neutral'

        const result: ConversationSummaryResult = {
            summary: String(parsed.summary ?? '').trim(),
            keyFacts: {
                budget: parsed.keyFacts?.budget ? String(parsed.keyFacts.budget) : null,
                propertyType: parsed.keyFacts?.propertyType
                    ? String(parsed.keyFacts.propertyType)
                    : null,
                location: parsed.keyFacts?.location ? String(parsed.keyFacts.location) : null,
                sentiment,
                nextStep: parsed.keyFacts?.nextStep ? String(parsed.keyFacts.nextStep) : null,
            },
            messageCount,
        }

        return { success: true, data: result }
    } catch {
        return { success: false, error: 'AI summary unavailable' }
    }
}
