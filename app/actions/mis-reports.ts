'use server'

/**
 * MIS Report service — Management Information System reports for the Real
 * Estate CRM. Generates five pre-defined report types from existing Prisma
 * tables and also exposes a CSV export helper for each.
 *
 * Access is restricted to ADMIN and MANAGER roles via requireRole.
 *
 * Report types:
 *  - agent-sales          : Won deals per agent with total value
 *  - project-collection   : Booking collection (demanded vs collected) per project
 *  - lead-source-roi      : Leads and conversion by source
 *  - pending-bookings     : Active bookings with outstanding amount
 *  - cancellations        : Cancelled bookings within the date range
 */

import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'

// ─── Types ──────────────────────────────────────────────────────────────────

export type MisReportType =
    | 'agent-sales'
    | 'project-collection'
    | 'lead-source-roi'
    | 'pending-bookings'
    | 'cancellations'
    | 'lost-reasons'
    | 'custom'

export interface MisParams {
    from?: string // ISO date string e.g. "2024-01-01"
    to?: string   // ISO date string e.g. "2024-12-31"
    dimension?: 'agent' | 'project' | 'location' | 'source' | 'portal'
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function toNum(v: unknown): number {
    if (v == null) return 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0
    if (typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
        try { return (v as { toNumber: () => number }).toNumber() } catch { return 0 }
    }
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

function dateRange(params?: MisParams): { gte?: Date; lte?: Date } {
    const result: { gte?: Date; lte?: Date } = {}
    if (params?.from) {
        const d = new Date(params.from)
        if (!isNaN(d.getTime())) result.gte = d
    }
    if (params?.to) {
        const d = new Date(params.to)
        if (!isNaN(d.getTime())) {
            // Include the full end day
            d.setHours(23, 59, 59, 999)
            result.lte = d
        }
    }
    return result
}

function csvEscape(v: unknown): string {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(headers: string[], rows: Record<string, unknown>[]): string {
    const lines: string[] = [headers.join(',')]
    for (const row of rows) {
        lines.push(headers.map((h) => csvEscape(row[h])).join(','))
    }
    return lines.join('\n')
}

// ─── Auth guard ─────────────────────────────────────────────────────────────

async function guard() {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        throw new Error('Admin or manager access required')
    }
}

// ─── Report implementations ──────────────────────────────────────────────────

// 1. Agent Sales — won deals per sales agent with total deal value
async function agentSalesReport(params?: MisParams) {
    const range = dateRange(params)
    const dateFilter = Object.keys(range).length > 0 ? { wonDate: range } : { stage: { isWon: true } }

    const deals = await prisma.deal.findMany({
        where: {
            stage: { isWon: true },
            assignedAgentId: { not: null },
            ...(Object.keys(range).length > 0 ? { wonDate: range } : {}),
        },
        select: {
            id: true,
            value: true,
            wonDate: true,
            assignedAgentId: true,
            assignedAgent: { select: { id: true, name: true } },
            contact: { select: { name: true } },
            unit: { select: { unitNumber: true, tower: { select: { name: true, project: { select: { name: true } } } } } },
        },
        orderBy: { wonDate: 'desc' },
    })
    void dateFilter // used inline above

    const agentMap = new Map<number, {
        agentId: number
        agentName: string
        dealsCount: number
        totalValue: number
    }>()

    const rows = deals.map((d) => {
        const agentId = d.assignedAgentId!
        const agentName = d.assignedAgent?.name ?? 'Unknown'
        const value = toNum(d.value)

        if (!agentMap.has(agentId)) {
            agentMap.set(agentId, { agentId, agentName, dealsCount: 0, totalValue: 0 })
        }
        const agg = agentMap.get(agentId)!
        agg.dealsCount += 1
        agg.totalValue += value

        return {
            dealId: d.id,
            agentName,
            buyerName: d.contact.name,
            project: d.unit?.tower?.project?.name ?? '—',
            unit: d.unit ? `${d.unit.tower?.name ?? ''} - ${d.unit.unitNumber}` : '—',
            dealValue: value,
            wonDate: d.wonDate ? new Date(d.wonDate).toLocaleDateString('en-AE') : '—',
        }
    })

    return rows
}

// 2. Project Collection — per project: total demanded, collected, outstanding
async function projectCollectionReport(params?: MisParams) {
    const range = dateRange(params)

    const bookings = await prisma.booking.findMany({
        where: {
            status: { not: 'Cancelled' },
            ...(Object.keys(range).length > 0 ? { bookingDate: range } : {}),
        },
        select: {
            id: true,
            agreementValue: true,
            bookingDate: true,
            contact: { select: { name: true } },
            unit: {
                select: {
                    unitNumber: true,
                    tower: {
                        select: {
                            name: true,
                            project: { select: { id: true, name: true } },
                        },
                    },
                },
            },
            milestones: {
                select: { amount: true, paidAmount: true, status: true },
            },
        },
    })

    const projectMap = new Map<number, {
        projectId: number
        projectName: string
        bookingCount: number
        totalAgreementValue: number
        totalDemanded: number
        totalCollected: number
        totalOutstanding: number
    }>()

    const rows = bookings.map((b) => {
        const projectId = b.unit.tower.project.id
        const projectName = b.unit.tower.project.name
        const demanded = b.milestones.reduce((s, m) => s + toNum(m.amount), 0)
        const collected = b.milestones.reduce((s, m) => s + toNum(m.paidAmount), 0)
        const outstanding = Math.max(0, demanded - collected)

        if (!projectMap.has(projectId)) {
            projectMap.set(projectId, {
                projectId,
                projectName,
                bookingCount: 0,
                totalAgreementValue: 0,
                totalDemanded: 0,
                totalCollected: 0,
                totalOutstanding: 0,
            })
        }
        const agg = projectMap.get(projectId)!
        agg.bookingCount += 1
        agg.totalAgreementValue += toNum(b.agreementValue)
        agg.totalDemanded += demanded
        agg.totalCollected += collected
        agg.totalOutstanding += outstanding

        return {
            projectName,
            tower: b.unit.tower.name,
            unit: b.unit.unitNumber,
            buyerName: b.contact.name,
            agreementValue: toNum(b.agreementValue),
            demanded,
            collected,
            outstanding,
            bookingDate: new Date(b.bookingDate).toLocaleDateString('en-AE'),
        }
    })

    return rows
}

// 3. Lead Source ROI — leads per source with won count and conversion rate
async function leadSourceRoiReport(params?: MisParams) {
    const range = dateRange(params)

    const leads = await prisma.lead.findMany({
        where: Object.keys(range).length > 0 ? { createdAt: range } : {},
        select: {
            id: true,
            source: true,
            status: true,
            createdAt: true,
            contact: { select: { name: true } },
        },
    })

    const sourceMap = new Map<string, {
        source: string
        totalLeads: number
        wonLeads: number
        lostLeads: number
        openLeads: number
    }>()

    for (const lead of leads) {
        const source = lead.source ?? 'Unknown'
        if (!sourceMap.has(source)) {
            sourceMap.set(source, { source, totalLeads: 0, wonLeads: 0, lostLeads: 0, openLeads: 0 })
        }
        const agg = sourceMap.get(source)!
        agg.totalLeads += 1
        if (lead.status === 'WON') agg.wonLeads += 1
        else if (lead.status === 'LOST') agg.lostLeads += 1
        else agg.openLeads += 1
    }

    return Array.from(sourceMap.values()).map((s) => ({
        source: s.source,
        totalLeads: s.totalLeads,
        wonLeads: s.wonLeads,
        lostLeads: s.lostLeads,
        openLeads: s.openLeads,
        conversionRate: s.totalLeads > 0 ? `${Math.round((s.wonLeads / s.totalLeads) * 100)}%` : '0%',
    })).sort((a, b) => b.totalLeads - a.totalLeads)
}

// 4. Pending Bookings — active bookings with milestones yet to be paid
async function pendingBookingsReport(params?: MisParams) {
    const range = dateRange(params)

    const bookings = await prisma.booking.findMany({
        where: {
            status: 'Active',
            ...(Object.keys(range).length > 0 ? { bookingDate: range } : {}),
        },
        select: {
            id: true,
            agreementValue: true,
            bookingDate: true,
            tokenAmount: true,
            contact: { select: { name: true, phone: true } },
            unit: {
                select: {
                    unitNumber: true,
                    type: true,
                    tower: {
                        select: {
                            name: true,
                            project: { select: { name: true } },
                        },
                    },
                },
            },
            milestones: {
                where: { status: { in: ['Due', 'Overdue', 'Upcoming'] } },
                select: { name: true, dueDate: true, amount: true, paidAmount: true, status: true },
            },
        },
        orderBy: { bookingDate: 'desc' },
    })

    const rows = bookings.map((b) => {
        const outstanding = b.milestones.reduce(
            (s, m) => s + Math.max(0, toNum(m.amount) - toNum(m.paidAmount)),
            0
        )
        const nextMilestone = b.milestones.find((m) => m.status === 'Due' || m.status === 'Overdue')
        return {
            bookingId: b.id,
            buyerName: b.contact.name,
            buyerPhone: b.contact.phone,
            project: b.unit.tower.project.name,
            tower: b.unit.tower.name,
            unit: b.unit.unitNumber,
            unitType: b.unit.type,
            agreementValue: toNum(b.agreementValue),
            outstandingAmount: outstanding,
            nextMilestoneName: nextMilestone?.name ?? '—',
            nextMilestoneDue: nextMilestone ? new Date(nextMilestone.dueDate).toLocaleDateString('en-AE') : '—',
            bookingDate: new Date(b.bookingDate).toLocaleDateString('en-AE'),
        }
    })

    return rows
}

// 5. Cancellations — bookings cancelled within the period
async function cancellationsReport(params?: MisParams) {
    const range = dateRange(params)

    const bookings = await prisma.booking.findMany({
        where: {
            status: 'Cancelled',
            ...(Object.keys(range).length > 0 ? { cancellationDate: range } : {}),
        },
        select: {
            id: true,
            agreementValue: true,
            tokenAmount: true,
            bookingDate: true,
            cancellationDate: true,
            cancellationReason: true,
            contact: { select: { name: true, phone: true } },
            unit: {
                select: {
                    unitNumber: true,
                    type: true,
                    tower: {
                        select: {
                            name: true,
                            project: { select: { name: true } },
                        },
                    },
                },
            },
            milestones: {
                select: { paidAmount: true },
            },
        },
        orderBy: { cancellationDate: 'desc' },
    })

    return bookings.map((b) => {
        const amountCollected = b.milestones.reduce((s, m) => s + toNum(m.paidAmount), 0)
        return {
            bookingId: b.id,
            buyerName: b.contact.name,
            buyerPhone: b.contact.phone,
            project: b.unit.tower.project.name,
            tower: b.unit.tower.name,
            unit: b.unit.unitNumber,
            unitType: b.unit.type,
            agreementValue: toNum(b.agreementValue),
            tokenAmount: toNum(b.tokenAmount),
            amountCollected,
            cancellationReason: b.cancellationReason ?? '—',
            bookingDate: new Date(b.bookingDate).toLocaleDateString('en-AE'),
            cancellationDate: b.cancellationDate ? new Date(b.cancellationDate).toLocaleDateString('en-AE') : '—',
        }
    })
}

async function lostReasonsReport(params?: MisParams) {
    const range = dateRange(params)
    const deals = await prisma.deal.findMany({ where: { stage: { isLost: true }, lostReason: { not: null }, ...(Object.keys(range).length > 0 ? { updatedAt: range } : {}) }, select: { lostReason: true } })
    const rows = new Map<string, number>()
    for (const deal of deals) { const reason = deal.lostReason?.trim() || 'Unspecified'; rows.set(reason, (rows.get(reason) ?? 0) + 1) }
    return [...rows.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}

async function customReport(params?: MisParams) {
    const dimension = params?.dimension ?? 'agent'
    const range = dateRange(params)
    const hasRange = Object.keys(range).length > 0
    if (dimension === 'agent') {
        const deals = await prisma.deal.findMany({ where: { assignedAgentId: { not: null }, ...(hasRange ? { wonDate: range } : {}) }, select: { assignedAgentId: true, value: true, stage: { select: { isWon: true } }, assignedAgent: { select: { name: true } } } })
        const rows = new Map<number, { agent: string; deals: number; wonDeals: number; value: number }>()
        for (const deal of deals) { const id = deal.assignedAgentId!; const row = rows.get(id) ?? { agent: deal.assignedAgent?.name ?? 'Unknown', deals: 0, wonDeals: 0, value: 0 }; row.deals++; if (deal.stage.isWon) { row.wonDeals++; row.value += toNum(deal.value) } rows.set(id, row) }
        return [...rows.values()].sort((a, b) => b.value - a.value)
    }
    if (dimension === 'project') {
        const bookings = await prisma.booking.findMany({ where: hasRange ? { bookingDate: range } : undefined, select: { agreementValue: true, unit: { select: { tower: { select: { project: { select: { name: true } } } } } } } })
        const rows = new Map<string, { project: string; bookings: number; agreementValue: number }>()
        for (const booking of bookings) { const name = booking.unit.tower.project.name; const row = rows.get(name) ?? { project: name, bookings: 0, agreementValue: 0 }; row.bookings++; row.agreementValue += toNum(booking.agreementValue); rows.set(name, row) }
        return [...rows.values()].sort((a, b) => b.agreementValue - a.agreementValue)
    }
    if (dimension === 'location') {
        const contacts = await prisma.contact.findMany({ select: { emirate: true, leads: { where: hasRange ? { date: range } : undefined, select: { id: true } }, deals: { where: hasRange ? { createdAt: range } : undefined, select: { id: true } } } })
        const rows = new Map<string, { emirate: string; leads: number; deals: number }>()
        for (const contact of contacts) { const emirate = contact.emirate || 'Unspecified'; const row = rows.get(emirate) ?? { emirate, leads: 0, deals: 0 }; row.leads += contact.leads.length; row.deals += contact.deals.length; rows.set(emirate, row) }
        return [...rows.values()].sort((a, b) => b.leads - a.leads)
    }
    if (dimension === 'portal') {
        const portals = await prisma.portalLead.groupBy({ by: ['portalName'], where: hasRange ? { inquiryDate: range } : undefined, _count: { _all: true } })
        return portals.sort((a, b) => b._count._all - a._count._all).map(row => ({ portal: row.portalName, enquiries: row._count._all }))
    }
    const leads = await prisma.lead.findMany({ where: hasRange ? { date: range } : undefined, select: { source: true, status: true } })
    const rows = new Map<string, { source: string; leads: number; won: number; lost: number }>()
    for (const lead of leads) { const source = lead.source || 'Unknown'; const row = rows.get(source) ?? { source, leads: 0, won: 0, lost: 0 }; row.leads++; if (lead.status === 'WON') row.won++; if (lead.status === 'LOST') row.lost++; rows.set(source, row) }
    return [...rows.values()].sort((a, b) => b.leads - a.leads)
}

// ─── CSV column mappings ─────────────────────────────────────────────────────

const CSV_HEADERS: Record<MisReportType, string[]> = {
    'agent-sales': ['dealId', 'agentName', 'buyerName', 'project', 'unit', 'dealValue', 'wonDate'],
    'project-collection': ['projectName', 'tower', 'unit', 'buyerName', 'agreementValue', 'demanded', 'collected', 'outstanding', 'bookingDate'],
    'lead-source-roi': ['source', 'totalLeads', 'wonLeads', 'lostLeads', 'openLeads', 'conversionRate'],
    'pending-bookings': ['bookingId', 'buyerName', 'buyerPhone', 'project', 'tower', 'unit', 'unitType', 'agreementValue', 'outstandingAmount', 'nextMilestoneName', 'nextMilestoneDue', 'bookingDate'],
    'cancellations': ['bookingId', 'buyerName', 'buyerPhone', 'project', 'tower', 'unit', 'unitType', 'agreementValue', 'tokenAmount', 'amountCollected', 'cancellationReason', 'bookingDate', 'cancellationDate'],
    'lost-reasons': ['reason', 'count'],
    'custom': ['agent', 'deals', 'wonDeals', 'value', 'project', 'bookings', 'agreementValue', 'emirate', 'leads', 'source', 'won', 'lost', 'portal', 'enquiries'],
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a MIS report and return an array of row objects.
 * Access restricted to ADMIN and MANAGER roles.
 */
export async function getMisReport(
    type: MisReportType,
    params?: MisParams
): Promise<{ success: true; data: Record<string, unknown>[] } | { success: false; error: string }> {
    try {
        await guard()
    } catch (e) {
        return { success: false, error: (e as Error).message }
    }

    try {
        let data: Record<string, unknown>[]
        switch (type) {
            case 'agent-sales':
                data = await agentSalesReport(params) as Record<string, unknown>[]
                break
            case 'project-collection':
                data = await projectCollectionReport(params) as Record<string, unknown>[]
                break
            case 'lead-source-roi':
                data = await leadSourceRoiReport(params) as Record<string, unknown>[]
                break
            case 'pending-bookings':
                data = await pendingBookingsReport(params) as Record<string, unknown>[]
                break
            case 'cancellations':
                data = await cancellationsReport(params) as Record<string, unknown>[]
                break
            case 'lost-reasons':
                data = await lostReasonsReport(params) as Record<string, unknown>[]
                break
            case 'custom':
                data = await customReport(params) as Record<string, unknown>[]
                break
            default:
                return { success: false, error: `Unknown report type: ${String(type)}` }
        }
        return { success: true, data }
    } catch (err) {
        console.error(`MIS report error [${type}]:`, err)
        return { success: false, error: 'Failed to generate report' }
    }
}

/**
 * Export a MIS report as a CSV string.
 * Access restricted to ADMIN and MANAGER roles.
 */
export async function exportMisReportCsv(
    type: MisReportType,
    params?: MisParams
): Promise<{ success: true; csv: string; filename: string } | { success: false; error: string }> {
    const result = await getMisReport(type, params)
    if (!result.success) return result

    const headers = CSV_HEADERS[type]
    const csv = buildCsv(headers, result.data)
    const dateTag = new Date().toISOString().slice(0, 10)
    return { success: true, csv, filename: `mis-${type}-${dateTag}.csv` }
}
