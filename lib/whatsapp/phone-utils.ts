/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize UAE mobile numbers for the Meta WhatsApp API.
 * - Strips non-digits
 * - Drops the international prefix (00) when present
 * - Converts local `05XXXXXXXX` and `5XXXXXXXX` to `9715XXXXXXXX`
 * - Keeps already international numbers unchanged
 */
export function normalizePhoneForMetaUae(phone: string): string {
  const sanitized = sanitizePhoneForMeta(phone)
  if (!sanitized) return ''

  let normalized = sanitized.replace(/^00+/, '')

  if (normalized.startsWith('971') && normalized.length >= 12) return normalized
  if (normalized.length === 10 && normalized.startsWith('05')) return `971${normalized.slice(1)}`
  if (normalized.length === 9 && normalized.startsWith('5')) return `971${normalized}`

  return normalized
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for UAE trunk-prefix differences.
 * UAE mobile numbers are compared by their nine-digit subscriber number, so
 * `050 123 4567`, `501234567`, and `+971 50 123 4567` all match.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhoneForMetaUae(phone1)
  const n2 = normalizePhoneForMetaUae(phone2)
  if (n1 === n2) return true
  if (n1.length >= 9 && n2.length >= 9) {
    return n1.slice(-9) === n2.slice(-9)
  }
  return false
}

/**
 * Return all common UAE representations of a mobile number for matching
 * historical CRM and WhatsApp records. The first canonical form is suitable
 * for new records and Meta's API (for example `971501234567`).
 */
export function uaePhoneVariants(phone: string): string[] {
  const raw = phone.trim()
  const canonical = normalizePhoneForMetaUae(phone)
  if (!canonical) return raw ? [raw] : []

  const variants = new Set<string>([raw, canonical, `+${canonical}`])
  if (canonical.startsWith('9715') && canonical.length === 12) {
    const local = canonical.slice(3)
    variants.add(`0${local}`)
    variants.add(local)
    variants.add(`+971${local}`)
  }
  return [...variants].filter(Boolean)
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}

/**
 * Returns true when Meta reports the recipient does not have a
 * WhatsApp account (error code 133010).
 */
export function isRecipientNotRegisteredError(message: string): boolean {
  return /133010|account not registered|not registered/i.test(message)
}

/**
 * Translate a raw Meta API error into a clear, actionable message.
 * Falls back to the original string when no known pattern matches.
 */
export function humanReadableMetaError(rawError: string): string {
  if (/133010|account not registered/i.test(rawError)) {
    return (
      'Your WhatsApp Business phone number is not registered with the Cloud API. ' +
      'Go to WhatsApp Manager → Phone Numbers and check the status — it should say "Connected", not "Pending". ' +
      'You may need to register the number via the API or contact Meta support.'
    )
  }
  if (/131030|not in allowed list|not in the allowed list/i.test(rawError)) {
    return (
      'The recipient phone number is not in your sandbox allowed list. ' +
      'Add the number in Meta App Dashboard → WhatsApp → API Setup → allowed numbers, or upgrade to a production account.'
    )
  }
  if (/131047|re-engagement message|24.hour/i.test(rawError)) {
    return (
      'The 24-hour customer service window has closed. ' +
      'You can only send a pre-approved template message outside the window.'
    )
  }
  if (/132000|template.*not found|could not find template/i.test(rawError)) {
    return (
      'The message template was not found. Sync your templates in WhatsApp Marketing → Settings, ' +
      'and make sure the template is approved in WhatsApp Manager.'
    )
  }
  if (/190|access.token|OAuthException/i.test(rawError)) {
    return (
      'Your WhatsApp access token is invalid or expired. ' +
      'Update it in WhatsApp Marketing → Settings.'
    )
  }
  return rawError
}
