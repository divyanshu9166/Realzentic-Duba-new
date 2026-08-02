'use server'

/**
 * Reports & Analytics service.
 *
 * Consolidates the CRM's existing operational data into a single set of
 * sales/lead/inventory/collections KPIs for the Dashboard analytics section. Read-only
 * aggregation over Leads, Deals, Bookings, BookingMilestones, Units and Staff —
 * no new models. Every figure is computed live so the report always reflects
 * current state.
 */

import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'

type Result<T> = { success: true; data: T } | { success: false; error: string }

/** Coerce a Prisma numeric (Int | Decimal | null) to a plain JS number. */
function toNum(v: unknown): number {
    if (v == null) return 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0
    if (typeof v === 'object' && v !== null && 'toNumber' in (v as Record<string, unknown>)) {
        try {
            return (v as { toNumber: () => number }).toNumber()
        } catch {
            return 0
        }
    }
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

const LEAD_STATUS_ORDER = ['NEW', 'CONTACTED', 'SHOWROOM_VISIT', 'QUOTATION', 'WON', 'LOST'] as const
const LEAD_STATUS_LABEL: Record<string, string> = {
    NEW: 'New',
    CONTACTED: 'Contacted',
    SHOWROOM_VISIT: 'Site Visit',
    QUOTATION: 'Quotation',
    WON: 'Won',
    LOST: 'Lost',
}

export interface CrmReports {
    generatedAt: string
    leads: {
        total: number
        funnel: Array<{ status: string; label: string; count: number }>
        bySource: Array<{ source: string; count: number }>
        conversionRate: number // Won / total (%)
    }
    deals: {
      total: number
      openValue: number
      byStage: Array<{ stage: string; count: number; value: number; isWon: boolean; isLost: boolean }>
      lostReasons: Array<{ reason: string; count: number }>
    }
    bookings: {
        count: number
        agreementValue: number
    }
    collections: {
        demanded: number
        collected: number
        outstanding: number
        overdueMilestones: number
        collectionRate: number // collected / demanded (%)
    }
    inventory: {
        totalUnits: number
        byStatus: Array<{ status: string; count: number }>
        absorptionRate: number // (Booked + Sold) / total (%)
        availableStockValue: number
    }
    topAgents: Array<{ agentId: number; name: string; wonDeals: number; wonValue: number }>
}

export async function getCrmReports(): Promise<Result<CrmReports>> {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false, error: 'Admin or manager access required' }
    }

    try {
        const [
            leadGroups,
            leadSourceGroups,
            leadTotal,
            stages,
            dealGroups,
            bookingAgg,
            milestoneAgg,
            overdueCount,
            unitGroups,
            availableAgg,
            wonDealGroups,
            lostReasonGroups,
        ] = await Promise.all([
            prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
            prisma.lead.groupBy({ by: ['source'], _count: { _all: true } }),
            prisma.lead.count(),
            prisma.dealStage.findMany({ orderBy: { order: 'asc' } }),
            prisma.deal.groupBy({ by: ['stageId'], _count: { _all: true }, _sum: { value: true } }),
            prisma.booking.aggregate({ _count: { _all: true }, _sum: { agreementValue: true } }),
            prisma.bookingMilestone.aggregate({ _sum: { amount: true, paidAmount: true } }),
            prisma.bookingMilestone.count({ where: { status: 'Overdue' } }),
            prisma.unit.groupBy({ by: ['status'], _count: { _all: true } }),
            prisma.unit.aggregate({ where: { status: 'Available' }, _sum: { totalPrice: true } }),
            prisma.deal.groupBy({
                by: ['assignedAgentId'],
                where: { stage: { isWon: true }, assignedAgentId: { not: null } },
                _count: { _all: true },
                _sum: { value: true },
            }),
            prisma.deal.groupBy({
                by: ['lostReason'],
                where: { stage: { isLost: true }, lostReason: { not: null } },
                _count: { _all: true },
            }),
        ])

        // ── Leads funnel ──────────────────────────────────────
        const leadCountByStatus = new Map<string, number>()
        for (const g of leadGroups) leadCountByStatus.set(g.status, g._count._all)
        const funnel = LEAD_STATUS_ORDER.map((status) => ({
            status,
            label: LEAD_STATUS_LABEL[status] ?? status,
            count: leadCountByStatus.get(status) ?? 0,
        }))
        const wonLeads = leadCountByStatus.get('WON') ?? 0
        const conversionRate = leadTotal > 0 ? Math.round((wonLeads / leadTotal) * 100) : 0

        const bySource = leadSourceGroups
            .map((g) => ({ source: g.source ?? 'Unknown', count: g._count._all }))
            .sort((a, b) => b.count - a.count)

        // ── Deal pipeline ─────────────────────────────────────
        const stageById = new Map(stages.map((s) => [s.id, s]))
        const byStage = dealGroups
            .map((g) => {
                const stage = stageById.get(g.stageId)
                return {
                    stage: stage?.name ?? `Stage ${g.stageId}`,
                    count: g._count._all,
                    value: toNum(g._sum.value),
                    isWon: stage?.isWon ?? false,
                    isLost: stage?.isLost ?? false,
                    order: stage?.order ?? 9999,
                }
            })
            .sort((a, b) => a.order - b.order)
            .map(({ order: _order, ...rest }) => rest)

        const dealTotal = byStage.reduce((s, d) => s + d.count, 0)
        const openValue = byStage
            .filter((d) => !d.isWon && !d.isLost)
            .reduce((s, d) => s + d.value, 0)

        // ── Bookings & collections ────────────────────────────
        const demanded = toNum(milestoneAgg._sum.amount)
        const collected = toNum(milestoneAgg._sum.paidAmount)
        const outstanding = Math.max(0, demanded - collected)
        const collectionRate = demanded > 0 ? Math.round((collected / demanded) * 100) : 0

        // ── Inventory ─────────────────────────────────────────
        const byStatus = unitGroups.map((g) => ({ status: g.status, count: g._count._all }))
        const totalUnits = byStatus.reduce((s, u) => s + u.count, 0)
        const soldOrBooked = byStatus
            .filter((u) => u.status === 'Booked' || u.status === 'Sold')
            .reduce((s, u) => s + u.count, 0)
        const absorptionRate = totalUnits > 0 ? Math.round((soldOrBooked / totalUnits) * 100) : 0

        // ── Top agents (won deals) ────────────────────────────
        const agentIds = wonDealGroups
            .map((g) => g.assignedAgentId)
            .filter((id): id is number => id != null)
        const agents = agentIds.length
            ? await prisma.staff.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
            : []
        const agentName = new Map(agents.map((a) => [a.id, a.name]))
        const topAgents = wonDealGroups
            .filter((g) => g.assignedAgentId != null)
            .map((g) => ({
                agentId: g.assignedAgentId as number,
                name: agentName.get(g.assignedAgentId as number) ?? 'Unknown',
                wonDeals: g._count._all,
                wonValue: toNum(g._sum.value),
            }))
            .sort((a, b) => b.wonValue - a.wonValue)
            .slice(0, 5)

        return {
            success: true,
            data: {
                generatedAt: new Date().toISOString(),
                leads: { total: leadTotal, funnel, bySource, conversionRate },
                deals: { total: dealTotal, openValue, byStage, lostReasons: lostReasonGroups.map((row) => ({ reason: row.lostReason ?? 'Unspecified', count: row._count._all })).sort((a, b) => b.count - a.count) },
                bookings: {
                    count: bookingAgg._count._all,
                    agreementValue: toNum(bookingAgg._sum.agreementValue),
                },
                collections: {
                    demanded,
                    collected,
                    outstanding,
                    overdueMilestones: overdueCount,
                    collectionRate,
                },
                inventory: {
                    totalUnits,
                    byStatus,
                    absorptionRate,
                    availableStockValue: toNum(availableAgg._sum.totalPrice),
                },
                topAgents,
            },
        }
    } catch (error) {
        console.error('Error building CRM reports:', error)
        return { success: false, error: 'Failed to build reports' }
    }
}

/**
 * Market view used by managers: demand by UAE emirate and project-level
 * inventory pressure. Leads do not currently carry a separate project FK, so
 * New leads use a structured projectId. Legacy leads without that link use a
 * clearly labelled text fallback so historical data remains visible without
 * pretending that the attribution is exact.
 */
export async function getMarketInsights() {
    try {
        await requireRole('ADMIN', 'MANAGER')
        const [contacts, projects, leads] = await Promise.all([
            prisma.contact.findMany({ select: { emirate: true, leads: { select: { id: true } } } }),
            prisma.project.findMany({ select: { id: true, name: true, city: true, emirate: true, towers: { select: { units: { select: { status: true } } } } }, orderBy: { name: 'asc' } }),
            prisma.lead.findMany({ select: { id: true, projectId: true, interest: true, notes: true, status: true } }),
        ])

        const emirateCounts = new Map<string, number>()
        for (const contact of contacts) {
            const emirate = contact.emirate?.trim() || 'Unspecified'
            emirateCounts.set(emirate, (emirateCounts.get(emirate) ?? 0) + contact.leads.length)
        }
        const demandByEmirate = [...emirateCounts.entries()].map(([emirate, leads]) => ({ emirate, leads })).sort((a, b) => b.leads - a.leads)

        const projectPressure = projects.map(project => {
            const availableUnits = project.towers.reduce((sum, tower) => sum + tower.units.filter(unit => unit.status === 'Available').length, 0)
            const totalUnits = project.towers.reduce((sum, tower) => sum + tower.units.length, 0)
            const structured = leads.filter(lead => lead.projectId === project.id && lead.status !== 'LOST')
            const legacy = leads.filter(lead => !lead.projectId && lead.status !== 'LOST' && [lead.interest, lead.notes].some(value => value?.toLowerCase().includes(project.name.toLowerCase())))
            return { projectId: project.id, projectName: project.name, city: project.city, emirate: project.emirate, totalUnits, availableUnits, activeDemand: structured.length + legacy.length, structuredDemand: structured.length, legacyTextDemand: legacy.length, supplyToDemandRatio: structured.length + legacy.length > 0 ? Number((availableUnits / (structured.length + legacy.length)).toFixed(2)) : null }
        })

        const popularLocations = new Map<string, number>()
        for (const project of projects) popularLocations.set(`${project.city}, ${project.emirate}`, (popularLocations.get(`${project.city}, ${project.emirate}`) ?? 0) + 1)
        return { success: true, data: { generatedAt: new Date().toISOString(), demandByEmirate, projectPressure, popularLocations: [...popularLocations.entries()].map(([location, projectsCount]) => ({ location, projectsCount })).sort((a, b) => b.projectsCount - a.projectsCount), attributionNote: 'New lead demand uses the structured project link. Legacy text demand is shown separately as legacyTextDemand.' } }
    } catch { return { success: false, error: 'Admin or manager access required' } }
}
