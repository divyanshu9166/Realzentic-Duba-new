import { describe, expect, it } from 'vitest'
import {
  isRecipientNotAllowedError,
  isValidE164,
  normalizePhoneForMetaUae,
  phoneVariants,
  phonesMatch,
  sanitizePhoneForMeta,
  uaePhoneVariants,
} from './phone-utils'

describe('UAE phone normalization', () => {
  it('converts UAE local mobile forms to canonical E.164 digits', () => {
    expect(normalizePhoneForMetaUae('050 123 4567')).toBe('971501234567')
    expect(normalizePhoneForMetaUae('501234567')).toBe('971501234567')
    expect(normalizePhoneForMetaUae('+971 50 123 4567')).toBe('971501234567')
    expect(normalizePhoneForMetaUae('00971 50 123 4567')).toBe('971501234567')
  })

  it('keeps a non-UAE international number as digits without inventing a country code', () => {
    expect(normalizePhoneForMetaUae('+44 20 7946 0018')).toBe('442079460018')
  })

  it('matches UAE local and E.164 forms by their nine-digit subscriber number', () => {
    expect(phonesMatch('050 123 4567', '+971 50 123 4567')).toBe(true)
    expect(phonesMatch('501234567', '971501234567')).toBe(true)
    expect(phonesMatch('0501234567', '0501234568')).toBe(false)
  })

  it('produces canonical, local and +E.164 UAE lookup variants', () => {
    expect(uaePhoneVariants('050 123 4567')).toEqual(expect.arrayContaining([
      '971501234567', '+971501234567', '0501234567', '501234567', '+971501234567',
    ]))
  })
})

describe('generic Meta phone helpers', () => {
  it('sanitizes punctuation and spacing', () => {
    expect(sanitizePhoneForMeta('+971 50 123-4567')).toBe('971501234567')
  })

  it('keeps the generic retry variants deterministic and unique', () => {
    const variants = phoneVariants('971501234567')
    expect(variants[0]).toBe('971501234567')
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('validates E.164-like numbers and common Meta sandbox errors', () => {
    expect(isValidE164('+971501234567')).toBe(true)
    expect(isValidE164('+0501234567')).toBe(false)
    expect(isRecipientNotAllowedError('(#131030) Recipient phone number not in allowed list')).toBe(true)
    expect(isRecipientNotAllowedError('Invalid parameter')).toBe(false)
  })
})
