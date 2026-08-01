import { describe, it, expect } from 'vitest'
import { parseFollowUpIntent } from './follow-up-intent'

const NOW = new Date('2026-01-01T09:00:00Z')
const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000)

describe('parseFollowUpIntent', () => {
    it('matches "call me after N days" with the right offset', () => {
        const r = parseFollowUpIntent('Please call me after 10 days', NOW)
        expect(r.matched).toBe(true)
        expect(r.days).toBe(10)
        expect(daysBetween(r.date!, NOW)).toBe(10)
    })

    it('handles weeks, months, years', () => {
        expect(parseFollowUpIntent('contact me in 2 weeks', NOW).days).toBe(14)
        expect(parseFollowUpIntent('ping me after 3 months', NOW).days).toBe(90)
        expect(parseFollowUpIntent('reach out in 1 year', NOW).days).toBe(365)
    })

    it('handles word numbers and "next" phrases', () => {
        expect(parseFollowUpIntent('call me after two weeks', NOW).days).toBe(14)
        expect(parseFollowUpIntent('contact me next month', NOW).days).toBe(30)
        expect(parseFollowUpIntent('please ping me tomorrow', NOW).days).toBe(1)
        expect(parseFollowUpIntent('message me day after tomorrow', NOW).days).toBe(2)
    })

    it('requires BOTH an intent cue and a timeframe (no false positives)', () => {
        // Timeframe but no contact intent → not a callback request.
        expect(parseFollowUpIntent('the possession is in 2 years', NOW).matched).toBe(false)
        // Intent but no timeframe → cannot schedule.
        expect(parseFollowUpIntent('please call me', NOW).matched).toBe(false)
        // Neither.
        expect(parseFollowUpIntent('what is the price of a 2-bedroom apartment?', NOW).matched).toBe(false)
    })

    it('ignores empty / non-string input', () => {
        expect(parseFollowUpIntent('', NOW).matched).toBe(false)
        // @ts-expect-error testing runtime guard
        expect(parseFollowUpIntent(null, NOW).matched).toBe(false)
    })

    it('caps absurd horizons', () => {
        const r = parseFollowUpIntent('call me after 9999 days', NOW)
        expect(r.matched).toBe(true)
        expect(r.days).toBe(1095)
    })

    it('is case-insensitive', () => {
        expect(parseFollowUpIntent('CALL ME AFTER 5 DAYS', NOW).days).toBe(5)
    })
})
