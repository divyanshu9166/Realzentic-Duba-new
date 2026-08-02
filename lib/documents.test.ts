/**
 * Unit tests for the Document Management & KYC pure helpers
 * (`lib/documents.ts`, Task 12.1).
 *
 * These are example-based unit tests covering core behaviour and edge cases.
 * The numbered design Properties (33–35) are implemented separately as
 * property-based tests in their own tasks.
 */
import { describe, expect, it } from 'vitest'
import {
    DEFAULT_EXPIRY_WINDOW_DAYS,
    MAX_UPLOAD_BYTES,
    MIN_UPLOAD_BYTES,
    daysUntilExpiry,
    extractMergeFields,
    isAllowedMimeType,
    isWithinExpiryWindow,
    resolveMergeFields,
    validateUpload,
} from './documents'

describe('validateUpload', () => {
    it('accepts a file within size bounds and an allowed type', () => {
        expect(validateUpload(1024, 'application/pdf')).toEqual({ ok: true })
    })

    it('accepts the minimum (1 byte) and maximum (25 MB) sizes', () => {
        expect(validateUpload(MIN_UPLOAD_BYTES, 'image/png').ok).toBe(true)
        expect(validateUpload(MAX_UPLOAD_BYTES, 'image/png').ok).toBe(true)
    })

    it('rejects a zero-byte (empty) file', () => {
        expect(validateUpload(0, 'application/pdf')).toEqual({
            ok: false,
            reason: 'EMPTY_FILE',
        })
    })

    it('rejects a file that exceeds 25 MB', () => {
        expect(validateUpload(MAX_UPLOAD_BYTES + 1, 'application/pdf')).toEqual({
            ok: false,
            reason: 'TOO_LARGE',
        })
    })

    it('rejects a disallowed MIME type', () => {
        expect(validateUpload(1024, 'application/x-msdownload')).toEqual({
            ok: false,
            reason: 'DISALLOWED_TYPE',
        })
    })

    it('rejects a non-finite size', () => {
        expect(validateUpload(Number.NaN, 'application/pdf')).toEqual({
            ok: false,
            reason: 'INVALID_SIZE',
        })
    })

    it('checks size before type (oversized + bad type reports size)', () => {
        expect(validateUpload(MAX_UPLOAD_BYTES + 1, 'application/x-msdownload')).toEqual({
            ok: false,
            reason: 'TOO_LARGE',
        })
    })
})

describe('isAllowedMimeType', () => {
    it('is case-insensitive and trims whitespace', () => {
        expect(isAllowedMimeType('  APPLICATION/PDF  ')).toBe(true)
    })

    it('rejects unknown types and non-strings', () => {
        expect(isAllowedMimeType('application/zip')).toBe(false)
        // @ts-expect-error exercising runtime guard for non-string input
        expect(isAllowedMimeType(undefined)).toBe(false)
    })
})

describe('extractMergeFields', () => {
    it('extracts distinct trimmed field names in first-seen order', () => {
        const body = 'Dear {{ name }}, your unit {{unit}} is ready. Thanks {{ name }}.'
        expect(extractMergeFields(body)).toEqual(['name', 'unit'])
    })

    it('returns an empty list when there are no placeholders', () => {
        expect(extractMergeFields('No placeholders here.')).toEqual([])
        expect(extractMergeFields('')).toEqual([])
    })
})

describe('resolveMergeFields', () => {
    it('resolves when every field has a value and substitutes them', () => {
        const result = resolveMergeFields('Hello {{name}} from {{city}}', {
            name: 'Asha',
            city: 'Dubai',
        })
        expect(result.ok).toBe(true)
        expect(result.resolved).toBe('Hello Asha from Dubai')
        expect(result.missing).toBeUndefined()
    })

    it('reports missing fields and does not substitute', () => {
        const result = resolveMergeFields('Hello {{name}} from {{city}}', {
            name: 'Asha',
        })
        expect(result.ok).toBe(false)
        expect(result.missing).toEqual(['city'])
        expect(result.resolved).toBeUndefined()
    })

    it('treats null/undefined values as unresolved', () => {
        const result = resolveMergeFields('{{a}}{{b}}', { a: null, b: undefined })
        expect(result.ok).toBe(false)
        expect(result.missing).toEqual(['a', 'b'])
    })

    it('stringifies non-string values and accepts empty/zero/false', () => {
        const result = resolveMergeFields('{{count}} {{flag}} {{note}}', {
            count: 0,
            flag: false,
            note: '',
        })
        expect(result.ok).toBe(true)
        expect(result.resolved).toBe('0 false ')
    })

    it('succeeds trivially for a body with no placeholders', () => {
        expect(resolveMergeFields('static body', {})).toEqual({
            ok: true,
            resolved: 'static body',
        })
    })

    it('tolerates a null value map', () => {
        expect(resolveMergeFields('{{x}}', null).ok).toBe(false)
    })
})

describe('daysUntilExpiry', () => {
    it('is zero on the expiry day, positive before, negative after', () => {
        const now = new Date('2024-06-10T12:00:00Z')
        expect(daysUntilExpiry(new Date('2024-06-10T01:00:00Z'), now)).toBe(0)
        expect(daysUntilExpiry(new Date('2024-06-15T00:00:00Z'), now)).toBe(5)
        expect(daysUntilExpiry(new Date('2024-06-05T00:00:00Z'), now)).toBe(-5)
    })
})

describe('isWithinExpiryWindow', () => {
    const now = new Date('2024-06-10T00:00:00Z')

    it('shows an alert when expiry is within the window', () => {
        expect(isWithinExpiryWindow(new Date('2024-06-20T00:00:00Z'), now, 30)).toBe(true)
    })

    it('shows an alert on the day of expiry (0 days)', () => {
        expect(isWithinExpiryWindow(new Date('2024-06-10T00:00:00Z'), now, 30)).toBe(true)
    })

    it('shows an alert exactly at the window boundary', () => {
        expect(isWithinExpiryWindow(new Date('2024-07-10T00:00:00Z'), now, 30)).toBe(true)
    })

    it('does not alert beyond the window', () => {
        expect(isWithinExpiryWindow(new Date('2024-07-11T00:00:00Z'), now, 30)).toBe(false)
    })

    it('does not alert for already-expired documents', () => {
        expect(isWithinExpiryWindow(new Date('2024-06-09T00:00:00Z'), now, 30)).toBe(false)
    })

    it('defaults to a 30-day window', () => {
        const within = new Date(now.getTime() + DEFAULT_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        expect(isWithinExpiryWindow(within, now)).toBe(true)
    })

    it('throws for an out-of-range window', () => {
        expect(() => isWithinExpiryWindow(now, now, 0)).toThrow()
        expect(() => isWithinExpiryWindow(now, now, 366)).toThrow()
        expect(() => isWithinExpiryWindow(now, now, 1.5)).toThrow()
    })
})
