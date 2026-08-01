/**
 * Unit tests for the AI Deal Predictor signal-derivation helpers
 * (`lib/deal-signals.ts`, Task 23.6).
 *
 * Example-based tests covering source-quality mapping, budget parsing, the
 * budget-ratio signal, day counting, and the full derivation into scorer
 * inputs. The numbered design Properties (57–61) are implemented separately as
 * property-based tests in their own tasks.
 */
import { describe, expect, it } from 'vitest'
import {
    DEFAULT_BUDGET_RATIO,
    DEFAULT_RESPONSE_TIME_HOURS,
    DEFAULT_SOURCE_QUALITY,
    budgetRatio,
    daysBetween,
    deriveScoreInputs,
    parseBudget,
    sourceQuality,
    type RawDealData,
} from './deal-signals'

describe('sourceQuality', () => {
    it('maps known high-intent sources to high weights', () => {
        expect(sourceQuality('referral')).toBe(1)
        expect(sourceQuality('Walk-In')).toBe(0.9)
    })

    it('is case- and separator-insensitive', () => {
        expect(sourceQuality('COLD_CALL')).toBe(0.3)
        expect(sourceQuality('cold call')).toBe(0.3)
    })

    it('falls back to the neutral default for unknown/empty sources', () => {
        expect(sourceQuality('carrier-pigeon')).toBe(DEFAULT_SOURCE_QUALITY)
        expect(sourceQuality('')).toBe(DEFAULT_SOURCE_QUALITY)
        expect(sourceQuality(null)).toBe(DEFAULT_SOURCE_QUALITY)
    })
})

describe('parseBudget', () => {
    it('parses plain numbers', () => {
        expect(parseBudget('5000000')).toBe(5_000_000)
    })

    it('parses comma-grouped numbers', () => {
        expect(parseBudget('50,00,000')).toBe(5_000_000)
    })

    it('applies UAE K and M multipliers', () => {
        expect(parseBudget('850K AED')).toBe(850_000)
        expect(parseBudget('1.2M')).toBe(1_200_000)
        expect(parseBudget('AED 2 million')).toBe(2_000_000)
    })

    it('returns null for missing or non-numeric input', () => {
        expect(parseBudget(null)).toBeNull()
        expect(parseBudget('')).toBeNull()
        expect(parseBudget('budget unknown')).toBeNull()
    })
})

describe('budgetRatio', () => {
    it('returns the ratio of deal value to budget', () => {
        expect(budgetRatio(4_000_000, 5_000_000)).toBeCloseTo(0.8, 5)
    })

    it('uses the neutral default when budget is unknown or non-positive', () => {
        expect(budgetRatio(4_000_000, null)).toBe(DEFAULT_BUDGET_RATIO)
        expect(budgetRatio(4_000_000, 0)).toBe(DEFAULT_BUDGET_RATIO)
    })

    it('returns 0 when the deal value is non-positive', () => {
        expect(budgetRatio(0, 5_000_000)).toBe(0)
    })
})

describe('daysBetween', () => {
    it('counts whole days elapsed', () => {
        const from = new Date('2024-01-01T00:00:00Z')
        const to = new Date('2024-01-08T12:00:00Z')
        expect(daysBetween(from, to)).toBe(7)
    })

    it('never returns a negative count', () => {
        const from = new Date('2024-01-10T00:00:00Z')
        const to = new Date('2024-01-01T00:00:00Z')
        expect(daysBetween(from, to)).toBe(0)
    })

    it('returns 0 when there is no prior activity', () => {
        expect(daysBetween(null, new Date())).toBe(0)
    })
})

describe('deriveScoreInputs', () => {
    const now = new Date('2024-02-01T00:00:00Z')

    const baseRaw: RawDealData = {
        hasTokenPayment: false,
        dealValue: 4_000_000,
        source: 'referral',
        budget: 5_000_000,
        siteVisits: 2,
        kycUploaded: true,
        costSheetViewed: true,
        responseTimeHours: 4,
        lastActivityAt: new Date('2024-01-25T00:00:00Z'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
    }

    it('derives signals and days-since-activity from raw facts', () => {
        const { deal, signals, daysSinceLastActivity } = deriveScoreInputs(baseRaw, now)
        expect(deal.hasTokenPayment).toBe(false)
        expect(deal.daysSinceEngagement).toBe(7)
        expect(daysSinceLastActivity).toBe(7)
        expect(signals.siteVisits).toBe(2)
        expect(signals.kycUploaded).toBe(true)
        expect(signals.sourceQuality).toBe(1)
        expect(signals.budgetRatio).toBeCloseTo(0.8, 5)
        expect(signals.responseTimeHours).toBe(4)
    })

    it('falls back to creation date when there is no logged activity', () => {
        const { daysSinceLastActivity } = deriveScoreInputs(
            { ...baseRaw, lastActivityAt: null },
            now,
        )
        // 2024-01-01 -> 2024-02-01 is 31 days.
        expect(daysSinceLastActivity).toBe(31)
    })

    it('uses neutral response time when none is known', () => {
        const { signals } = deriveScoreInputs({ ...baseRaw, responseTimeHours: null }, now)
        expect(signals.responseTimeHours).toBe(DEFAULT_RESPONSE_TIME_HOURS)
    })

    it('clamps negative site visits to zero', () => {
        const { signals } = deriveScoreInputs({ ...baseRaw, siteVisits: -3 }, now)
        expect(signals.siteVisits).toBe(0)
    })
})
