'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import { computeCommission, type CommissionSlab } from '@/lib/commission'
import { roundMoney } from '@/lib/money'
import {
    approveCommissionSchema,
    completePayoutBatchSchema,
    createCommissionSchema,
    createCpLeadSchema,
    createPayoutBatchSchema,
    onboardPartnerSchema,
} from '@/lib/validations/channel-partners'
// `Prisma` is a value import because `Prisma.DbNull` is used at runtime.
import { Prisma } from '@prisma/client'
import type {
    CommissionStatus,
    CommissionType,
} from '@prisma/client'

/**
 * Channel Partner admin server actions (Module 4 / Requirement 6).
 *
 * These actions back the internal channel-partners admin surface:
 *   - `onboardPartner`      — create a ChannelPartner; BRN number is
 *                             required and must be unique (Req 6.1, 6.9).
 *   - `createCpLead`        — attribute a lead to a partner (Req 6.2).
 *   - `createCommission`    — compute and persist a CPCommission for a booking
 *                             via the pure `computeCommission` helper (Req 6.3,
 *                             6.4, 6.5, 6.8).
 *   - `approveCommission`   — approve a commission and record the approver
 *                             (Req 6.3, 20.7).
 *   - `createPayoutBatch`   — group commissions into a CPPayoutBatch (Req 6.6).
 *   - `completePayoutBatch` — complete a batch and set every included
 *                             commission to Paid in a single transaction
 *                             (Req 6.6, 20.6, 20.7).
 *   - `getPartnerMetrics`   — partner count, commission totals by status, and
 *                             pending payout total (Req 6.7).
 *
 * Conventions follow the existing `app/actions/*` style: a `'use server'`
 * module that validates input with Zod, returns a discriminated
 * `{ success, data | error }` result, and revalidates affected paths.
 */

const ADMIN_PATH = '/channel-partners'

type Result<T> = { success: true; data: T } | { success: false; error: string }

/** Convert a Prisma `Decimal` (or numeric) to a JS number. */
function toNumber(value: Prisma.Decimal | number | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === 'number' ? value : Number(value)
}

/**
 * Resolve the acting principal for audit purposes (Req 20.7). Prefers the
 * linked `staffId`, falling back to the numeric session user id.
 */
function actorId(session: Awaited<ReturnType<typeof requireAuth>>): number | null {
    const staffId = session.user.staffId
    if (typeof staffId === 'number' && Number.isFinite(staffId)) return staffId
    const numericId = Number(session.user.id)
    return Number.isFinite(numericId) ? numericId : null
}

// ─── Onboard partner (Req 6.1, 6.9) ──────────────────

export async function onboardPartner(data: unknown): Promise<Result<{ id: number }>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = onboardPartnerSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const input = parsed.data

    // Req 6.9: reject a BRN number that already exists on another partner.
    const existingRera = await prisma.channelPartner.findUnique({
        where: { brnNumber: input.brnNumber },
        select: { id: true },
    })
    if (existingRera) {
        return {
            success: false,
            error: `BRN number "${input.brnNumber}" is already registered to another partner`,
        }
    }

    // Email is unique in the schema; surface a friendly error before the write.
    const existingEmail = await prisma.channelPartner.findUnique({
        where: { email: input.email },
        select: { id: true },
    })
    if (existingEmail) {
        return { success: false, error: `Email "${input.email}" is already registered to another partner` }
    }

    const partner = await prisma.channelPartner.create({
        data: {
            name: input.name,
            company: input.company ?? null,
            brnNumber: input.brnNumber,
            ornNumber: input.ornNumber ?? null,
            phone: input.phone,
            email: input.email,
            type: input.type,
            status: input.status,
            commissionType: input.commissionType,
            commissionRate: input.commissionRate,
            fixedCommission: input.fixedCommission,
            commissionSlabs: input.commissionSlabs
                ? (input.commissionSlabs as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            agreementDocUrl: input.agreementDocUrl ?? null,
            tradeLicenseNo: input.tradeLicenseNo ?? null,
            bankDetails: input.bankDetails
                ? (input.bankDetails as Prisma.InputJsonValue)
                : Prisma.DbNull,
        },
        select: { id: true },
    })

    revalidatePath(ADMIN_PATH)
    return { success: true, data: { id: partner.id } }
}

// ─── CP lead attribution (Req 6.2) ───────────────────

export async function createCpLead(data: unknown): Promise<Result<{ id: number }>> {
    try {
        await requireRole('ADMIN', 'MANAGER', 'STAFF')
    } catch {
        return { success: false, error: 'Unauthorized' }
    }

    const parsed = createCpLeadSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { partnerId, leadId, status, commissionEligible, attributionVerified } = parsed.data

    const partner = await prisma.channelPartner.findUnique({
        where: { id: partnerId },
        select: { id: true },
    })
    if (!partner) return { success: false, error: 'Channel partner not found' }

    if (leadId !== undefined) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
        if (!lead) return { success: false, error: 'Lead not found' }

        const alreadyLinked = await prisma.cPLead.findUnique({
            where: { leadId },
            select: { id: true },
        })
        if (alreadyLinked) {
            return { success: false, error: 'Lead is already attributed to a channel partner' }
        }
    }

    const cpLead = await prisma.cPLead.create({
        data: {
            partnerId,
            leadId: leadId ?? null,
            status,
            commissionEligible,
            attributionVerified,
        },
        select: { id: true },
    })

    revalidatePath(ADMIN_PATH)
    return { success: true, data: { id: cpLead.id } }
}

// ─── Commission creation (Req 6.3, 6.4, 6.5, 6.8) ────

export async function createCommission(data: unknown): Promise<Result<{ id: number; amount: number }>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = createCommissionSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { partnerId, dealId, bookingId } = parsed.data

    const partner = await prisma.channelPartner.findUnique({ where: { id: partnerId } })
    if (!partner) return { success: false, error: 'Channel partner not found' }
    if (partner.status !== 'Active') return { success: false, error: 'Only active channel partners can earn new commissions' }

    // The agreement value comes from the booking; a commission needs one to be
    // computable for Percentage/Slab partners.
    let agreementValue = 0
    if (bookingId !== undefined) {
        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, dealId: true, agreementValue: true },
        })
        if (!booking) return { success: false, error: 'Booking not found' }
        if (dealId !== undefined && booking.dealId !== dealId) {
            return { success: false, error: 'The booking and deal references do not match' }
        }
        agreementValue = toNumber(booking.agreementValue)
    }

    if (dealId !== undefined) {
        const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, value: true } })
        if (!deal) return { success: false, error: 'Deal not found' }
        // A deal-only commission uses the deal value until a booking exists.
        if (bookingId === undefined) agreementValue = toNumber(deal.value)
    }

    if ((partner.commissionType === 'Percentage' || partner.commissionType === 'Slab') && agreementValue <= 0) {
        return { success: false, error: 'A positive deal value or booking agreement value is required for this commission type' }
    }

    const amount = computeCommission(
        partner.commissionType as CommissionType,
        toNumber(partner.commissionRate),
        toNumber(partner.fixedCommission),
        partner.commissionSlabs as unknown as CommissionSlab[] | null,
        agreementValue
    )

    // Persist the effective percentage only for Percentage partners; Fixed/Slab
    // commissions are not expressible as a single agreement-value percentage.
    const percentage =
        partner.commissionType === 'Percentage' ? toNumber(partner.commissionRate) : 0

    const commission = await prisma.cPCommission.create({
        data: {
            partnerId,
            dealId: dealId ?? null,
            bookingId: bookingId ?? null,
            amount,
            percentage,
            status: 'Pending',
        },
        select: { id: true },
    })

    revalidatePath(ADMIN_PATH)
    return { success: true, data: { id: commission.id, amount } }
}

// ─── Commission approval (Req 6.3, 20.7) ─────────────

export async function approveCommission(data: unknown): Promise<Result<{ id: number }>> {
    let session: Awaited<ReturnType<typeof requireAuth>>
    try {
        session = await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = approveCommissionSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const commission = await prisma.cPCommission.findUnique({
        where: { id: parsed.data.commissionId },
        select: { id: true, status: true },
    })
    if (!commission) return { success: false, error: 'Commission not found' }
    if (commission.status !== 'Pending' && commission.status !== 'Disputed') {
        return { success: false, error: `A ${commission.status.toLowerCase()} commission cannot be approved` }
    }

    const updated = await prisma.cPCommission.update({
        where: { id: commission.id },
        // Req 20.7: record who approved the commission.
        data: { status: 'Approved', approvedById: actorId(session) },
        select: { id: true },
    })

    revalidatePath(ADMIN_PATH)
    return { success: true, data: { id: updated.id } }
}

// ─── Payout batch creation (Req 6.6) ─────────────────

export async function createPayoutBatch(
    data: unknown
): Promise<Result<{ id: number; totalAmount: number; partnerCount: number }>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = createPayoutBatchSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { batchName, commissionIds } = parsed.data
    const uniqueIds = Array.from(new Set(commissionIds))

    try {
        const result = await prisma.$transaction(async (tx) => {
            const commissions = await tx.cPCommission.findMany({
                where: { id: { in: uniqueIds } },
                select: { id: true, partnerId: true, amount: true, status: true, payoutBatchId: true },
            })

            if (commissions.length !== uniqueIds.length) {
                throw new Error('One or more commissions were not found')
            }

            const alreadyBatched = commissions.find((c) => c.payoutBatchId !== null)
            if (alreadyBatched) {
                throw new Error(`Commission ${alreadyBatched.id} is already part of a payout batch`)
            }

            const notApproved = commissions.find((c) => c.status !== 'Approved')
            if (notApproved) {
                throw new Error(`Commission ${notApproved.id} must be approved before it can be paid`)
            }

            const totalAmount = roundMoney(
                commissions.reduce((sum, c) => sum + toNumber(c.amount), 0)
            )
            const partnerCount = new Set(commissions.map((c) => c.partnerId)).size

            const batch = await tx.cPPayoutBatch.create({
                data: { batchName, totalAmount, partnerCount, status: 'Draft' },
                select: { id: true },
            })

            await tx.cPCommission.updateMany({
                where: { id: { in: uniqueIds } },
                data: { payoutBatchId: batch.id },
            })

            return { id: batch.id, totalAmount, partnerCount }
        })

        revalidatePath(ADMIN_PATH)
        return { success: true, data: result }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to create payout batch' }
    }
}

// ─── Payout batch completion (Req 6.6, 20.6, 20.7) ───

export async function completePayoutBatch(
    data: unknown
): Promise<Result<{ id: number; commissionsPaid: number }>> {
    let session: Awaited<ReturnType<typeof requireAuth>>
    try {
        session = await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const parsed = completePayoutBatchSchema.safeParse(data)
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0].message }
    }

    const { batchId, utr } = parsed.data
    const approverId = actorId(session)

    try {
        const result = await prisma.$transaction(async (tx) => {
            const batch = await tx.cPPayoutBatch.findUnique({
                where: { id: batchId },
                select: { id: true, status: true },
            })
            if (!batch) throw new Error('Payout batch not found')
            if (batch.status === 'Completed') throw new Error('Payout batch is already completed')

            const batchCommissions = await tx.cPCommission.findMany({
                where: { payoutBatchId: batchId },
                select: { id: true, status: true },
            })
            if (batchCommissions.length === 0) throw new Error('Payout batch has no commissions')
            const notApproved = batchCommissions.find((commission) => commission.status !== 'Approved')
            if (notApproved) throw new Error(`Commission ${notApproved.id} must be approved before payout`)

            const paymentDate = new Date()

            // Req 6.6: completing the batch sets every included commission to Paid.
            // Done together with the batch status change in one transaction so
            // partial updates never persist (Req 20.6).
            const paid = await tx.cPCommission.updateMany({
                where: { payoutBatchId: batchId },
                data: {
                    status: 'Paid',
                    paymentDate,
                    // Req 20.7: record the approver/payer on each paid commission.
                    approvedById: approverId,
                    ...(utr ? { utr } : {}),
                },
            })

            await tx.cPPayoutBatch.update({
                where: { id: batchId },
                data: { status: 'Completed' },
            })

            return { id: batchId, commissionsPaid: paid.count }
        })

        revalidatePath(ADMIN_PATH)
        return { success: true, data: result }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to complete payout batch' }
    }
}

// ─── Partner metrics (Req 6.7) ───────────────────────

export interface PartnerMetrics {
    partnerCount: number
    commissionByStatus: Record<CommissionStatus, { count: number; amount: number }>
    totalCommissionAmount: number
    pendingPayoutTotal: number
}

export async function getPartnerMetrics(): Promise<Result<PartnerMetrics>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const [partnerCount, grouped] = await Promise.all([
        prisma.channelPartner.count(),
        prisma.cPCommission.groupBy({
            by: ['status'],
            _count: { _all: true },
            _sum: { amount: true },
        }),
    ])

    const statuses: CommissionStatus[] = ['Pending', 'Approved', 'Paid', 'Disputed']
    const commissionByStatus = statuses.reduce(
        (acc, status) => {
            acc[status] = { count: 0, amount: 0 }
            return acc
        },
        {} as Record<CommissionStatus, { count: number; amount: number }>
    )

    let totalCommissionAmount = 0
    for (const row of grouped) {
        const amount = roundMoney(toNumber(row._sum.amount))
        commissionByStatus[row.status as CommissionStatus] = {
            count: row._count._all,
            amount,
        }
        totalCommissionAmount += amount
    }
    totalCommissionAmount = roundMoney(totalCommissionAmount)

    // Pending payout total = approved commissions awaiting payment.
    const pendingPayoutTotal = commissionByStatus.Approved.amount

    return {
        success: true,
        data: {
            partnerCount,
            commissionByStatus,
            totalCommissionAmount,
            pendingPayoutTotal,
        },
    }
}

// ─── Admin read views (Req 6.7) ──────────────────────

export interface PartnerRow {
    id: number
    name: string
    company: string | null
    brnNumber: string
    phone: string
    email: string
    type: string
    status: string
    commissionType: string
    commissionRate: number
    fixedCommission: number
    onboardingDate: string
    commissionCount: number
}

/** List all channel partners for the admin listing (Req 6.7). */
export async function getPartners(): Promise<Result<PartnerRow[]>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const partners = await prisma.channelPartner.findMany({
        orderBy: { id: 'desc' },
        select: {
            id: true,
            name: true,
            company: true,
            brnNumber: true,
            phone: true,
            email: true,
            type: true,
            status: true,
            commissionType: true,
            commissionRate: true,
            fixedCommission: true,
            onboardingDate: true,
            _count: { select: { commissions: true } },
        },
    })

    return {
        success: true,
        data: partners.map((p) => ({
            id: p.id,
            name: p.name,
            company: p.company,
            brnNumber: p.brnNumber,
            phone: p.phone,
            email: p.email,
            type: p.type,
            status: p.status,
            commissionType: p.commissionType,
            commissionRate: toNumber(p.commissionRate),
            fixedCommission: toNumber(p.fixedCommission),
            onboardingDate: p.onboardingDate.toISOString(),
            commissionCount: p._count.commissions,
        })),
    }
}

export interface CommissionRow {
    id: number
    partnerId: number
    partnerName: string
    amount: number
    percentage: number
    status: CommissionStatus
    dealId: number | null
    bookingId: number | null
    payoutBatchId: number | null
    paymentDate: string | null
    utr: string | null
}

/** Commission ledger across all partners for the admin view (Req 6.7). */
export async function getCommissions(): Promise<Result<CommissionRow[]>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const commissions = await prisma.cPCommission.findMany({
        orderBy: { id: 'desc' },
        select: {
            id: true,
            partnerId: true,
            partner: { select: { name: true } },
            amount: true,
            percentage: true,
            status: true,
            dealId: true,
            bookingId: true,
            payoutBatchId: true,
            paymentDate: true,
            utr: true,
        },
    })

    return {
        success: true,
        data: commissions.map((c) => ({
            id: c.id,
            partnerId: c.partnerId,
            partnerName: c.partner.name,
            amount: toNumber(c.amount),
            percentage: toNumber(c.percentage),
            status: c.status as CommissionStatus,
            dealId: c.dealId,
            bookingId: c.bookingId,
            payoutBatchId: c.payoutBatchId,
            paymentDate: c.paymentDate ? c.paymentDate.toISOString() : null,
            utr: c.utr,
        })),
    }
}

export interface PayoutBatchRow {
    id: number
    batchName: string
    totalAmount: number
    partnerCount: number
    commissionCount: number
    date: string
    status: string
}

/** List payout batches for the admin payout-batch management view (Req 6.6, 6.7). */
export async function getPayoutBatches(): Promise<Result<PayoutBatchRow[]>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    const batches = await prisma.cPPayoutBatch.findMany({
        orderBy: { id: 'desc' },
        select: {
            id: true,
            batchName: true,
            totalAmount: true,
            partnerCount: true,
            date: true,
            status: true,
            _count: { select: { commissions: true } },
        },
    })

    return {
        success: true,
        data: batches.map((b) => ({
            id: b.id,
            batchName: b.batchName,
            totalAmount: toNumber(b.totalAmount),
            partnerCount: b.partnerCount,
            commissionCount: b._count.commissions,
            date: b.date.toISOString(),
            status: b.status,
        })),
    }
}
