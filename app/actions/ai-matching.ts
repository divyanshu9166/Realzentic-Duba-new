'use server'

/**
 * AI_Matching_Service — server actions for Module 13 (AI Property Matching).
 *
 * This file is the IO/DB boundary for property matching. The scoring math is
 * delegated entirely to the pure, property-tested helpers in `lib/matching.ts`
 * (`scoreMatch`, `matchUnits`, `filterAvailable`) so the contract that match
 * percentages are bounded in `[0, 100]` and ranked non-increasingly
 * (design Properties 55 & 56) holds here too.
 *
 * Actions:
 *   - `matchUnits(preferences)` — rank the live, **Available-only** inventory
 *     (Req 16.2) against a buyer's preferences, returning each unit with its
 *     match percentage in non-increasing order (Req 16.1).
 *   - `notifyMatchingAgents(unitId)` — invoked when a new unit is added to
 *     inventory: find open buyers whose (derived) preferences match the unit
 *     and notify the agents linked to those buyers (Req 16.3).
 *
 * Conventions (match the existing `app/actions/*.ts` style):
 *   - `'use server'` module with async server actions.
 *   - Prisma client imported from `@/lib/db`.
 *   - Every action returns a `Result<T>` discriminated union
 *     (`{ success: true, data }` or `{ success: false, error }`).
 *   - Inputs are validated with Zod before any work.
 *
 * Requirements: 16.1, 16.2, 16.3
 */

import { z } from 'zod'

import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { idSchema } from '@/lib/validations/common'
import { buyerPreferencesSchema } from '@/lib/validations/ai-matching'
import type { UnitType } from '@/lib/inventory'
import {
    matchUnits as rankAvailableMatches,
    scoreMatch,
    type BuyerPreferences,
    type MatchableUnit,
    type MatchResult,
} from '@/lib/matching'

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

/** Standard server-action result shape used across the matching service. */
export type Result<T> =
    | { success: true; data: T }
    | { success: false; error: string }

/**
 * Minimum match percentage at which an agent is alerted about a buyer for a
 * newly-added unit (Req 16.3). Below this the match is too weak to be worth a
 * proactive notification.
 */
const NOTIFY_MATCH_THRESHOLD = 60

/** Pull the first Zod issue message (which names the offending field). */
function firstIssue(error: z.ZodError): string {
    return error.issues[0]?.message ?? 'Invalid input'
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message
    return fallback
}

// ---------------------------------------------------------------------------
// Unit loading / mapping
// ---------------------------------------------------------------------------

/** A scorable unit: the pure {@link MatchableUnit} plus display/identity fields. */
type ScorableUnit = MatchableUnit & {
    id: number
    towerId: number
    unitNumber: string
    superBuiltUpArea: number
    projectName: string
}

/** The Prisma `select` shared by both actions when loading a unit's match context. */
const unitMatchSelect = {
    id: true,
    towerId: true,
    floorNumber: true,
    unitNumber: true,
    type: true,
    carpetArea: true,
    superBuiltUpArea: true,
    facing: true,
    status: true,
    totalPrice: true,
    tower: {
        select: {
            projectId: true,
            project: { select: { name: true, location: true, amenities: true } },
        },
    },
} as const

type LoadedUnit = {
    id: number
    towerId: number
    floorNumber: number
    unitNumber: string
    type: ScorableUnit['type']
    carpetArea: number
    superBuiltUpArea: number
    facing: ScorableUnit['facing']
    status: ScorableUnit['status']
    totalPrice: unknown
    tower: {
        projectId: number
        project: { name: string; location: string; amenities: string[] } | null
    }
}

/**
 * Map a Prisma unit row (loaded with {@link unitMatchSelect}) to the
 * {@link ScorableUnit} shape the pure scorer consumes. Project-derived fields
 * (`projectId`, `location`, `amenities`) come from the unit's parent project.
 */
function toScorableUnit(unit: LoadedUnit): ScorableUnit {
    const project = unit.tower.project
    return {
        id: unit.id,
        towerId: unit.towerId,
        unitNumber: unit.unitNumber,
        superBuiltUpArea: unit.superBuiltUpArea,
        projectName: project?.name ?? '',
        status: unit.status,
        type: unit.type,
        facing: unit.facing,
        floorNumber: unit.floorNumber,
        carpetArea: unit.carpetArea,
        totalPrice: Number(unit.totalPrice),
        projectId: unit.tower.projectId,
        location: project?.location,
        amenities: project?.amenities ?? [],
    }
}

// ---------------------------------------------------------------------------
// Req 16.1 / 16.2 — matchUnits(preferences)
// ---------------------------------------------------------------------------

/** A matched unit returned to the UI: the scored unit and its match percentage. */
export interface MatchedUnit {
    id: number
    towerId: number
    unitNumber: string
    type: UnitType
    facing: ScorableUnit['facing']
    floorNumber: number
    carpetArea: number
    superBuiltUpArea: number
    totalPrice: number
    projectId?: number
    projectName: string
    location?: string
    amenities: string[]
    matchPercentage: number
}

/**
 * Produce a ranked list of **Available-only** units for a buyer's preferences
 * (Req 16.1, 16.2).
 *
 * Loads the live inventory together with each unit's parent-project context
 * (project id, location, amenities), then delegates to the pure
 * `matchUnits` helper, which filters to Available units (design Property 56)
 * and returns them ordered by non-increasing match percentage (design
 * Property 55). Each result carries an integer `matchPercentage` in `[0, 100]`.
 */
export async function matchUnits(preferences: unknown): Promise<Result<MatchedUnit[]>> {
    const parsed = buyerPreferencesSchema.safeParse(preferences ?? {})
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    // The Zod-validated preferences are structurally compatible with the pure
    // `BuyerPreferences` contract consumed by the scorer.
    const prefs = parsed.data as BuyerPreferences

    try {
        const units = await prisma.unit.findMany({ select: unitMatchSelect })
        const scorable = units.map((u) => toScorableUnit(u as unknown as LoadedUnit))

        const ranked: MatchResult<ScorableUnit>[] = rankAvailableMatches(prefs, scorable)

        const data: MatchedUnit[] = ranked.map(({ unit, matchPercentage }) => ({
            id: unit.id,
            towerId: unit.towerId,
            unitNumber: unit.unitNumber,
            type: unit.type,
            facing: unit.facing,
            floorNumber: unit.floorNumber,
            carpetArea: unit.carpetArea,
            superBuiltUpArea: unit.superBuiltUpArea,
            totalPrice: unit.totalPrice,
            projectId: unit.projectId,
            projectName: unit.projectName,
            location: unit.location,
            amenities: unit.amenities ?? [],
            matchPercentage,
        }))

        return { success: true, data }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to match units') }
    }
}

// ---------------------------------------------------------------------------
// Req 16.3 — notifyMatchingAgents(unitId) on new inventory
// ---------------------------------------------------------------------------

/** The lead statuses that represent an open, still-pursuable buyer. */
const OPEN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'SHOWROOM_VISIT', 'QUOTATION'] as const

/** Summary returned by {@link notifyMatchingAgents}. */
export interface NotifyMatchingAgentsResult {
    unitId: number
    /** Number of distinct agents notified. */
    notifiedAgentCount: number
    /** Number of buyer leads whose derived preferences matched the unit. */
    matchedBuyerCount: number
}

/**
 * Derive coarse {@link BuyerPreferences} from a lead's stored free-text fields
 * (`budget`, `interest`). Returns `null` when nothing usable can be derived, so
 * leads with no expressed preference do NOT vacuously match every unit.
 *
 * Heuristics (intentionally conservative):
 *   - Budget: a single figure is treated as a price ceiling (`maxBudget`); a
 *     range yields both bounds. UAE `K` and `M` price suffixes are scaled.
 *   - Interest: bedroom, villa, townhouse and commercial keywords map to unit types.
 */
function preferencesFromLead(lead: { budget: string | null; interest: string | null }): BuyerPreferences | null {
    const prefs: BuyerPreferences = {}

    const budget = parseBudgetToRange(lead.budget)
    if (budget.minBudget !== undefined) prefs.minBudget = budget.minBudget
    if (budget.maxBudget !== undefined) prefs.maxBudget = budget.maxBudget

    const types = interestToUnitTypes(lead.interest)
    if (types.length > 0) prefs.type = types

    const active =
        prefs.minBudget !== undefined ||
        prefs.maxBudget !== undefined ||
        (Array.isArray(prefs.type) && prefs.type.length > 0)

    return active ? prefs : null
}

/** Parse a free-text AED budget string into an inclusive range. */
function parseBudgetToRange(budget: string | null): { minBudget?: number; maxBudget?: number } {
    if (!budget) return {}
    const cleaned = budget.toLowerCase().replace(/,/g, '')

    const numbers = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*([km])?\b/g)]
        .map((match) => {
            const value = Number(match[1])
            const suffix = match[2]
            const scale = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
            return value * scale
        })
        .filter((n) => Number.isFinite(n) && n > 0)

    if (numbers.length === 0) return {}
    if (numbers.length === 1) return { maxBudget: numbers[0] }
    return { minBudget: Math.min(...numbers), maxBudget: Math.max(...numbers) }
}

/** Map a lead's free-text interest to the unit type(s) it mentions. */
function interestToUnitTypes(interest: string | null): UnitType[] {
    if (!interest) return []
    const text = interest.toLowerCase()
    const types: UnitType[] = []

    const homes: Array<[RegExp, UnitType]> = [
        [/\bstudio\b/, 'Studio'],
        [/\b1\s*(?:bed(?:room)?|br)\b/, 'Apartment1'],
        [/\b2\s*(?:bed(?:room)?|br)\b/, 'Apartment2'],
        [/\b3\s*(?:bed(?:room)?|br)\b/, 'Apartment3'],
        [/\b(?:4|4\+)\s*(?:bed(?:room)?|br)\b/, 'Apartment4Plus'],
    ]
    for (const [re, type] of homes) if (re.test(text)) types.push(type)

    if (/\bpenthouse\b/.test(text)) types.push('Penthouse')
    if (/\bvilla\b/.test(text)) types.push('Villa')
    if (/\btownhouse\b/.test(text)) types.push('Townhouse')
    if (/\bduplex\b/.test(text)) types.push('Duplex')
    if (/\bretail|\bshop\b/.test(text)) types.push('Retail')
    if (/\boffice\b/.test(text)) types.push('Office')
    if (/\bwarehouse\b/.test(text)) types.push('Warehouse')
    if (/\bplot\b|\bland\b/.test(text)) types.push('LandPlot')

    return types
}

/**
 * Notify the agents of buyers whose preferences match a newly-added unit
 * (Req 16.3).
 *
 * Loads the unit's match context and, only when the unit is Available
 * (Req 16.2), scores it against the derived preferences of every open lead that
 * has an assigned agent. Leads scoring at or above {@link NOTIFY_MATCH_THRESHOLD}
 * are grouped by agent, and each affected agent gets a single in-app
 * notification (plus a best-effort email) summarizing the matching buyers.
 *
 * Notification delivery is best-effort and never throws: a delivery failure for
 * one agent does not prevent the others from being notified.
 */
export async function notifyMatchingAgents(
    unitId: unknown
): Promise<Result<NotifyMatchingAgentsResult>> {
    const parsedId = idSchema.safeParse(unitId)
    if (!parsedId.success) return { success: false, error: firstIssue(parsedId.error) }

    try {
        const unitRow = await prisma.unit.findUnique({
            where: { id: parsedId.data },
            select: unitMatchSelect,
        })
        if (!unitRow) return { success: false, error: 'Unit not found' }

        const unit = toScorableUnit(unitRow as unknown as LoadedUnit)

        // Matching considers only Available units (Req 16.2). A non-Available
        // new unit produces no notifications.
        if (unit.status !== 'Available') {
            return {
                success: true,
                data: { unitId: unit.id, notifiedAgentCount: 0, matchedBuyerCount: 0 },
            }
        }

        const leads = await prisma.lead.findMany({
            where: {
                status: { in: [...OPEN_LEAD_STATUSES] },
                assignedToId: { not: null },
            },
            select: {
                id: true,
                budget: true,
                interest: true,
                assignedToId: true,
                assignedTo: { select: { id: true, name: true, email: true } },
                contact: { select: { id: true, name: true } },
            },
        })

        // Group matching buyers by their assigned agent.
        type AgentBucket = {
            agentId: number
            name: string
            email: string | null
            buyers: Array<{ leadId: number; buyerName: string; matchPercentage: number }>
        }
        const byAgent = new Map<number, AgentBucket>()
        let matchedBuyerCount = 0

        for (const lead of leads) {
            if (!lead.assignedTo) continue
            const prefs = preferencesFromLead(lead)
            if (!prefs) continue

            const matchPercentage = scoreMatch(prefs, unit)
            if (matchPercentage < NOTIFY_MATCH_THRESHOLD) continue

            matchedBuyerCount += 1
            const agentId = lead.assignedTo.id
            const bucket =
                byAgent.get(agentId) ??
                {
                    agentId,
                    name: lead.assignedTo.name,
                    email: lead.assignedTo.email,
                    buyers: [],
                }
            bucket.buyers.push({
                leadId: lead.id,
                buyerName: lead.contact?.name ?? 'A buyer',
                matchPercentage,
            })
            byAgent.set(agentId, bucket)
        }

        // Best-effort notification per agent (Req 16.3).
        for (const bucket of byAgent.values()) {
            await notifyAgentOfMatches(bucket, unit)
        }

        return {
            success: true,
            data: {
                unitId: unit.id,
                notifiedAgentCount: byAgent.size,
                matchedBuyerCount,
            },
        }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to notify matching agents') }
    }
}

/**
 * Record an in-app notification and send a best-effort email for one agent's
 * matching buyers. Swallows all delivery errors so one failure cannot block the
 * remaining agents (Req 16.3).
 */
async function notifyAgentOfMatches(
    agent: {
        agentId: number
        name: string
        email: string | null
        buyers: Array<{ leadId: number; buyerName: string; matchPercentage: number }>
    },
    unit: ScorableUnit
): Promise<void> {
    const buyerCount = agent.buyers.length
    const unitLabel = unit.projectName
        ? `${unit.projectName} unit ${unit.unitNumber}`
        : `unit ${unit.unitNumber}`
    const subtitle =
        buyerCount === 1
            ? `${agent.buyers[0].buyerName} matches the new ${unitLabel}`
            : `${buyerCount} of your buyers match the new ${unitLabel}`

    try {
        await prisma.notification.create({
            data: {
                type: 'property_match',
                title: 'New matching property',
                subtitle,
                href: '/leads',
                metadata: {
                    unitId: unit.id,
                    agentId: agent.agentId,
                    matches: agent.buyers,
                },
            },
        })
    } catch (err) {
        console.error('[ai-matching] failed to create notification:', err)
    }

    if (!agent.email) return

    try {
        const rows = agent.buyers
            .map((b) => `<li>${b.buyerName} — ${b.matchPercentage}% match</li>`)
            .join('')
        await sendEmail({
            to: agent.email,
            subject: 'New matching property for your buyers',
            html: `<p>Hi ${agent.name || 'there'},</p><p>A new ${unitLabel} matches the following buyers:</p><ul>${rows}</ul><p>Open the leads dashboard to recommend it.</p>`,
        })
    } catch (err) {
        console.error('[ai-matching] agent email failed:', err)
    }
}
