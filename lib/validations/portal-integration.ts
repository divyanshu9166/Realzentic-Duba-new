import { z } from 'zod'
import { idSchema } from './common'

/**
 * Validation schemas for Module 12 — Property Portal Integration
 * (`app/actions/portal-integration.ts`).
 *
 * These schemas validate the admin-facing PortalConfig management input
 * (Requirement 15.1) before any database write (Requirement 20.4). Inbound
 * webhook payloads are validated separately by the pure
 * `validatePortalPayload` helper in `lib/portal.ts` (Requirement 15.6).
 */

/** A non-empty, trimmed portal name (the unique key on PortalConfig). */
const portalName = z
    .string({ message: 'Portal name is required' })
    .trim()
    .min(1, 'Portal name is required')
    .max(100, 'Portal name must not exceed 100 characters')

/** An optional URL string; blank/whitespace normalizes to undefined. */
const optionalUrl = z
    .string()
    .trim()
    .url('Webhook URL must be a valid URL')
    .optional()
    .or(z.literal('').transform(() => undefined))

/** An optional free-form secret/api key; blank normalizes to undefined. */
const optionalSecret = z
    .string()
    .trim()
    .max(500, 'API key must not exceed 500 characters')
    .optional()
    .or(z.literal('').transform(() => undefined))

/**
 * Create or update a PortalConfig (Requirement 15.1).
 *
 * `portalName` is the unique identifier used for upsert. `enabled` defaults to
 * `false` so a freshly configured portal does not ingest webhooks until it is
 * explicitly turned on (Requirement 15.4).
 */
export const upsertPortalConfigSchema = z.object({
    portalName,
    enabled: z.boolean().optional().default(false),
    apiKey: optionalSecret,
    webhookUrl: optionalUrl,
    listingApiUrl: optionalUrl,
    listingApiKey: optionalSecret,
    autoAssignStaffId: idSchema.optional().nullable(),
})

export type UpsertPortalConfigInput = z.infer<typeof upsertPortalConfigSchema>
