'use server'

/**
 * Server actions for the Deal Pipeline & Booking Engine (Module 3).
 *
 * This file is the head of a write-chain: it currently implements the deal
 * pipeline (DealStage CRUD/reorder, deal creation, stage moves with activity
 * logging, deal detail, and analytics). The booking engine (task 7.2) and
 * demand-letter / milestone-payment actions (task 13.4) append to this file.
 *
 * Conventions (matching `app/actions/*`):
 * - `'use server'` module with `prisma` from `@/lib/db`.
 * - Untrusted input is parsed through Zod schemas in `@/lib/validations/deals`.
 * - Every action returns `{ success: boolean, data?, error? }`.
 * - Pure business rules live in `@/lib/deals`; this file composes them with IO.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 20.7.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth-helpers'
import {
    cancelBookingSchema,
    convertDealToBookingSchema,
    createDealSchema,
    createDealStageSchema,
    moveDealSchema,
    recordTokenPaymentSchema,
    reorderStagesSchema,
} from '@/lib/validations/deals'
import {
    aggregateDealAnalytics,
    applyMilestonePayment,
    milestoneStatus,
    milestonesFromPlan,
    validateStageMove,
    type DealLike,
    type MilestoneLike,
} from '@/lib/deals'
import { aggregateOverdueCollections, shouldGenerateDemand } from '@/lib/demand'
import { notifyManagers } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isValidE164, normalizePhoneForMetaUae } from '@/lib/whatsapp/phone-utils'
import { idSchema } from '@/lib/validations/common'

const DEALS_PATH = '/deals'

const DEFAULT_DUBAI_POSSESSION_CHECKLIST = [
    { id: 'dewa', label: 'DEWA account transfer or activation confirmed', status: 'Pending' },
    { id: 'cooling', label: 'District cooling (Empower / Tabreed) transfer confirmed', status: 'Pending' },
    { id: 'ejari', label: 'Ejari registration completed, where applicable', status: 'Pending' },
    { id: 'snag', label: 'Snag inspection completed', status: 'Pending' },
    { id: 'keys', label: 'Keys and access cards handed over', status: 'Pending' },
    { id: 'parking', label: 'Parking allocation and access confirmed', status: 'Pending' },
] satisfies Prisma.InputJsonArray

/**
 * Resolve the staff id of the acting user for audit logging (Req 20.7).
 * Falls back to an explicit `actorId` override, then the session's staff id,
 * and finally `null` when neither is available.
 */
async function resolvePerformedById(actorId?: number | null): Promise<number | null> {
    if (typeof actorId === 'number' && Number.isFinite(actorId)) return actorId
    const session = await getSession()
    const staffId = session?.user?.staffId
    return typeof staffId === 'number' && Number.isFinite(staffId) ? staffId : null
}

/** Convert a Prisma `Decimal` (or numeric) field to a plain number. */
function toNumber(value: unknown): number {
    return value == null ? 0 : Number(value)
}

function firstIssue(error: z.ZodError): string {
    return error.issues[0]?.message ?? 'Invalid input'
}

// ─── DealStage CRUD / reorder (Req 4.1) ──────────────

/** List all deal stages ordered by their pipeline position. */
export async function listDealStages() {
    const stages = await prisma.dealStage.findMany({ orderBy: { order: 'asc' } })
    return { success: true, data: stages }
}

/**
 * Create a DealStage with name (1–100 chars), positive-integer order, color,
 * is-won/is-lost flags, and optional auto-action definitions (Req 4.1).
 */
export async function createDealStage(data: unknown) {
    const parsed = createDealStageSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { name, order, color, isWon, isLost, autoActions } = parsed.data

    const stage = await prisma.dealStage.create({
        data: {
            name,
            order,
            ...(color ? { color } : {}),
            isWon: isWon ?? false,
            isLost: isLost ?? false,
            autoActions: (autoActions ?? undefined) as never,
        },
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: stage }
}

/**
 * Update an existing DealStage. Re-validates the full stage shape so the
 * 1–100 character name and positive-integer order rules still hold (Req 4.1).
 */
export async function updateDealStage(id: number, data: unknown) {
    const parsed = createDealStageSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const existing = await prisma.dealStage.findUnique({ where: { id } })
    if (!existing) return { success: false, error: 'Deal stage not found' }

    const { name, order, color, isWon, isLost, autoActions } = parsed.data

    const stage = await prisma.dealStage.update({
        where: { id },
        data: {
            name,
            order,
            ...(color ? { color } : {}),
            isWon: isWon ?? false,
            isLost: isLost ?? false,
            autoActions: (autoActions ?? undefined) as never,
        },
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: stage }
}

/**
 * Delete a DealStage. Refuses to delete a stage that still holds deals so the
 * pipeline never leaves deals pointing at a missing stage (referential
 * integrity, Req 20.8).
 */
export async function deleteDealStage(id: number) {
    const dealCount = await prisma.deal.count({ where: { stageId: id } })
    if (dealCount > 0) {
        return {
            success: false,
            error: 'Cannot delete a stage that still contains deals; move them first',
        }
    }

    await prisma.dealStage.delete({ where: { id } })
    revalidatePath(DEALS_PATH)
    return { success: true }
}

/**
 * Reorder stages by assigning each supplied stage its new `order`. All updates
 * run in a single transaction so the pipeline order is never partially
 * applied (Req 20.6).
 */
export async function reorderStages(data: unknown) {
    const parsed = reorderStagesSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    await prisma.$transaction(
        parsed.data.map((entry) =>
            prisma.dealStage.update({ where: { id: entry.id }, data: { order: entry.order } }),
        ),
    )

    revalidatePath(DEALS_PATH)
    const stages = await prisma.dealStage.findMany({ orderBy: { order: 'asc' } })
    return { success: true, data: stages }
}

// ─── Deal creation (Req 4.2) ─────────────────────────

/**
 * Create a Deal after validating required fields and ranges (Req 4.2, 20.4):
 * contact + stage are required, value is within the money range, notes are
 * capped at 5000 characters. The target stage and contact must exist so every
 * foreign key resolves (Req 20.8).
 */
export async function createDeal(data: unknown) {
    const parsed = createDealSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const input = parsed.data

    const [stage, contact] = await Promise.all([
        prisma.dealStage.findUnique({ where: { id: input.stageId } }),
        prisma.contact.findUnique({ where: { id: input.contactId } }),
    ])

    if (!stage) return { success: false, error: 'Target stage is invalid: the stage does not exist' }
    if (!contact) return { success: false, error: 'Contact not found' }

    // A deal created directly into a lost stage still needs a lost reason (Req 4.9).
    if (stage.isLost && !input.lostReason) {
        return { success: false, error: 'A lost reason is required for a lost stage' }
    }

    const deal = await prisma.deal.create({
        data: {
            contactId: input.contactId,
            stageId: input.stageId,
            value: input.value,
            unitId: input.unitId ?? null,
            assignedAgentId: input.assignedAgentId ?? null,
            channelPartnerId: input.channelPartnerId ?? null,
            expectedCloseDate: input.expectedCloseDate ?? null,
            source: input.source ?? null,
            notes: input.notes ?? null,
            lostReason: input.lostReason ?? null,
            wonDate: stage.isWon ? new Date() : null,
        },
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: deal }
}

// ─── Stage move with activity logging (Req 4.3, 4.4, 4.9, 20.7) ─

/**
 * Move a deal to a different stage.
 *
 * Rules enforced via the pure `validateStageMove` helper:
 * - A move to a non-existent stage is rejected; the deal keeps its current
 *   stage and an "invalid target stage" error is returned (Req 4.4).
 * - A move into a stage whose is-lost flag is set requires a non-empty lost
 *   reason; otherwise the move is rejected and the stage retained (Req 4.9).
 *
 * On a valid move, the deal's stage is updated and a DealActivity row is
 * written — capturing type, description, old/new stage, performed-by, and
 * timestamp — inside a single transaction (Req 4.3, 20.6, 20.7).
 *
 * @param dealId The deal to move.
 * @param toStageId The destination stage id.
 * @param lostReason Optional lost reason supplied with the move.
 * @param actorId Optional override for the acting staff id (defaults to the
 *   session user's staff id) for audit logging.
 */
export async function moveDeal(
    dealId: number,
    toStageId: number,
    lostReason?: string,
    actorId?: number,
) {
    const parsed = moveDealSchema.safeParse({ dealId, toStageId, lostReason })
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const deal = await prisma.deal.findUnique({ where: { id: parsed.data.dealId } })
    if (!deal) return { success: false, error: 'Deal not found' }

    const targetStage = await prisma.dealStage.findUnique({
        where: { id: parsed.data.toStageId },
    })

    const dealLike: DealLike = {
        stageId: deal.stageId,
        value: toNumber(deal.value),
        lostReason: deal.lostReason,
    }

    const check = validateStageMove(dealLike, targetStage, parsed.data.lostReason)
    if (!check.ok) {
        // Reject the move and retain the deal's current stage (Req 4.4, 4.9).
        return { success: false, error: check.error }
    }

    const oldStageId = deal.stageId
    const newStageId = targetStage!.id
    const performedById = await resolvePerformedById(actorId)
    const resolvedLostReason = targetStage!.isLost
        ? String(parsed.data.lostReason ?? deal.lostReason ?? '').trim()
        : deal.lostReason

    const [updated] = await prisma.$transaction([
        prisma.deal.update({
            where: { id: deal.id },
            data: {
                stageId: newStageId,
                lostReason: resolvedLostReason,
                wonDate: targetStage!.isWon ? deal.wonDate ?? new Date() : deal.wonDate,
            },
        }),
        prisma.dealActivity.create({
            data: {
                dealId: deal.id,
                type: 'STAGE_CHANGE',
                description: `Deal moved to stage "${targetStage!.name}"`,
                oldStageId,
                newStageId,
                performedById,
            },
        }),
    ])

    revalidatePath(DEALS_PATH)
    return { success: true, data: updated }
}

// ─── Deal detail (Req 4.7) ───────────────────────────

/**
 * Return a deal's detail view: the activity timeline, related documents,
 * milestone tracker (via the booking), and the buyer's cost sheet for the
 * deal's unit (Req 4.7).
 */
export async function getDealDetail(dealId: number) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: {
            contact: true,
            unit: true,
            stage: true,
            assignedAgent: true,
            channelPartner: true,
            activities: { orderBy: { createdAt: 'desc' } },
            appointments: {
                where: { purpose: 'DLD Trustee Transfer' },
                orderBy: { updatedAt: 'desc' },
                take: 1,
            },
            booking: {
                include: {
                    milestones: {
                        orderBy: { dueDate: 'asc' },
                        include: { demandLetters: { orderBy: { generatedAt: 'desc' } } },
                    },
                },
            },
        },
    })

    if (!deal) return { success: false, error: 'Deal not found' }

    const documents = await prisma.document.findMany({
        where: { entityType: 'Deal', entityId: deal.id },
        orderBy: { createdAt: 'desc' },
    })

    // The cost sheet is keyed by unit + contact rather than by deal.
    const costSheet = deal.unitId
        ? await prisma.costSheet.findFirst({
            where: { unitId: deal.unitId, contactId: deal.contactId },
            orderBy: { generatedAt: 'desc' },
        })
        : null

    return {
        success: true,
        data: {
            deal,
            timeline: deal.activities,
            documents,
            milestones: deal.booking?.milestones ?? [],
            costSheet,
            dldTrusteeAppointment: deal.appointments[0] ?? null,
        },
    }
}

// ─── Dubai DLD Trustee transfer workflow ──────────────────────────────────

const dldWorkflowSchema = z.object({
    developerNocStatus: z.enum(['NotRequested', 'Requested', 'Received', 'Rejected']),
    dldTransferStatus: z.enum(['NotStarted', 'TrusteeAppointmentScheduled', 'TransferCompleted', 'Cancelled']),
    dldTrusteeOffice: z.string().trim().max(180).optional().nullable(),
    dldTransferNotes: z.string().trim().max(2000).optional().nullable(),
})

const dldAppointmentSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid appointment date'),
    time: z.string().trim().min(1, 'Appointment time is required').max(40),
    dldTrusteeOffice: z.string().trim().min(2, 'DLD Trustee office is required').max(180),
    notes: z.string().trim().max(2000).optional().nullable(),
})

/** Update the NOC and DLD transfer state for a Dubai deal. */
export async function updateDldTransferWorkflow(dealId: unknown, data: unknown) {
    const parsedId = idSchema.safeParse(dealId)
    if (!parsedId.success) return { success: false as const, error: firstIssue(parsedId.error) }
    const parsed = dldWorkflowSchema.safeParse(data)
    if (!parsed.success) return { success: false as const, error: firstIssue(parsed.error) }

    const current = await prisma.deal.findUnique({
        where: { id: parsedId.data },
        select: { id: true, developerNocStatus: true, dldTransferStatus: true },
    })
    if (!current) return { success: false as const, error: 'Deal not found' }

    if (parsed.data.dldTransferStatus === 'TransferCompleted') {
        if (parsed.data.developerNocStatus !== 'Received') {
            return { success: false as const, error: 'Record the developer NOC as received before completing the DLD transfer' }
        }
        const appointment = await prisma.appointment.findFirst({
            where: { dealId: current.id, purpose: 'DLD Trustee Transfer', status: { not: 'Cancelled' } },
            select: { id: true },
        })
        if (!appointment) {
            return { success: false as const, error: 'Schedule a DLD Trustee appointment before completing the transfer' }
        }
    }

    const updated = await prisma.$transaction(async (tx) => {
        const deal = await tx.deal.update({
            where: { id: current.id },
            data: parsed.data,
        })

        if (
            current.developerNocStatus !== parsed.data.developerNocStatus
            || current.dldTransferStatus !== parsed.data.dldTransferStatus
        ) {
            await tx.dealActivity.create({
                data: {
                    dealId: current.id,
                    type: 'DLD_TRANSFER_UPDATED',
                    description: `Developer NOC: ${parsed.data.developerNocStatus.replace(/([A-Z])/g, ' $1').trim()}; DLD transfer: ${parsed.data.dldTransferStatus.replace(/([A-Z])/g, ' $1').trim()}`,
                },
            })
        }
        return deal
    })

    revalidatePath(`${DEALS_PATH}/${current.id}`)
    return { success: true as const, data: updated }
}

/** Create or reschedule the DLD Trustee appointment linked to a Dubai deal. */
export async function scheduleDldTrusteeAppointment(dealId: unknown, data: unknown) {
    const parsedId = idSchema.safeParse(dealId)
    if (!parsedId.success) return { success: false as const, error: firstIssue(parsedId.error) }
    const parsed = dldAppointmentSchema.safeParse(data)
    if (!parsed.success) return { success: false as const, error: firstIssue(parsed.error) }

    const deal = await prisma.deal.findUnique({
        where: { id: parsedId.data },
        select: { id: true, contactId: true, dldTransferStatus: true },
    })
    if (!deal) return { success: false as const, error: 'Deal not found' }
    if (deal.dldTransferStatus === 'TransferCompleted') {
        return { success: false as const, error: 'This transfer is already marked complete' }
    }

    const appointmentDate = new Date(`${parsed.data.date}T00:00:00`)
    if (Number.isNaN(appointmentDate.getTime())) {
        return { success: false as const, error: 'Choose a valid appointment date' }
    }

    const appointment = await prisma.$transaction(async (tx) => {
        const existing = await tx.appointment.findFirst({
            where: { dealId: deal.id, purpose: 'DLD Trustee Transfer' },
            orderBy: { updatedAt: 'desc' },
        })
        const notes = [
            `DLD Trustee office: ${parsed.data.dldTrusteeOffice}`,
            parsed.data.notes ?? '',
        ].filter(Boolean).join('\n')

        const appointmentData = {
            date: appointmentDate,
            time: parsed.data.time,
            purpose: 'DLD Trustee Transfer',
            notes,
            status: 'Scheduled',
        }
        const saved = existing
            ? await tx.appointment.update({ where: { id: existing.id }, data: appointmentData })
            : await tx.appointment.create({
                data: { ...appointmentData, contactId: deal.contactId, dealId: deal.id },
            })

        await tx.deal.update({
            where: { id: deal.id },
            data: {
                dldTransferStatus: 'TrusteeAppointmentScheduled',
                dldTrusteeOffice: parsed.data.dldTrusteeOffice,
                ...(parsed.data.notes !== undefined ? { dldTransferNotes: parsed.data.notes } : {}),
            },
        })
        await tx.dealActivity.create({
            data: {
                dealId: deal.id,
                type: existing ? 'DLD_TRUSTEE_APPOINTMENT_RESCHEDULED' : 'DLD_TRUSTEE_APPOINTMENT_SCHEDULED',
                description: `DLD Trustee transfer appointment scheduled at ${parsed.data.dldTrusteeOffice} for ${parsed.data.date} ${parsed.data.time}`,
            },
        })
        return saved
    })

    revalidatePath(`${DEALS_PATH}/${deal.id}`)
    revalidatePath('/appointments')
    return { success: true as const, data: appointment }
}

// ─── Deal analytics (Req 4.8) ────────────────────────

/**
 * Return deal count and the sum of deal values grouped by stage (Req 4.8).
 * Aggregation is delegated to the pure `aggregateDealAnalytics` helper after
 * normalizing the Decimal `value` column to a number, and stage names are
 * attached for display.
 */
export async function getDealAnalytics() {
    const [deals, stages] = await Promise.all([
        prisma.deal.findMany({ select: { stageId: true, value: true } }),
        prisma.dealStage.findMany({ orderBy: { order: 'asc' } }),
    ])

    const rows = aggregateDealAnalytics(
        deals.map((d) => ({ stageId: d.stageId, value: toNumber(d.value) })),
    )

    const byStageId = new Map(rows.map((r) => [r.stageId, r]))

    // Include every stage so empty stages report a zeroed row (Req 4.8).
    const data = stages.map((stage) => {
        const row = byStageId.get(stage.id)
        return {
            stageId: stage.id,
            stageName: stage.name,
            count: row?.count ?? 0,
            totalValue: row?.totalValue ?? 0,
        }
    })

    return { success: true, data }
}

// ─── Kanban board listing (Req 4.5) ─────────────────

/**
 * List every stage (ordered by pipeline position) with the deals it currently
 * holds, projected to a light card shape for the Kanban board (Req 4.5).
 *
 * Each card carries the contact name/phone, unit label, deal value, AI score
 * and hot/at-risk flags so the board can render without a second round-trip,
 * and `hasBooking` so a won deal already converted to a booking is
 * distinguishable. Decimal `value` is normalized to a plain number so the
 * payload is serializable across the server-action boundary.
 */
export async function listDealsForBoard() {
    const [stages, deals] = await Promise.all([
        prisma.dealStage.findMany({ orderBy: { order: 'asc' } }),
        prisma.deal.findMany({
            orderBy: { updatedAt: 'desc' },
            include: {
                contact: { select: { name: true, phone: true } },
                unit: { select: { unitNumber: true } },
                assignedAgent: { select: { name: true } },
                booking: { select: { id: true } },
            },
        }),
    ])

    const cards = deals.map((d) => ({
        id: d.id,
        stageId: d.stageId,
        value: toNumber(d.value),
        contactName: d.contact?.name ?? 'Unknown contact',
        contactPhone: d.contact?.phone ?? null,
        unitNumber: d.unit?.unitNumber ?? null,
        agentName: d.assignedAgent?.name ?? null,
        aiScore: d.aiScore ?? null,
        isHot: d.isHot,
        isAtRisk: d.isAtRisk,
        expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.toISOString() : null,
        source: d.source ?? null,
        hasBooking: d.booking != null,
    }))

    const columns = stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        order: stage.order,
        color: stage.color,
        isWon: stage.isWon,
        isLost: stage.isLost,
        deals: cards.filter((c) => c.stageId === stage.id),
    }))

    return { success: true, data: { columns } }
}

// ─── EMI calculator: deal list + save-to-deal metadata (Req 10.4) ─

/**
 * List deals for the EMI calculator's "save to deal" picker. Returns a light
 * projection (id, value, stage name, contact name) ordered most-recent-first,
 * so the tool can offer a dropdown without loading the full pipeline.
 */
export async function listDealsForCalculator() {
    const deals = await prisma.deal.findMany({
        orderBy: { createdAt: 'desc' },
        include: { contact: { select: { name: true } }, stage: { select: { name: true } } },
    })

    const data = deals.map((d) => ({
        id: d.id,
        value: toNumber(d.value),
        contactName: d.contact?.name ?? 'Unknown contact',
        stageName: d.stage?.name ?? '',
    }))

    return { success: true, data }
}

/**
 * Save an EMI calculation onto a deal as JSON in `Deal.metadata`, WITHOUT
 * creating a new Prisma model (Req 10.4). Calculations accumulate under
 * `metadata.emiCalculations`; each entry is timestamped so a deal can retain a
 * history of financing scenarios shown to the buyer.
 *
 * @param dealId The deal to attach the calculation to.
 * @param calculation A plain JSON object describing the EMI scenario (inputs +
 *   computed EMI, total interest, optional stamp-duty estimate, bank rate).
 */
export async function saveEmiCalculationToDeal(dealId: number, calculation: unknown) {
    if (!Number.isInteger(dealId) || dealId < 1) {
        return { success: false, error: 'A valid deal must be selected' }
    }
    if (calculation == null || typeof calculation !== 'object') {
        return { success: false, error: 'Calculation data is invalid' }
    }

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { metadata: true } })
    if (!deal) return { success: false, error: 'Deal not found' }

    const existing =
        deal.metadata && typeof deal.metadata === 'object' && !Array.isArray(deal.metadata)
            ? (deal.metadata as Record<string, unknown>)
            : {}

    const priorList = Array.isArray((existing as { emiCalculations?: unknown }).emiCalculations)
        ? ((existing as { emiCalculations: unknown[] }).emiCalculations)
        : []

    const entry = {
        ...(calculation as Record<string, unknown>),
        savedAt: new Date().toISOString(),
    }

    const metadata = {
        ...existing,
        emiCalculations: [...priorList, entry],
    }

    const updated = await prisma.deal.update({
        where: { id: dealId },
        data: { metadata: metadata as Prisma.InputJsonValue },
        select: { id: true, metadata: true },
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: updated }
}

// ─── Booking engine (Req 5.1–5.7, 20.5, 20.6, 20.7) ──

/**
 * Unit statuses from which a unit may be converted into a booking (Req 5.3).
 * Any other status (Booked, Sold, Mortgaged) blocks the conversion.
 */
const BOOKABLE_UNIT_STATUSES = new Set<string>(['Available', 'Blocked'])

/**
 * A booking-engine rule violation surfaced from inside a transaction. Thrown
 * so the transaction rolls back (no partial writes, Req 20.6) and caught by
 * the action to return `{ success: false, error }` without leaking a stack.
 */
class BookingError extends Error { }

/** Generate a unique `DailyPayment.displayId` (matches the `PAY-YYYYMM-NNNN` convention). */
function buildPaymentDisplayId(sequence: number, now: Date): string {
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    return `PAY-${year}${month}-${(sequence + 1).toString().padStart(4, '0')}`
}

/**
 * Convert a won deal into a Booking (Req 5.1–5.5, 20.5, 20.6).
 *
 * All writes run inside a single interactive transaction so a partial booking
 * never persists (Req 5.1, 20.6). The target unit row is locked with
 * `SELECT ... FOR UPDATE` before its status is read, which serializes
 * concurrent conversions of the same unit: only the first transaction sees a
 * bookable status, the second observes `Booked` and is rejected, so a unit is
 * never double-booked (Req 5.4, 20.5).
 *
 * Rules:
 * - The deal must exist and resolve a unit — either via `bookingData.unitId`
 *   or the deal's own `unitId` (Req 20.8).
 * - A deal may be booked only once; a second attempt is rejected (the
 *   `Booking.dealId` unique constraint is enforced up front for a clean error).
 * - The unit must be Available or Blocked at conversion time; otherwise the
 *   conversion is rejected with the current status and nothing changes
 *   (Req 5.3).
 * - On success the unit transitions to Booked and points at the new booking,
 *   any timed hold is cleared, milestones are generated from the selected
 *   payment plan so their amounts sum to the agreement value (Req 5.2, 5.5),
 *   and a DealActivity audit row records who converted the deal and when
 *   (Req 20.7).
 *
 * @param dealId The deal to convert.
 * @param bookingData Booking attributes (agreement/token values, receipt,
 *   optional payment plan, booking date, and unit override).
 * @param actorId Optional override for the acting staff id (audit, Req 20.7).
 */
export async function convertDealToBooking(
    dealId: number,
    bookingData: unknown,
    actorId?: number,
) {
    if (!Number.isInteger(dealId) || dealId < 1) {
        return { success: false, error: 'A valid deal must be selected' }
    }

    const parsed = convertDealToBookingSchema.safeParse(bookingData)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const input = parsed.data

    const deal = await prisma.deal.findUnique({ where: { id: dealId } })
    if (!deal) return { success: false, error: 'Deal not found' }

    const unitId = input.unitId ?? deal.unitId
    if (!unitId) {
        return { success: false, error: 'A unit is required to convert this deal to a booking' }
    }

    // A deal can back at most one booking (Booking.dealId is unique).
    const existingBooking = await prisma.booking.findUnique({ where: { dealId } })
    if (existingBooking) {
        return { success: false, error: 'This deal has already been converted to a booking' }
    }

    // Resolve the payment plan (if any) so milestones sum to the agreement value.
    const paymentPlan = input.paymentPlanId
        ? await prisma.paymentPlan.findUnique({ where: { id: input.paymentPlanId } })
        : null
    if (input.paymentPlanId && !paymentPlan) {
        return { success: false, error: 'Selected payment plan does not exist' }
    }

    const bookingDate = input.bookingDate ?? new Date()
    const performedById = await resolvePerformedById(actorId)

    const generatedMilestones = milestonesFromPlan(
        { milestones: (paymentPlan?.milestones ?? []) as unknown },
        input.agreementValue,
        bookingDate,
    )

    try {
        const booking = await prisma.$transaction(async (tx) => {
            // Lock the unit row to serialize concurrent conversions (Req 5.4, 20.5).
            const locked = await tx.$queryRaw<Array<{ id: number; status: string }>>`
                SELECT "id", "status"::text AS "status" FROM "Unit" WHERE "id" = ${unitId} FOR UPDATE
            `

            if (locked.length === 0) {
                throw new BookingError('Unit not found')
            }

            const currentStatus = locked[0].status
            if (!BOOKABLE_UNIT_STATUSES.has(currentStatus)) {
                // Leave the unit and deal unchanged and report the blocking status (Req 5.3).
                throw new BookingError(
                    `Unit cannot be booked because its current status is ${currentStatus}`,
                )
            }

            const created = await tx.booking.create({
                data: {
                    dealId,
                    unitId,
                    contactId: deal.contactId,
                    bookingDate,
                    agreementValue: input.agreementValue,
                    tokenAmount: input.tokenAmount,
                    tokenReceiptNo: input.tokenReceiptNo,
                    tokenDate: input.tokenDate ?? null,
                    tokenMode: input.tokenMode ?? null,
                    paymentPlanId: input.paymentPlanId ?? null,
                    status: 'Active',
                },
            })

            await tx.possessionChecklist.create({
                data: {
                    bookingId: created.id,
                    items: DEFAULT_DUBAI_POSSESSION_CHECKLIST,
                },
            })

            // Transition the unit to Booked and clear any timed hold (Req 5.2).
            await tx.unit.update({
                where: { id: unitId },
                data: {
                    status: 'Booked',
                    bookingId: created.id,
                    holdByStaffId: null,
                    holdByPartnerId: null,
                    holdCreatedAt: null,
                    holdExpiresAt: null,
                },
            })

            // Generate the milestone schedule (sum equals agreement value, Req 5.5).
            if (generatedMilestones.length > 0) {
                await tx.bookingMilestone.createMany({
                    data: generatedMilestones.map((m) => ({
                        bookingId: created.id,
                        name: m.name,
                        dueDate: m.dueDate,
                        amount: m.amount,
                        paidAmount: m.paidAmount,
                        status: m.status,
                    })),
                })
            }

            // Audit who converted the deal and when (Req 20.7).
            await tx.dealActivity.create({
                data: {
                    dealId,
                    type: 'BOOKING_CREATED',
                    description: `Deal converted to booking (reservation receipt ${input.tokenReceiptNo})`,
                    performedById,
                },
            })

            return tx.booking.findUnique({
                where: { id: created.id },
                include: { milestones: { orderBy: { dueDate: 'asc' } } },
            })
        })

        revalidatePath(DEALS_PATH)
        return { success: true, data: booking }
    } catch (error) {
        if (error instanceof BookingError) {
            return { success: false, error: error.message }
        }
        // A unique-constraint race (e.g. concurrent first-time conversions) lands here.
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            return { success: false, error: 'This deal has already been converted to a booking' }
        }
        throw error
    }
}

/**
 * Record a token payment for a booking (Req 5.6).
 *
 * The payment is linked through the existing `DailyPayment` model (per
 * assumption A5) and the booking's token fields (receipt number, amount,
 * date, mode) are updated — both writes run in a single transaction so the
 * booking and the payment ledger never diverge (Req 20.6). `DailyPayment.amount`
 * is an integer column, so the money amount is rounded to the nearest whole
 * unit when stored on the ledger entry.
 *
 * @param bookingId The booking the token payment belongs to.
 * @param payment The payment details (amount, method, receipt, optional
 *   reference / token date / staff / payment date).
 */
export async function recordTokenPayment(bookingId: number, payment: unknown) {
    if (!Number.isInteger(bookingId) || bookingId < 1) {
        return { success: false, error: 'A valid booking must be selected' }
    }

    const parsed = recordTokenPaymentSchema.safeParse(payment)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const input = parsed.data

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { contact: { select: { id: true, name: true } } },
    })
    if (!booking) return { success: false, error: 'Booking not found' }
    if (booking.status === 'Cancelled') {
        return { success: false, error: 'Cannot record a payment for a cancelled booking' }
    }

    const paymentDate = input.date ?? new Date()

    const result = await prisma.$transaction(async (tx) => {
        const sequence = await tx.dailyPayment.count()
        const dailyPayment = await tx.dailyPayment.create({
            data: {
                displayId: buildPaymentDisplayId(sequence, paymentDate),
                amount: Math.round(input.amount),
                type: 'IN',
                method: input.method,
                reference: input.reference ?? input.tokenReceiptNo,
                date: paymentDate,
                contactId: booking.contactId,
                customerName: booking.contact?.name ?? null,
                receivedByStaffId: input.receivedByStaffId ?? null,
                notes: `Reservation deposit for booking #${booking.id} (receipt ${input.tokenReceiptNo})`,
            },
        })

        const updatedBooking = await tx.booking.update({
            where: { id: bookingId },
            data: {
                tokenReceiptNo: input.tokenReceiptNo,
                tokenAmount: input.amount,
                tokenDate: input.tokenDate ?? paymentDate,
                tokenMode: input.method,
            },
        })

        return { booking: updatedBooking, payment: dailyPayment }
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: result }
}

/**
 * Cancel a booking (Req 5.7).
 *
 * Sets the booking status to Cancelled with a reason and timestamp and returns
 * the associated unit to Available — both within a single transaction so the
 * inventory and the booking never disagree (Req 5.7, 20.6). The unit row is
 * locked for the update and a DealActivity audit row records who cancelled the
 * booking and when (Req 20.7). A booking that is already cancelled is rejected.
 *
 * @param bookingId The booking to cancel.
 * @param reason The cancellation reason (1–1000 chars).
 * @param actorId Optional override for the acting staff id (audit, Req 20.7).
 */
export async function cancelBooking(bookingId: number, reason: unknown, actorId?: number) {
    if (!Number.isInteger(bookingId) || bookingId < 1) {
        return { success: false, error: 'A valid booking must be selected' }
    }

    const parsed = cancelBookingSchema.safeParse({ reason })
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    if (!booking) return { success: false, error: 'Booking not found' }
    if (booking.status === 'Cancelled') {
        return { success: false, error: 'Booking is already cancelled' }
    }

    const performedById = await resolvePerformedById(actorId)
    const cancellationDate = new Date()

    const updated = await prisma.$transaction(async (tx) => {
        // Lock the unit row before flipping it back to Available (Req 20.5/20.6).
        await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id" = ${booking.unitId} FOR UPDATE`

        const cancelled = await tx.booking.update({
            where: { id: bookingId },
            data: {
                status: 'Cancelled',
                cancellationReason: parsed.data.reason,
                cancellationDate,
            },
        })

        await tx.possessionChecklist.deleteMany({ where: { bookingId } })

        // Return the unit to Available and detach the booking reference (Req 5.7).
        await tx.unit.update({
            where: { id: booking.unitId },
            data: { status: 'Available', bookingId: null },
        })

        await tx.dealActivity.create({
            data: {
                dealId: booking.dealId,
                type: 'BOOKING_CANCELLED',
                description: `Booking #${booking.id} cancelled: ${parsed.data.reason}`,
                performedById,
            },
        })

        return cancelled
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: updated }
}

// ═══════════════════════════════════════════════════════════
// DEMAND LETTERS & MILESTONE PAYMENTS (Module 6, Req 9.1–9.4, 9.7, 9.8, 20.7)
//
// Demand-letter generation (de-duplicated per milestone+window),
// multi-channel dispatch (WhatsApp + Email, retry ≤3, manager
// notification on failure), the overdue sweep, manual milestone
// payment capture, and the Overdue Collections aggregate.
//
// De-duplication and the unpaid/lead-window decision live in the pure
// `shouldGenerateDemand`/`aggregateOverdueCollections` helpers (`lib/demand.ts`);
// the partial/paid payment rules live in `applyMilestonePayment` (`lib/deals.ts`).
// Everything here is the I/O + persistence + transport shell.
// ═══════════════════════════════════════════════════════════

/** Per-channel demand-letter delivery statuses persisted on `DemandLetter`. */
const DEMAND_STATUS_SENT = 'Sent'
const DEMAND_STATUS_FAILED = 'Failed'

/** Maximum number of send attempts per channel before recording a failure (Req 9.3). */
const MAX_SEND_ATTEMPTS = 3

/**
 * Injectable transports for demand-letter dispatch. The defaults use the real
 * Meta Cloud API (WhatsApp) and the SMTP gateway (Email); tests pass overrides
 * so the retry / manager-notification flow can be exercised without live
 * accounts (mirrors the `OtpTransports` pattern in `app/actions/field-visits.ts`).
 */
export interface DemandTransports {
    sendWhatsApp?: (phoneE164: string, text: string) => Promise<void>
    sendEmail?: (to: string, subject: string, html: string) => Promise<void>
}

/** Default WhatsApp sender — resolves the first configured account and sends a text. */
async function defaultSendDemandWhatsApp(phoneE164: string, text: string): Promise<void> {
    const config = await prisma.waWhatsappConfig.findFirst()
    if (!config) throw new Error('WhatsApp is not configured')

    const accessToken = decrypt(config.access_token)
    await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phoneE164,
        text,
    })
}

/** Default Email sender — delegates to the shared SMTP helper and throws on failure. */
async function defaultSendDemandEmail(to: string, subject: string, html: string): Promise<void> {
    const result = await sendEmail({ to, subject, html })
    if (!result.success) throw new Error(result.error ?? 'Email send failed')
}

/**
 * Invoke a send function, retrying on failure up to `maxAttempts` times in
 * total (Req 9.3). Returns `{ ok: true }` on the first success or
 * `{ ok: false, error }` carrying the last error after all attempts fail.
 */
async function sendWithRetry(
    send: () => Promise<void>,
    maxAttempts: number = MAX_SEND_ATTEMPTS,
): Promise<{ ok: boolean; error?: string }> {
    let lastError = 'Unknown error'
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await send()
            return { ok: true }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err)
        }
    }
    return { ok: false, error: lastError }
}

/** Format a number as a 2-decimal money string for demand-letter copy. */
function formatMoney(value: number): string {
    return value.toFixed(2)
}

// ─── GENERATE DEMAND LETTERS (Req 9.1) ───────────────────

/**
 * Generate demand letters for every unpaid milestone whose due date falls
 * within the configured lead window (e.g. 7, 15, or 30 days), de-duplicating
 * per milestone + window (Req 9.1).
 *
 * The unpaid / lead-window / de-duplication decision is delegated to the pure
 * `shouldGenerateDemand` helper, which is fed each milestone's existing
 * letters so a prior letter with the same `windowDays` suppresses a duplicate.
 * Only milestones that pass the decision get a new `DemandLetter` row (created
 * in `Pending` per-channel status; dispatch is a separate step via
 * `sendDemandLetter`).
 *
 * @param windowDays The configured lead window in days (positive integer).
 * @param now Optional reference instant (defaults to the current time) — lets
 *   the cron job / tests pin the evaluation moment.
 * @returns `{ generated, letterIds }` — the count and ids of new letters.
 *
 * Requirements: 9.1
 */
export async function generateDemandLetters(windowDays: number, now: Date = new Date()) {
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
        return { success: false, error: 'Lead window must be a positive whole number of days' }
    }

    // Only unpaid milestones can qualify; fully-paid ones are excluded up front.
    const milestones = await prisma.bookingMilestone.findMany({
        where: { status: { not: 'Paid' } },
        include: { demandLetters: { select: { windowDays: true } } },
    })

    const letterIds: number[] = []

    for (const milestone of milestones) {
        const milestoneLike: MilestoneLike = {
            amount: toNumber(milestone.amount),
            paidAmount: toNumber(milestone.paidAmount),
            dueDate: milestone.dueDate,
            status: milestone.status,
        }

        if (!shouldGenerateDemand(milestoneLike, now, windowDays, milestone.demandLetters)) {
            continue
        }

        const letter = await prisma.demandLetter.create({
            data: { milestoneId: milestone.id, windowDays },
            select: { id: true },
        })
        letterIds.push(letter.id)
    }

    if (letterIds.length > 0) revalidatePath(DEALS_PATH)
    return { success: true, data: { generated: letterIds.length, letterIds } }
}

// ─── SEND DEMAND LETTER (Req 9.2, 9.3) ───────────────────

/**
 * Dispatch a demand letter to the buyer over WhatsApp and Email, recording a
 * per-channel sent status and the sent date (Req 9.2).
 *
 * Each channel is attempted with up to {@link MAX_SEND_ATTEMPTS} retries; a
 * channel that still fails is recorded as `Failed` (Req 9.3). If either channel
 * fails — or a channel is unreachable because the buyer lacks a phone/email —
 * the assigned manager is notified via the shared `notifyManagers` helper
 * (in-app Notification + Email/WhatsApp). Send failures never throw into the
 * caller; statuses are always persisted.
 *
 * Transports are injectable for testing; the defaults use the live Meta Cloud
 * API and SMTP gateway.
 *
 * @param letterId The demand letter to send.
 * @param transports Optional transport overrides (testing).
 *
 * Requirements: 9.2, 9.3
 */
export async function sendDemandLetter(
    letterId: number,
    transports?: DemandTransports,
): Promise<
    | {
        success: true
        data: {
            letterId: number
            whatsappStatus: string
            emailStatus: string
            sentDate: Date | null
        }
    }
    | { success: false; error: string }
> {
    if (!Number.isInteger(letterId) || letterId < 1) {
        return { success: false, error: 'A valid demand letter must be selected' }
    }

    const letter = await prisma.demandLetter.findUnique({
        where: { id: letterId },
        include: {
            milestone: { include: { booking: { include: { contact: true } } } },
        },
    })
    if (!letter) return { success: false, error: 'Demand letter not found' }

    const sendWhatsApp = transports?.sendWhatsApp ?? defaultSendDemandWhatsApp
    const sendEmailFn = transports?.sendEmail ?? defaultSendDemandEmail

    const milestone = letter.milestone
    const contact = milestone.booking.contact
    const amountDue = Math.max(0, toNumber(milestone.amount) - toNumber(milestone.paidAmount))
    const dueDateStr = milestone.dueDate.toISOString().slice(0, 10)

    const messageText =
        `Dear ${contact.name}, this is a payment reminder for the milestone ` +
        `"${milestone.name}" of AED ${formatMoney(amountDue)} due on ${dueDateStr}. ` +
        `Please arrange payment at the earliest.`
    const emailSubject = `Payment reminder: ${milestone.name} due ${dueDateStr}`
    const emailHtml =
        `<p>Dear ${contact.name},</p>` +
        `<p>This is a payment reminder for the milestone <strong>${milestone.name}</strong> ` +
        `of <strong>AED ${formatMoney(amountDue)}</strong> due on <strong>${dueDateStr}</strong>.</p>` +
        `<p>Please arrange payment at the earliest.</p>`

    // ── WhatsApp channel ─────────────────────────────────
    let whatsappStatus = DEMAND_STATUS_FAILED
    let whatsappError = 'Buyer has no valid phone number'
    const phoneE164 = normalizePhoneForMetaUae(contact.phone)
    if (isValidE164(phoneE164)) {
        const result = await sendWithRetry(() => sendWhatsApp(phoneE164, messageText))
        whatsappStatus = result.ok ? DEMAND_STATUS_SENT : DEMAND_STATUS_FAILED
        whatsappError = result.error ?? whatsappError
    }

    // ── Email channel ────────────────────────────────────
    let emailStatus = DEMAND_STATUS_FAILED
    let emailError = 'Buyer has no email address'
    if (contact.email) {
        const result = await sendWithRetry(() => sendEmailFn(contact.email!, emailSubject, emailHtml))
        emailStatus = result.ok ? DEMAND_STATUS_SENT : DEMAND_STATUS_FAILED
        emailError = result.error ?? emailError
    }

    const updated = await prisma.demandLetter.update({
        where: { id: letterId },
        data: { whatsappStatus, emailStatus, sentDate: new Date() },
    })

    // On any channel failure, notify the assigned manager (Req 9.3).
    const failedChannels: string[] = []
    if (whatsappStatus !== DEMAND_STATUS_SENT) failedChannels.push(`WhatsApp (${whatsappError})`)
    if (emailStatus !== DEMAND_STATUS_SENT) failedChannels.push(`Email (${emailError})`)

    if (failedChannels.length > 0) {
        await notifyManagers({
            type: 'financial_alert',
            title: 'Demand letter delivery failed',
            subtitle: `Could not deliver the demand letter for "${milestone.name}" to ${contact.name}: ${failedChannels.join('; ')}`,
            href: DEALS_PATH,
            metadata: { letterId, milestoneId: milestone.id, failedChannels },
            emailSubject: `Demand letter delivery failed for ${contact.name}`,
            emailHtml:
                `<p>The demand letter for milestone <strong>${milestone.name}</strong> ` +
                `(buyer ${contact.name}) could not be delivered on: ${failedChannels.join('; ')}.</p>`,
            whatsappText:
                `Demand letter delivery failed for ${contact.name} — milestone "${milestone.name}". ` +
                `Failed channels: ${failedChannels.join('; ')}.`,
        })
    }

    revalidatePath(DEALS_PATH)
    return {
        success: true,
        data: { letterId: updated.id, whatsappStatus, emailStatus, sentDate: updated.sentDate },
    }
}

// ─── SWEEP OVERDUE MILESTONES (Req 9.4) ──────────────────

/**
 * Flip unpaid, past-due milestones to `Overdue` and notify the assigned
 * manager via the existing Notification model (Req 9.4).
 *
 * Candidate milestones (anything not already fully paid) have their status
 * re-derived with the shared `milestoneStatus` helper so the "Overdue"
 * definition stays consistent with the booking engine. Only milestones that
 * newly transition into `Overdue` (their persisted status was not already
 * `Overdue`) are updated and trigger a manager notification, so the sweep is
 * idempotent and does not re-alert on every run.
 *
 * @param now Optional reference instant (defaults to the current time).
 * @returns `{ sweptCount, milestoneIds }` — the milestones newly marked overdue.
 *
 * Requirements: 9.4
 */
export async function sweepOverdueMilestones(now: Date = new Date()) {
    const milestones = await prisma.bookingMilestone.findMany({
        where: { status: { not: 'Paid' } },
        include: { booking: { include: { contact: { select: { name: true } } } } },
    })

    const newlyOverdue: { id: number; name: string; contactName: string }[] = []

    for (const milestone of milestones) {
        const derived = milestoneStatus(
            {
                amount: toNumber(milestone.amount),
                paidAmount: toNumber(milestone.paidAmount),
                dueDate: milestone.dueDate,
            },
            now,
        )

        if (derived === 'Overdue' && milestone.status !== 'Overdue') {
            await prisma.bookingMilestone.update({
                where: { id: milestone.id },
                data: { status: 'Overdue' },
            })
            newlyOverdue.push({
                id: milestone.id,
                name: milestone.name,
                contactName: milestone.booking.contact?.name ?? 'the buyer',
            })
        }
    }

    // Notify managers per newly-overdue milestone (Req 9.4).
    for (const m of newlyOverdue) {
        await notifyManagers({
            type: 'financial_alert',
            title: 'Milestone overdue',
            subtitle: `Milestone "${m.name}" for ${m.contactName} is now overdue.`,
            href: DEALS_PATH,
            metadata: { milestoneId: m.id },
            emailSubject: `Milestone overdue: ${m.name}`,
            emailHtml: `<p>Milestone <strong>${m.name}</strong> for ${m.contactName} is now overdue.</p>`,
            whatsappText: `Milestone "${m.name}" for ${m.contactName} is now overdue.`,
        })
    }

    if (newlyOverdue.length > 0) revalidatePath(DEALS_PATH)
    return {
        success: true,
        data: { sweptCount: newlyOverdue.length, milestoneIds: newlyOverdue.map((m) => m.id) },
    }
}

// ─── RECORD MILESTONE PAYMENT (Req 9.7, 9.8) ─────────────

/**
 * Record a manual payment against a booking milestone (Req 9.7, 9.8).
 *
 * The partial/paid decision and validation are delegated to the pure
 * `applyMilestonePayment` helper: a payment that is zero, negative, not a
 * finite number, or greater than the milestone's outstanding amount is
 * rejected and the milestone is left unchanged (Req 9.8). On a valid payment
 * the amount is added to `paidAmount` and the status becomes `Paid` when the
 * milestone is fully covered, or `Partially_Paid` otherwise (Req 9.7).
 *
 * @param milestoneId The milestone receiving the payment.
 * @param amount The payment amount.
 *
 * Requirements: 9.7, 9.8
 */
export async function recordMilestonePayment(milestoneId: number, amount: number) {
    if (!Number.isInteger(milestoneId) || milestoneId < 1) {
        return { success: false, error: 'A valid milestone must be selected' }
    }

    const milestone = await prisma.bookingMilestone.findUnique({ where: { id: milestoneId } })
    if (!milestone) return { success: false, error: 'Milestone not found' }

    const result = applyMilestonePayment(
        {
            amount: toNumber(milestone.amount),
            paidAmount: toNumber(milestone.paidAmount),
            dueDate: milestone.dueDate,
            status: milestone.status,
        },
        amount,
    )

    // Reject invalid payments and leave the milestone unchanged (Req 9.8).
    if (!result.ok || !result.milestone) {
        return { success: false, error: result.error ?? 'Payment could not be applied' }
    }

    const updated = await prisma.bookingMilestone.update({
        where: { id: milestoneId },
        data: {
            paidAmount: result.milestone.paidAmount,
            status: result.milestone.status,
        },
    })

    revalidatePath(DEALS_PATH)
    return { success: true, data: updated }
}

// ─── OVERDUE COLLECTIONS WIDGET (Req 9.6) ────────────────

/**
 * Return the Overdue Collections figures for the dashboard widget: the count
 * of overdue milestones and the sum of their unpaid amounts (Req 9.6).
 *
 * Aggregation is delegated to the pure `aggregateOverdueCollections` helper,
 * fed the current time so each milestone's overdue status is derived
 * consistently with the booking engine rather than trusting a possibly-stale
 * persisted status.
 *
 * Requirements: 9.6
 */
export async function getOverdueCollections(now: Date = new Date()) {
    const milestones = await prisma.bookingMilestone.findMany({
        where: { status: { not: 'Paid' } },
        select: { amount: true, paidAmount: true, dueDate: true, status: true },
    })

    const data = aggregateOverdueCollections(
        milestones.map((m) => ({
            amount: toNumber(m.amount),
            paidAmount: toNumber(m.paidAmount),
            dueDate: m.dueDate,
            status: m.status,
        })),
        now,
    )

    return { success: true, data }
}


// ─── Default pipeline seeding ─────────────────────────
/**
 * Create a standard real-estate deal pipeline if none exists yet. Idempotent:
 * a no-op when any stage is already configured, so the "Set up default
 * pipeline" button can be shown safely whenever the board is empty.
 */
export async function seedDefaultDealStages() {
    const count = await prisma.dealStage.count()
    if (count > 0) return { success: true as const, data: { created: 0 } }

    const defaults = [
        { name: 'New Inquiry', order: 1, color: '#3b82f6', isWon: false, isLost: false },
        { name: 'Site Visit Scheduled', order: 2, color: '#8b5cf6', isWon: false, isLost: false },
        { name: 'Site Visit Done', order: 3, color: '#06b6d4', isWon: false, isLost: false },
        { name: 'Negotiation', order: 4, color: '#f59e0b', isWon: false, isLost: false },
        { name: 'Booked / Won', order: 5, color: '#10b981', isWon: true, isLost: false },
        { name: 'Lost', order: 6, color: '#ef4444', isWon: false, isLost: true },
    ]

    await prisma.dealStage.createMany({ data: defaults })
    revalidatePath(DEALS_PATH)
    return { success: true as const, data: { created: defaults.length } }
}

// ─── Deal inline-edit + manual activity logging ─────────────────────────────

/**
 * Update editable fields of a deal (value, expected close, source, assigned
 * agent, notes) and write an audit note. Does not change stage — stage moves
 * go through `moveDeal` so the stage-transition rules (Req 4.9) always apply.
 */
export async function updateDeal(
    id: number,
    data: {
        value?: number
        expectedCloseDate?: string | null
        source?: string | null
        assignedAgentId?: number | null
        notes?: string | null
    },
) {
    if (!Number.isInteger(id) || id < 1) return { success: false as const, error: 'Invalid deal id' }

    const deal = await prisma.deal.findUnique({ where: { id }, select: { id: true } })
    if (!deal) return { success: false as const, error: 'Deal not found' }

    const update: Record<string, unknown> = {}
    const changes: string[] = []

    if (data.value !== undefined) {
        if (!Number.isFinite(data.value) || data.value < 0) {
            return { success: false as const, error: 'Deal value must be a non-negative number' }
        }
        update.value = new Prisma.Decimal(data.value)
        changes.push('value')
    }
    if (data.expectedCloseDate !== undefined) {
        if (data.expectedCloseDate) {
            const d = new Date(data.expectedCloseDate)
            if (Number.isNaN(d.getTime())) return { success: false as const, error: 'Invalid expected close date' }
            update.expectedCloseDate = d
        } else {
            update.expectedCloseDate = null
        }
        changes.push('expected close')
    }
    if (data.source !== undefined) { update.source = data.source?.trim() || null; changes.push('source') }
    if (data.notes !== undefined) { update.notes = data.notes?.trim() || null; changes.push('notes') }
    if (data.assignedAgentId !== undefined) {
        if (data.assignedAgentId != null) {
            const staff = await prisma.staff.findUnique({ where: { id: data.assignedAgentId }, select: { id: true } })
            if (!staff) return { success: false as const, error: 'Assigned agent not found' }
            update.assignedAgentId = data.assignedAgentId
        } else {
            update.assignedAgentId = null
        }
        changes.push('assigned agent')
    }

    if (Object.keys(update).length === 0) {
        return { success: false as const, error: 'No changes to save' }
    }

    try {
        const performedById = await resolvePerformedById()
        await prisma.$transaction([
            prisma.deal.update({ where: { id }, data: update }),
            prisma.dealActivity.create({
                data: {
                    dealId: id,
                    type: 'UPDATE',
                    description: `Deal updated (${changes.join(', ')})`,
                    performedById,
                },
            }),
        ])
        revalidatePath(DEALS_PATH)
        revalidatePath(`/deals/${id}`)
        return { success: true as const }
    } catch (error) {
        console.error('Error updating deal:', error)
        return { success: false as const, error: 'Failed to update deal' }
    }
}

const DEAL_ACTIVITY_TYPES = ['note', 'call', 'email', 'visit', 'meeting'] as const

/**
 * Manually log an activity (note / call / email / visit / meeting) against a
 * deal's timeline.
 */
export async function addDealActivity(input: {
    dealId: number
    type: string
    description: string
}) {
    const dealId = Number(input?.dealId)
    if (!Number.isInteger(dealId) || dealId < 1) return { success: false as const, error: 'Invalid deal id' }

    const type = String(input?.type || '').toLowerCase()
    if (!(DEAL_ACTIVITY_TYPES as readonly string[]).includes(type)) {
        return { success: false as const, error: 'Invalid activity type' }
    }
    const description = String(input?.description || '').trim()
    if (!description) return { success: false as const, error: 'A description is required' }
    if (description.length > 2000) return { success: false as const, error: 'Description is too long' }

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } })
    if (!deal) return { success: false as const, error: 'Deal not found' }

    try {
        const performedById = await resolvePerformedById()
        await prisma.dealActivity.create({
            data: { dealId, type, description, performedById },
        })
        revalidatePath(`/deals/${dealId}`)
        return { success: true as const }
    } catch (error) {
        console.error('Error logging deal activity:', error)
        return { success: false as const, error: 'Failed to log activity' }
    }
}
