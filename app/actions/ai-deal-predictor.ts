'use server'

/**
 * Server actions for the AI Deal Predictor (Module 14).
 *
 * This file is the IO layer that composes the pure scorer in
 * `lib/deal-score.ts` and the pure signal-derivation helpers in
 * `lib/deal-signals.ts` with Prisma persistence, notifications, and the daily
 * scheduled recalculation.
 *
 * Conventions (matching `app/actions/*`):
 * - `'use server'` module with `prisma` from `@/lib/db`.
 * - Every action returns `{ success: boolean, data?, error? }`.
 * - Pure business rules live in `@/lib/deal-score` / `@/lib/deal-signals`;
 *   this file only gathers data and applies side effects.
 *
 * Responsibilities:
 * - `scoreAndPersistDeal(dealId)`: gather a deal's signals, compute its score,
 *   store the integer score + timestamp (Req 17.3), mark it Hot when the score
 *   exceeds 80 (Req 17.4) and notify the assigned manager on a fresh Hot
 *   marking (Req 17.5), and mark it At Risk + trigger an auto-nurture action on
 *   a fresh At-Risk marking (Req 17.6).
 * - `recalcAllDeals()`: recompute every deal once per run, retaining the last
 *   successfully computed score for any deal whose recomputation fails and
 *   recording an error indication identifying the run (Req 17.7, 17.8).
 *
 * Requirements: 17.3, 17.4, 17.5, 17.6, 17.7, 17.8.
 */

import { prisma } from '@/lib/db'
import { uaePhoneVariants } from '@/lib/whatsapp/phone-utils'
import { revalidatePath } from 'next/cache'
import { computeDealScore, isHotDeal, isAtRiskDeal } from '@/lib/deal-score'
import { deriveScoreInputs, parseBudget, type RawDealData } from '@/lib/deal-signals'
import { engineSendText } from '@/lib/automations/meta-send'

const DEALS_PATH = '/deals'

/** Convert a Prisma `Decimal` (or numeric) field to a plain number. */
function toNumber(value: unknown): number {
    return value == null ? 0 : Number(value)
}

/** Return the most recent of a set of (possibly null) dates, or `null`. */
function latestDate(...dates: Array<Date | null | undefined>): Date | null {
    let latest: Date | null = null
    for (const d of dates) {
        if (d && (latest === null || d.getTime() > latest.getTime())) {
            latest = d
        }
    }
    return latest
}

/** Outcome of scoring a single deal. */
export interface DealScoreResult {
    dealId: number
    score: number
    isHot: boolean
    isAtRisk: boolean
    /** True when this run flipped the deal into the Hot state. */
    newlyHot: boolean
    /** True when this run flipped the deal into the At-Risk state. */
    newlyAtRisk: boolean
}

/**
 * Gather the raw, DB-shaped facts a deal needs for scoring, as of `now`.
 *
 * "Last activity" deliberately excludes the deal's own `updatedAt` (which the
 * scorer itself bumps on every run) and is instead the most recent of: a
 * logged deal activity, a document upload, a call, a conversation message, or
 * the booking's token date. This keeps the at-risk inactivity window honest
 * across repeated recalculations (Req 17.6).
 */
async function gatherRawDealData(dealId: number, now: Date): Promise<RawDealData | null> {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: { booking: true },
    })
    if (!deal) return null

    const contactId = deal.contactId

    const [
        siteVisits,
        firstActivity,
        lastActivity,
        lastDocument,
        kycCount,
        costSheet,
        latestLead,
        lastCall,
        lastConversation,
    ] = await Promise.all([
        prisma.dealActivity.count({ where: { dealId, type: 'SITE_VISIT' } }),
        prisma.dealActivity.findFirst({ where: { dealId }, orderBy: { createdAt: 'asc' } }),
        prisma.dealActivity.findFirst({ where: { dealId }, orderBy: { createdAt: 'desc' } }),
        prisma.document.findFirst({
            where: {
                OR: [
                    { entityType: 'Deal', entityId: dealId },
                    { entityType: 'Contact', entityId: contactId },
                ],
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.kYCRecord.count({ where: { contactId } }),
        deal.unitId
            ? prisma.costSheet.findFirst({
                where: { unitId: deal.unitId, contactId },
                orderBy: { generatedAt: 'desc' },
            })
            : Promise.resolve(null),
        prisma.lead.findFirst({ where: { contactId }, orderBy: { createdAt: 'desc' } }),
        prisma.callLog.findFirst({ where: { contactId }, orderBy: { date: 'desc' } }),
        prisma.conversation.findFirst({ where: { contactId }, orderBy: { date: 'desc' } }),
    ])

    const lastActivityAt = latestDate(
        lastActivity?.createdAt,
        lastDocument?.createdAt,
        lastCall?.date,
        lastConversation?.date,
        deal.booking?.tokenDate ?? null,
    )

    // First-response time: hours from deal creation to the first logged
    // activity. Unknown (no activity yet) leaves it null for a neutral factor.
    let responseTimeHours: number | null = null
    if (firstActivity) {
        const ms = firstActivity.createdAt.getTime() - deal.createdAt.getTime()
        responseTimeHours = ms > 0 ? ms / 3_600_000 : 0
    }

    const hasTokenPayment = deal.booking != null && toNumber(deal.booking.tokenAmount) > 0

    return {
        hasTokenPayment,
        dealValue: toNumber(deal.value),
        source: deal.source ?? null,
        budget: parseBudget(latestLead?.budget ?? null),
        siteVisits,
        kycUploaded: kycCount > 0,
        costSheetViewed: costSheet != null,
        responseTimeHours,
        lastActivityAt,
        createdAt: deal.createdAt,
    }
}

/**
 * Score a single deal and persist the result, applying Hot/At-Risk side
 * effects. Shared by {@link scoreAndPersistDeal} and {@link recalcAllDeals}.
 *
 * Throws if the deal does not exist or persistence fails, so the caller can
 * decide how to handle the failure (the daily run retains the last score).
 */
async function scoreOneDeal(dealId: number, now: Date): Promise<DealScoreResult> {
    const existing = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { isHot: true, isAtRisk: true },
    })
    if (!existing) {
        throw new Error(`Deal ${dealId} not found`)
    }

    const raw = await gatherRawDealData(dealId, now)
    if (!raw) {
        throw new Error(`Deal ${dealId} not found`)
    }

    const { deal, signals, daysSinceLastActivity } = deriveScoreInputs(raw, now)

    const score = computeDealScore(deal, signals)
    const hot = isHotDeal(score) // score > 80 (Req 17.4)
    const atRisk = isAtRiskDeal(score, daysSinceLastActivity) // score < 30 & inactive 7d (Req 17.6)

    const newlyHot = hot && !existing.isHot
    const newlyAtRisk = atRisk && !existing.isAtRisk

    // Store the integer score together with the computation timestamp, and the
    // current Hot/At-Risk classification (Req 17.3, 17.4, 17.6).
    await prisma.deal.update({
        where: { id: dealId },
        data: { aiScore: score, aiScoredAt: now, isHot: hot, isAtRisk: atRisk },
    })

    // Notify the assigned manager when a deal becomes Hot (Req 17.5). Doing this
    // synchronously within the action keeps it well inside the 60s window.
    if (newlyHot) {
        await notifyHotDeal(dealId, score)
    }

    // Mark At Risk and trigger an auto-nurture action (Req 17.6).
    if (newlyAtRisk) {
        await triggerAutoNurture(dealId, score)
    }

    return { dealId, score, isHot: hot, isAtRisk: atRisk, newlyHot, newlyAtRisk }
}

/**
 * Create an in-app notification for a freshly-marked Hot Deal, addressed to the
 * deal's assigned manager/agent when one is set (Req 17.5).
 */
async function notifyHotDeal(dealId: number, score: number): Promise<void> {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: { contact: { select: { name: true } } },
    })
    if (!deal) return

    const buyer = deal.contact?.name ?? `Contact #${deal.contactId}`

    await prisma.notification.create({
        data: {
            type: 'deal_hot',
            title: `🔥 Hot deal: ${buyer}`,
            subtitle: `Deal probability is ${score}. Prioritize follow-up.`,
            href: `${DEALS_PATH}?dealId=${dealId}`,
            metadata: {
                dealId,
                score,
                assignedAgentId: deal.assignedAgentId ?? null,
            },
        },
    })
}

/**
 * Mark a deal's auto-nurture as triggered for a freshly At-Risk deal: record a
 * deal activity capturing the auto-nurture, and raise an in-app notification so
 * the team can rescue the deal (Req 17.6).
 */
async function triggerAutoNurture(dealId: number, score: number): Promise<void> {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: { contact: { select: { name: true } } },
    })
    if (!deal) return

    const buyer = deal.contact?.name ?? `Contact #${deal.contactId}`

    await prisma.$transaction([
        prisma.dealActivity.create({
            data: {
                dealId,
                type: 'AUTO_NURTURE',
                description: `Auto-nurture triggered: deal marked At Risk (score ${score}).`,
            },
        }),
        prisma.notification.create({
            data: {
                type: 'deal_at_risk',
                title: `⚠️ At-risk deal: ${buyer}`,
                subtitle: `Deal probability dropped to ${score}. Auto-nurture started.`,
                href: `${DEALS_PATH}?dealId=${dealId}`,
                metadata: {
                    dealId,
                    score,
                    assignedAgentId: deal.assignedAgentId ?? null,
                },
            },
        }),
    ])

    // Auto-send a WhatsApp nurture message to the buyer (best-effort)
    await sendAtRiskNurtureWhatsApp(dealId, score)
}

/**
 * Best-effort: send a WhatsApp nurture message to the buyer of an at-risk deal.
 *
 * All errors are swallowed so this never blocks or fails the scoring flow.
 */
async function sendAtRiskNurtureWhatsApp(dealId: number, score: number): Promise<void> {
    try {
        // 1. Load the deal → contact → phone
        const deal = await prisma.deal.findUnique({
            where: { id: dealId },
            select: {
                value: true,
                contact: { select: { name: true, phone: true } },
                unit: {
                    select: {
                        unitNumber: true,
                        type: true,
                        tower: { select: { project: { select: { name: true } } } },
                    },
                },
            },
        })
        if (!deal?.contact?.phone) return

        const phoneVariants = uaePhoneVariants(deal.contact.phone)
        if (phoneVariants.length === 0) return

        // 2. Find the WaContact by local/E.164 UAE variants.
        const waContact = await prisma.waContact.findFirst({
            where: { phone: { in: phoneVariants } },
            select: { id: true, user_id: true },
        })
        if (!waContact) return

        // 3. Find the linked conversation
        const conv = await prisma.waConversation.findFirst({
            where: { user_id: waContact.user_id, contact_id: waContact.id },
            select: { id: true },
        })
        if (!conv) return

        // 4. Build the nurture message
        const buyerName = deal.contact.name ?? 'there'
        const projectName = deal.unit?.tower?.project?.name ?? 'the property'
        const unitDesc = deal.unit
            ? `${deal.unit.type.replace(/Apartment(\d|Plus)/, 'Apartment $1')} ${deal.unit.unitNumber}`
            : 'the unit'
        const message =
            `Hi ${buyerName}! 👋 We noticed you were interested in ${unitDesc} at ${projectName}. ` +
            `We have some exciting updates and would love to connect. ` +
            `Please let us know a good time to speak! 🏠`

        // 5. Send via the automation engine sender
        await engineSendText({
            userId: waContact.user_id,
            conversationId: conv.id,
            contactId: waContact.id,
            text: message,
        })

        console.log(`[at-risk] nurture WhatsApp sent for deal ${dealId}`)
    } catch (err) {
        // Best-effort — never block the scoring flow
        console.error('[at-risk] WhatsApp nurture failed:', err)
    }
}

/**
 * Compute, persist, and act on a single deal's probability score.
 *
 * Stores the integer score and its computation timestamp on the deal, marks it
 * Hot when the score exceeds 80 (notifying the assigned manager on a fresh
 * marking), and marks it At Risk with an auto-nurture action when the score is
 * below 30 and the deal has been inactive for 7+ days.
 *
 * @param dealId The deal to score.
 * @param now Optional clock override (used by the daily run for a single,
 *   consistent timestamp); defaults to the current time.
 *
 * Requirements: 17.3, 17.4, 17.5, 17.6
 */
export async function scoreAndPersistDeal(
    dealId: number,
    now: Date = new Date(),
): Promise<
    | { success: true; data: Awaited<ReturnType<typeof scoreOneDeal>> }
    | { success: false; error: string }
> {
    if (!Number.isInteger(dealId) || dealId <= 0) {
        return { success: false, error: 'A valid deal id is required' }
    }

    try {
        const result = await scoreOneDeal(dealId, now)
        revalidatePath(DEALS_PATH)
        return { success: true, data: result }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to score deal'
        return { success: false, error: message }
    }
}

/** Summary of a daily recalculation run. */
export interface RecalcRunResult {
    /** Identifier for this run (start timestamp, ISO-8601). */
    runId: string
    startedAt: string
    finishedAt: string
    /** Number of deals successfully rescored. */
    updated: number
    /** Number of deals whose recomputation failed (last score retained). */
    failed: number
    /** Per-deal failure details for the affected deals. */
    errors: Array<{ dealId: number; error: string }>
}

/**
 * Recalculate every deal's probability score in a single scheduled run.
 *
 * Each deal is scored independently; a failure on one deal is caught so the run
 * continues. For any failed deal the last successfully computed score is
 * retained (the failing branch never writes a score), and the failure is
 * recorded against the run id. When one or more deals fail, an error-indication
 * notification identifying the run is created (Req 17.8).
 *
 * The run uses a single `now` timestamp so every deal in the batch is scored
 * against the same clock (Req 17.7).
 *
 * Requirements: 17.7, 17.8
 */
export async function recalcAllDeals() {
    const startedAt = new Date()
    const runId = startedAt.toISOString()

    const deals = await prisma.deal.findMany({ select: { id: true } })

    let updated = 0
    const errors: Array<{ dealId: number; error: string }> = []

    for (const { id } of deals) {
        try {
            await scoreOneDeal(id, startedAt)
            updated += 1
        } catch (err) {
            // Retain the last successfully computed score: the failing path
            // above performs no write, so the deal's prior aiScore stands.
            const message = err instanceof Error ? err.message : 'Unknown error'
            errors.push({ dealId: id, error: message })
        }
    }

    const finishedAt = new Date()

    // Record an error indication identifying the failed run (Req 17.8).
    if (errors.length > 0) {
        await prisma.notification.create({
            data: {
                type: 'deal_recalc_error',
                title: 'Deal score recalculation completed with errors',
                subtitle: `Run ${runId}: ${errors.length} deal(s) failed; last scores retained.`,
                href: DEALS_PATH,
                metadata: {
                    runId,
                    failedDealIds: errors.map((e) => e.dealId),
                    failed: errors.length,
                    updated,
                },
            },
        })
    }

    revalidatePath(DEALS_PATH)

    const result: RecalcRunResult = {
        runId,
        startedAt: runId,
        finishedAt: finishedAt.toISOString(),
        updated,
        failed: errors.length,
        errors,
    }

    return { success: true, data: result }
}
