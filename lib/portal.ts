/**
 * Property Portal Integration — PURE helpers (no DB/IO).
 *
 * These functions back Module 12 (Property Portal Integration). They are kept
 * free of any database, clock, or network access so they can be unit- and
 * property-tested in isolation and reused by the
 * `app/actions/portal-integration.ts` server actions and the
 * `app/api/webhooks/portals/[portal]` route handler.
 *
 * Design references:
 *   - `validatePortalPayload(payload)` — pure webhook payload validation.   Req 15.6
 *   - `sourceForPortal(identifier)` — canonical source attribution.         Req 15.5, A7
 *   - Property 54 — invalid webhook payloads create no records.             Req 15.6
 *
 * Source attribution (assumption A7): the first-supported portals are
 * Bayut, Property Finder, and Dubizzle. {@link sourceForPortal} maps a
 * free-form portal identifier (a URL slug, a header value, etc.) to one of the
 * canonical source strings recorded on the created Lead.
 *
 * IMPORTANT (Req 15.6): {@link validatePortalPayload} performs validation only.
 * It NEVER creates records. The caller persists records only when the result
 * is `{ ok: true }`; an `{ ok: false }` result names the offending field so the
 * webhook route can return an error without any downstream writes.
 */

import { normalizePhone } from './dedup'

/** Canonical lead-source string recorded on a Lead created from a portal. */
export type PortalSource = 'Bayut' | 'Property Finder' | 'Dubizzle'

/**
 * The canonical source strings for the first-supported portals (A7), in
 * priority order. Exported so callers can present the supported set.
 */
export const PORTAL_SOURCES: readonly PortalSource[] = [
    'Bayut',
    'Property Finder',
    'Dubizzle',
] as const

/**
 * Map a normalized portal key (lowercase, alphanumeric only) to its canonical
 * source string. Multiple spellings collapse to one key via {@link normalizeKey}.
 */
const PORTAL_KEY_TO_SOURCE: Record<string, PortalSource> = {
    bayut: 'Bayut',
    propertyfinder: 'Property Finder',
    pf: 'Property Finder',
    dubizzle: 'Dubizzle',
}

/**
 * Reduce a portal identifier to a comparison key: lowercased with every
 * non-alphanumeric character removed. This makes `"99-acres"`, `"99 Acres"`,
 * and `"99acres"` all map to `"99acres"`, and `"Housing.com"` to `"housingcom"`.
 */
function normalizeKey(identifier: string): string {
    return identifier.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a free-form portal identifier to its canonical {@link PortalSource}.
 *
 * Accepts any spelling of the supported portals (URL slug, display name, header
 * value) and returns the canonical source string recorded on a created Lead
 * (Req 15.5, A7). Returns `null` when the identifier does not match a supported
 * portal, so the caller can reject or default explicitly.
 *
 * Pure and deterministic.
 */
export function sourceForPortal(identifier: string | null | undefined): PortalSource | null {
    if (!identifier) return null
    const key = normalizeKey(String(identifier))
    if (key === '') return null
    return PORTAL_KEY_TO_SOURCE[key] ?? null
}

/**
 * Raw inbound webhook payload. Fields are intentionally loose (`unknown`)
 * because the data originates from an external, untrusted portal; validation
 * narrows and parses them.
 */
export interface PortalPayload {
    /** Portal-assigned unique inquiry identifier. Required. */
    portalLeadId?: unknown
    /** Buyer's full name. Required. */
    name?: unknown
    /** Buyer's phone number, any human format. Required. */
    phone?: unknown
    /** Buyer's email address. Optional. */
    email?: unknown
    /** Name of the property the buyer inquired about. Optional. */
    propertyName?: unknown
    /** Free-text message from the buyer. Optional. */
    buyerMessage?: unknown
    /** Inquiry timestamp (ISO string, epoch millis, or Date). Optional. */
    inquiryDate?: unknown
    [key: string]: unknown
}

/** Lead fields parsed and normalized from a valid portal payload. */
export interface ParsedPortalLead {
    /** Portal-assigned unique inquiry identifier (trimmed). */
    portalLeadId: string
    /** Buyer's full name (trimmed). */
    name: string
    /** Normalized phone number (digits only, UAE dialing prefixes normalized). */
    phone: string
    /** Lowercased, trimmed email, or `null` when absent. */
    email: string | null
    /** Trimmed property name, or `null` when absent. */
    propertyName: string | null
    /** Trimmed buyer message, or `null` when absent. */
    buyerMessage: string | null
    /** Parsed inquiry date, or `null` when the payload omits it. */
    inquiryDate: Date | null
}

/** Discriminated result of {@link validatePortalPayload}. */
export type PortalValidation =
    | { ok: true; lead: ParsedPortalLead }
    | { ok: false; field: string; error: string }

/** Minimum number of digits a normalized phone number must contain. */
export const MIN_PHONE_DIGITS = 9

/** Email shape check: a non-empty local part, an `@`, and a dotted domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Coerce an unknown value to a trimmed string, or `null` if not a string/number. */
function asTrimmedString(value: unknown): string | null {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return null
}

/**
 * Parse an inquiry-date value into a `Date`.
 *
 * Accepts a `Date`, an epoch-millis `number`, or a parseable date `string`.
 * Returns the parsed `Date`, `null` when the value is absent (`undefined`/`null`/
 * empty string), or the sentinel `false` when a value is present but invalid.
 */
function parseInquiryDate(value: unknown): Date | null | false {
    if (value === undefined || value === null || value === '') return null

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? false : value
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return false
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? false : d
    }
    if (typeof value === 'string') {
        const d = new Date(value.trim())
        return Number.isNaN(d.getTime()) ? false : d
    }
    return false
}

/**
 * Validate and parse an inbound portal webhook payload (Req 15.6).
 *
 * Returns `{ ok: true, lead }` with the normalized lead fields when the payload
 * satisfies every rule below, or `{ ok: false, field, error }` naming the first
 * offending field otherwise. The function is purely decisional and performs no
 * IO: on a failure result the caller MUST create no records (Property 54).
 *
 * Rules:
 *   - the payload itself must be a non-null object (`field: "payload"`);
 *   - `portalLeadId` must be a non-empty string/number (`field: "portalLeadId"`);
 *   - `name` must be a non-empty string (`field: "name"`);
 *   - `phone` must normalize to at least {@link MIN_PHONE_DIGITS} digits
 *     (`field: "phone"`);
 *   - `email`, when present, must match a basic email shape (`field: "email"`);
 *   - `inquiryDate`, when present, must be a valid date (`field: "inquiryDate"`).
 *
 * Optional fields that are absent normalize to `null`; the normalized phone is
 * produced with the shared {@link normalizePhone} helper so it matches the
 * dedup logic used during ingestion.
 */
export function validatePortalPayload(payload: unknown): PortalValidation {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, field: 'payload', error: 'Payload must be a JSON object' }
    }

    const p = payload as PortalPayload

    // portalLeadId — required, non-empty.
    const portalLeadId = asTrimmedString(p.portalLeadId)
    if (portalLeadId === null || portalLeadId === '') {
        return { ok: false, field: 'portalLeadId', error: 'portalLeadId is required' }
    }

    // name — required, non-empty.
    const name = asTrimmedString(p.name)
    if (name === null || name === '') {
        return { ok: false, field: 'name', error: 'name is required' }
    }

    // phone — required, must normalize to enough digits to be dialable.
    const rawPhone = asTrimmedString(p.phone)
    if (rawPhone === null || rawPhone === '') {
        return { ok: false, field: 'phone', error: 'phone is required' }
    }
    const phone = normalizePhone(rawPhone)
    if (phone.length < MIN_PHONE_DIGITS) {
        return {
            ok: false,
            field: 'phone',
            error: `phone must contain at least ${MIN_PHONE_DIGITS} digits`,
        }
    }

    // email — optional; when present it must look like an email.
    let email: string | null = null
    const rawEmail = asTrimmedString(p.email)
    if (rawEmail !== null && rawEmail !== '') {
        const candidate = rawEmail.toLowerCase()
        if (!EMAIL_PATTERN.test(candidate)) {
            return { ok: false, field: 'email', error: 'email is not a valid address' }
        }
        email = candidate
    }

    // inquiryDate — optional; when present it must be a valid date.
    const parsedDate = parseInquiryDate(p.inquiryDate)
    if (parsedDate === false) {
        return { ok: false, field: 'inquiryDate', error: 'inquiryDate is not a valid date' }
    }

    const propertyName = asTrimmedString(p.propertyName)
    const buyerMessage = asTrimmedString(p.buyerMessage)

    return {
        ok: true,
        lead: {
            portalLeadId,
            name,
            phone,
            email,
            propertyName: propertyName === '' ? null : propertyName,
            buyerMessage: buyerMessage === '' ? null : buyerMessage,
            inquiryDate: parsedDate,
        },
    }
}
