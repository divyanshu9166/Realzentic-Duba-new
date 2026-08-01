/**
 * Pure, IO-free helpers that turn raw deal facts into the inputs consumed by
 * the deal scorer (`lib/deal-score.ts`).
 *
 * Everything here is deterministic and side-effect free: no database access
 * and no clock reads (callers pass `now`). The server actions in
 * `app/actions/ai-deal-predictor.ts` gather rows from Prisma, hand the plain
 * facts to these helpers, and then call `computeDealScore`. Keeping the
 * derivation pure makes the scoring pipeline trivially unit-testable.
 *
 * Requirements: 17.3 (signals feeding the stored score), 17.6 (days-since
 * activity used by the at-risk classifier).
 */

import type { DealScoreInput, DealSignals } from './deal-score'

/** Milliseconds in a single calendar day. */
export const MS_PER_DAY = 86_400_000
/**
 * Neutral response-time fallback (hours) used when no response time can be
 * derived. Half of the scorer's 24-hour ceiling, i.e. a `0.5` contribution.
 */
export const DEFAULT_RESPONSE_TIME_HOURS = 12
/** Neutral budget-ratio fallback used when the buyer's budget is unknown. */
export const DEFAULT_BUDGET_RATIO = 0.5

/**
 * Quality weights in `[0, 1]` for known acquisition sources. Higher-intent
 * channels (referrals, walk-ins) score higher than cold/aggregated channels.
 * Lookup is case-insensitive and tolerant of separators.
 */
const SOURCE_QUALITY: Record<string, number> = {
    referral: 1,
    walkin: 0.9,
    walk_in: 0.9,
    website: 0.75,
    web: 0.75,
    portal: 0.7,
    facebook: 0.6,
    instagram: 0.6,
    social: 0.6,
    google: 0.6,
    whatsapp: 0.55,
    bayut: 0.75,
    property_finder: 0.75,
    propertyfinder: 0.75,
    dubizzle: 0.65,
    coldcall: 0.3,
    cold_call: 0.3,
    purchased: 0.2,
}

/** Neutral source-quality fallback for unknown/empty sources. */
export const DEFAULT_SOURCE_QUALITY = 0.4

/** Normalize a source label to a lookup key: lowercase, separators stripped. */
function normalizeSourceKey(source: string): string {
    return source.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Map a raw source string to a `[0, 1]` quality weight. Unknown or empty
 * sources fall back to {@link DEFAULT_SOURCE_QUALITY}. The lookup also accepts
 * the de-underscored form (e.g. "walk in" -> "walkin").
 */
export function sourceQuality(source: string | null | undefined): number {
    if (!source) return DEFAULT_SOURCE_QUALITY
    const key = normalizeSourceKey(source)
    if (key in SOURCE_QUALITY) return SOURCE_QUALITY[key]
    const collapsed = key.replace(/_/g, '')
    if (collapsed in SOURCE_QUALITY) return SOURCE_QUALITY[collapsed]
    return DEFAULT_SOURCE_QUALITY
}

/**
 * Parse a free-text AED budget string into a numeric amount.
 *
 * Handles plain numbers, comma grouping, and UAE `K` (×1,000) / `M`
 * (×1,000,000) suffixes, with or without an AED currency marker.
 */
export function parseBudget(budget: string | null | undefined): number | null {
    if (budget == null) return null
    const text = String(budget).trim().toLowerCase()
    if (text.length === 0) return null

    // Extract the first numeric token (allowing decimals and grouping commas).
    const match = text.match(/[\d][\d,]*(\.\d+)?/)
    if (!match) return null

    const base = Number(match[0].replace(/,/g, ''))
    if (!Number.isFinite(base) || base <= 0) return null

    let multiplier = 1
    if (/\d\s*m\b|million/.test(text)) {
        multiplier = 1_000_000
    } else if (/\d\s*k\b|thousand/.test(text)) {
        multiplier = 1_000
    }

    const amount = base * multiplier
    return amount > 0 ? amount : null
}

/**
 * Compute the budget-ratio signal in `[0, 1]`: how much of the buyer's stated
 * budget the deal value consumes. A higher ratio (a deal value approaching the
 * committed budget) scores higher. When the budget is unknown or non-positive,
 * the neutral {@link DEFAULT_BUDGET_RATIO} is returned. The scorer itself
 * clamps the result, so out-of-range inputs are safe.
 */
export function budgetRatio(dealValue: number, budget: number | null | undefined): number {
    if (budget == null || !Number.isFinite(budget) || budget <= 0) return DEFAULT_BUDGET_RATIO
    if (!Number.isFinite(dealValue) || dealValue <= 0) return 0
    return dealValue / budget
}

/**
 * Whole calendar days elapsed from `from` to `to`, never negative. A `null`
 * `from` (no recorded activity) yields `0`. Used both for the score's
 * engagement decay and the at-risk inactivity window.
 */
export function daysBetween(from: Date | null | undefined, to: Date): number {
    if (!from) return 0
    const ms = to.getTime() - from.getTime()
    if (!Number.isFinite(ms) || ms <= 0) return 0
    return Math.floor(ms / MS_PER_DAY)
}

/** Plain, DB-shaped facts about a deal needed to derive scoring signals. */
export interface RawDealData {
    /** Whether a token payment has been recorded against the deal (Req 17.2). */
    hasTokenPayment: boolean
    /** The deal's monetary value. */
    dealValue: number
    /** The deal/contact acquisition source label, if any. */
    source: string | null
    /** The buyer's stated budget in AED, if known (already parsed). */
    budget: number | null
    /** Number of logged site visits for the deal (≥ 0). */
    siteVisits: number
    /** Whether KYC documents have been uploaded for the buyer. */
    kycUploaded: boolean
    /** Whether the buyer has viewed (or been issued) the cost sheet. */
    costSheetViewed: boolean
    /** Derived first-response time in hours, if known; lower is better. */
    responseTimeHours: number | null
    /**
     * Timestamp of the most recent logged activity (call, message, site visit,
     * document upload, or status change), or `null` if none.
     */
    lastActivityAt: Date | null
    /** When the deal was created (floor for "last activity"). */
    createdAt: Date
}

/** The fully-derived inputs the scorer and at-risk classifier consume. */
export interface DerivedScoreInputs {
    deal: DealScoreInput
    signals: DealSignals
    /** Consecutive days with no logged activity, as of `now` (Req 17.6). */
    daysSinceLastActivity: number
}

/**
 * Derive the pure scorer inputs from raw deal facts as of `now`.
 *
 * "Days since engagement" and "days since last activity" are both measured
 * from the most recent activity timestamp (falling back to the deal's creation
 * date when nothing has been logged), so a brand-new deal is treated as freshly
 * engaged rather than stale.
 */
export function deriveScoreInputs(raw: RawDealData, now: Date): DerivedScoreInputs {
    const lastActivity = raw.lastActivityAt ?? raw.createdAt
    const days = daysBetween(lastActivity, now)

    const deal: DealScoreInput = {
        hasTokenPayment: raw.hasTokenPayment,
        daysSinceEngagement: days,
    }

    const signals: DealSignals = {
        siteVisits: Math.max(0, raw.siteVisits),
        responseTimeHours:
            raw.responseTimeHours == null || !Number.isFinite(raw.responseTimeHours)
                ? DEFAULT_RESPONSE_TIME_HOURS
                : Math.max(0, raw.responseTimeHours),
        kycUploaded: raw.kycUploaded,
        budgetRatio: budgetRatio(raw.dealValue, raw.budget),
        sourceQuality: sourceQuality(raw.source),
        costSheetViewed: raw.costSheetViewed,
    }

    return { deal, signals, daysSinceLastActivity: days }
}
