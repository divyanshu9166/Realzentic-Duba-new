'use client'

/**
 * MIS Report Client — Management Information System reports page.
 *
 * Renders five report type cards. Clicking a card fetches and displays the
 * report as a table. A date-range filter at the top is applied to all reports.
 * Each report has an "Export CSV" button that triggers a browser download.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import {
    BarChart2,
    Building2,
    TrendingUp,
    Clock,
    XCircle,
    Download,
    Loader2,
    RefreshCw,
    ChevronDown,
    SlidersHorizontal,
} from 'lucide-react'
import {
    getMisReport,
    exportMisReportCsv,
    type MisReportType,
    type MisParams,
} from '@/app/actions/mis-reports'

// ─── Report card definitions ─────────────────────────────────────────────────

interface ReportDef {
    type: MisReportType
    title: string
    description: string
    icon: React.ReactNode
    color: string
}

const REPORTS: ReportDef[] = [
    {
        type: 'agent-sales',
        title: 'Agent Sales',
        description: 'Won deals per sales agent with total deal value',
        icon: <BarChart2 className="size-5" />,
        color: 'text-accent',
    },
    {
        type: 'project-collection',
        title: 'Project Collection',
        description: 'Demanded vs collected amounts per project',
        icon: <Building2 className="size-5" />,
        color: 'text-emerald-500',
    },
    {
        type: 'lead-source-roi',
        title: 'Lead Source ROI',
        description: 'Leads, conversions and win-rate by source',
        icon: <TrendingUp className="size-5" />,
        color: 'text-violet-500',
    },
    {
        type: 'pending-bookings',
        title: 'Pending Bookings',
        description: 'Active bookings with outstanding payment amounts',
        icon: <Clock className="size-5" />,
        color: 'text-amber-500',
    },
    {
        type: 'cancellations',
        title: 'Cancellations',
        description: 'Cancelled bookings and reasons within the period',
        icon: <XCircle className="size-5" />,
        color: 'text-rose-500',
    },
    {
        type: 'custom',
        title: 'Custom View',
        description: 'Filter operational data by agent, project, location, source or portal',
        icon: <SlidersHorizontal className="size-5" />,
        color: 'text-sky-500',
    },
]

// ─── Human-readable column labels ────────────────────────────────────────────

const COL_LABELS: Record<string, string> = {
    dealId: 'Deal #',
    agentName: 'Agent',
    buyerName: 'Buyer',
    project: 'Project',
    tower: 'Tower',
    unit: 'Unit',
    unitType: 'Type',
    dealValue: 'Value (AED )',
    wonDate: 'Won Date',
    agreementValue: 'Agreement (AED )',
    demanded: 'Demanded (AED )',
    collected: 'Collected (AED )',
    outstanding: 'Outstanding (AED )',
    bookingDate: 'Booking Date',
    source: 'Source',
    totalLeads: 'Total Leads',
    wonLeads: 'Won',
    lostLeads: 'Lost',
    openLeads: 'Open',
    conversionRate: 'Conversion',
    bookingId: 'Booking #',
    buyerPhone: 'Phone',
    outstandingAmount: 'Outstanding (AED )',
    nextMilestoneName: 'Next Milestone',
    nextMilestoneDue: 'Due Date',
    projectName: 'Project',
    tokenAmount: 'Reservation Deposit (AED)',
    amountCollected: 'Collected (AED )',
    cancellationReason: 'Reason',
    cancellationDate: 'Cancelled On',
}

function colLabel(key: string): string {
    return COL_LABELS[key] ?? key
}

// ─── Currency formatter ───────────────────────────────────────────────────────

const AED = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 })

function fmtCell(key: string, value: unknown): string {
    if (value == null || value === '') return '—'
    // Money columns
    if (
        typeof value === 'number' &&
        /value|amount|demanded|collected|outstanding/i.test(key)
    ) {
        return `AED ${AED.format(value)}`
    }
    return String(value)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MisClient() {
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [activeType, setActiveType] = useState<MisReportType | null>(null)
    const [rows, setRows] = useState<Record<string, unknown>[]>([])
    const [columns, setColumns] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [dimension, setDimension] = useState<'agent' | 'project' | 'location' | 'source' | 'portal'>('agent')

    const params: MisParams = {
        from: from || undefined,
        to: to || undefined,
        dimension: activeType === 'custom' ? dimension : undefined,
    }

    async function runReport(type: MisReportType) {
        setActiveType(type)
        setRows([])
        setColumns([])
        setLoading(true)
        try {
            const res = await getMisReport(type, params)
            if (!res.success) {
                toast.error(res.error)
                return
            }
            setRows(res.data)
            setColumns(res.data.length > 0 ? Object.keys(res.data[0]) : [])
            if (res.data.length === 0) toast.info('No data found for the selected period')
        } catch {
            toast.error('Failed to load report')
        } finally {
            setLoading(false)
        }
    }

    async function handleExportCsv() {
        if (!activeType) return
        setExporting(true)
        try {
            const res = await exportMisReportCsv(activeType, params)
            if (!res.success) {
                toast.error(res.error)
                return
            }
            const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = res.filename
            a.click()
            URL.revokeObjectURL(url)
            toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`)
        } catch {
            toast.error('CSV export failed')
        } finally {
            setExporting(false)
        }
    }

    const activeDef = REPORTS.find((r) => r.type === activeType)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10">
                    <BarChart2 className="size-5 text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-foreground">MIS Reports</h1>
                    <p className="text-sm text-muted">Management information reports for sales, collections and leads.</p>
                </div>
            </div>

            {/* Date range filter */}
            <div className="glass-card p-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Date Range Filter</p>
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted whitespace-nowrap">From</label>
                        <input
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-foreground"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted whitespace-nowrap">To</label>
                        <input
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-foreground"
                        />
                    </div>
                    {(from || to) && (
                        <button
                            onClick={() => { setFrom(''); setTo('') }}
                            className="text-xs text-muted hover:text-foreground underline"
                        >
                            Clear
                        </button>
                    )}
                    <label className="flex items-center gap-2 text-sm text-muted">Custom view
                        <select value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)} className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-foreground">
                            <option value="agent">Agent</option><option value="project">Project</option><option value="location">Location</option><option value="source">Lead source</option><option value="portal">Portal</option>
                        </select>
                    </label>
                </div>
            </div>

            {/* Report type cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {REPORTS.map((r) => (
                    <button
                        key={r.type}
                        onClick={() => runReport(r.type)}
                        className={`glass-card p-4 text-left transition-all hover:shadow-md flex flex-col gap-2 ${activeType === r.type ? 'ring-2 ring-accent' : ''
                            }`}
                    >
                        <div className={`${r.color}`}>{r.icon}</div>
                        <p className="font-semibold text-sm text-foreground leading-tight">{r.title}</p>
                        <p className="text-xs text-muted leading-snug">{r.description}</p>
                        {activeType === r.type && loading && (
                            <Loader2 className="size-4 animate-spin text-accent mt-1" />
                        )}
                        {activeType === r.type && !loading && (
                            <ChevronDown className="size-4 text-accent mt-1" />
                        )}
                    </button>
                ))}
            </div>

            {/* Report table */}
            {activeType && (
                <div className="glass-card overflow-hidden">
                    {/* Table header row */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                            <span className={activeDef?.color}>{activeDef?.icon}</span>
                            <span className="font-semibold text-foreground text-sm">{activeDef?.title}</span>
                            {!loading && rows.length > 0 && (
                                <span className="text-xs text-muted">({rows.length} rows)</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => runReport(activeType)}
                                disabled={loading}
                                className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-xl text-xs text-muted hover:text-foreground disabled:opacity-50"
                            >
                                <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                            <button
                                onClick={handleExportCsv}
                                disabled={loading || exporting || rows.length === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-medium disabled:opacity-50 hover:opacity-90"
                            >
                                {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                                Export CSV
                            </button>
                        </div>
                    </div>

                    {/* Table body */}
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="size-6 animate-spin text-accent" />
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-12 text-center text-sm text-muted">
                            No data found for the selected period.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="crm-table">
                                <thead>
                                    <tr>
                                        {columns.map((col) => (
                                            <th key={col}>{colLabel(col)}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, i) => (
                                        <tr key={i}>
                                            {columns.map((col) => (
                                                <td key={col} className="whitespace-nowrap text-sm">
                                                    {fmtCell(col, row[col])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
