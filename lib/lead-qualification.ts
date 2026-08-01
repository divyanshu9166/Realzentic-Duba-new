/**
 * lib/lead-qualification.ts
 *
 * Pure helper that calls Groq to extract real-estate purchase intent from a
 * free-form WhatsApp message and returns it as structured JSON.
 *
 * Designed to be side-effect-free — no DB writes, no revalidation.
 * Never throws; always resolves with a valid QualificationResult.
 */

import { groqChat, getGroqApiKey } from '@/lib/ai-agent/groq'

export interface QualificationResult {
    budget: string | null          // e.g. "1.5M AED" or null
    propertyType: string | null    // e.g. "2 Bedroom Apartment", "Villa" or null
    location: string | null        // e.g. "Dubai Marina", "JVC" or null
    purpose: 'End Use' | 'Investment' | 'Both' | null
    possession: string | null      // e.g. "Ready to Move", "Within 6 months"
    confidence: 'high' | 'medium' | 'low'
}

const NULL_RESULT: QualificationResult = {
    budget: null,
    propertyType: null,
    location: null,
    purpose: null,
    possession: null,
    confidence: 'low',
}

const EXPECTED_KEYS: Array<keyof QualificationResult> = [
    'budget',
    'propertyType',
    'location',
    'purpose',
    'possession',
    'confidence',
]

const VALID_PURPOSES = new Set(['End Use', 'Investment', 'Both', null])
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low'])

function isValidResult(obj: unknown): obj is QualificationResult {
    if (!obj || typeof obj !== 'object') return false
    const record = obj as Record<string, unknown>

    // Every expected key must be present
    for (const key of EXPECTED_KEYS) {
        if (!(key in record)) return false
    }

    if (!VALID_PURPOSES.has(record.purpose as any)) return false
    if (!VALID_CONFIDENCE.has(record.confidence as string)) return false

    return true
}

const SYSTEM_PROMPT = `You are a real-estate lead qualification assistant.
Your ONLY job is to extract structured information from a customer's WhatsApp message.
Return ONLY a single valid JSON object — no markdown, no explanation, no extra text.

Required JSON schema (use null for any field you cannot determine):
{
  "budget": "<amount as a string, e.g. '850K AED', '1.5M AED'> | null",
  "propertyType": "<type as a string, e.g. 'Studio', '2 Bedroom Apartment', 'Villa', 'Land'> | null",
  "location": "<Dubai community or emirate, e.g. 'Dubai Marina', 'Business Bay', 'JVC'> | null",
  "purpose": "'End Use' | 'Investment' | 'Both' | null",
  "possession": "<timeline, e.g. 'Ready to Move', 'Within 6 months', 'Within 2 years'> | null",
  "confidence": "'high' | 'medium' | 'low'"
}

Confidence rules:
- 'high'   → 3 or more non-null fields extracted
- 'medium' → 1–2 non-null fields extracted
- 'low'    → no meaningful real-estate information found

Example output for "Hi, I'm looking for a 3-bedroom apartment in Dubai Marina under AED 2.8M for self-use":
{"budget":"2.8M AED","propertyType":"3 Bedroom Apartment","location":"Dubai Marina","purpose":"End Use","possession":null,"confidence":"high"}`

/**
 * Parse a customer's first WhatsApp message and return structured
 * real-estate qualification data.
 *
 * @param messageText - Raw inbound text from the customer.
 * @returns A QualificationResult — never throws, never rejects.
 */
export async function qualifyLeadFromMessage(
    messageText: string
): Promise<QualificationResult> {
    // Guard: empty or whitespace-only messages contain no signal.
    if (!messageText?.trim()) {
        return { ...NULL_RESULT }
    }

    // Guard: GROQ_API_KEY must be present — check cheaply before hitting network.
    try {
        getGroqApiKey()
    } catch {
        return { ...NULL_RESULT }
    }

    let raw = ''

    try {
        raw = await groqChat({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: messageText.trim() },
            ],
            maxTokens: 150,
            temperature: 0.1,
        })
    } catch (err) {
        console.error('[lead-qualification] Groq API error:', err)
        return { ...NULL_RESULT }
    }

    // Strip accidental markdown fences the model may emit despite instructions
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: unknown
    try {
        parsed = JSON.parse(cleaned)
    } catch {
        console.warn('[lead-qualification] JSON.parse failed, raw response:', raw)
        return { ...NULL_RESULT }
    }

    if (!isValidResult(parsed)) {
        console.warn('[lead-qualification] Unexpected JSON shape:', parsed)
        return { ...NULL_RESULT }
    }

    return parsed
}
