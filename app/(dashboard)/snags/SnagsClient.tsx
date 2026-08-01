'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
    AlertTriangle,
    WrenchIcon,
    CheckCircle2,
    Loader2,
    Plus,
} from 'lucide-react'
import Link from 'next/link'
import { getSnagReports, updateSnagStatus } from '@/app/actions/snag'

// ─── Types ────────────────────────────────────────────────────────────────────

type SnagRow = {
    id: number
    bookingId: number
    dealId: number
    contactId: number | null
    contactName: string | null
    title: string
    description: string | null
    category: string
    severity: string
    status: string
    photoUrls: string[]
    assignedToId: number | null
    assignedToName: string | null
    resolvedAt: string | null
    createdAt: string
}

const STATUS_FILTER_OPTIONS = ['All', 'Open', 'In Progress', 'Resolved', 'Closed']

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const cls =
        status === 'Open'
            ? 'bg-red-500/10 text-red-700 border-red-500/20'
            : status === 'In Progress'
                ? 'bg-amber-500/10 text-amber-700 border-amber-500/20'
                : status === 'Resolved'
                    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                    : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/20'
    const icon =
        status === 'Open' ? <AlertTriangle className="w-3 h-3" /> :
            status === 'In Progress' ? <WrenchIcon className="w-3 h-3" /> :
                <CheckCircle2 className="w-3 h-3" />
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
            {icon} {status}
        </span>
    )
}

function SeverityBadge({ severity }: { severity: string }) {
    const cls =
        severity === 'Critical'
            ? 'bg-red-500/10 text-red-700'
            : severity === 'High'
                ? 'bg-orange-500/10 text-orange-700'
                : severity === 'Medium'
                    ? 'bg-amber-500/10 text-amber-700'
                    : 'bg-zinc-500/10 text-zinc-600'
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{severity}</span>
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
    label,
    count,
    icon: Icon,
    color,
}: {
    label: string
    count: number
    icon: React.ElementType
    color: string
}) {
    return (
        <div className="glass-card p-4 flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${color}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-lg font-bold text-foreground">{count}</p>
            </div>
        </div>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SnagsClient() {
    const [snags, setSnags] = useState<SnagRow[]>([])
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState<string>('Open')
    const [resolvingId, setResolvingId] = useState<number | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const res = await getSnagReports(
            statusFilter === 'All' ? undefined : { status: statusFilter }
        )
        if (res.success) setSnags(res.data as SnagRow[])
        else toast.error('Failed to load snag reports')
        setLoading(false)
    }, [statusFilter])

    useEffect(() => { load() }, [load])

    async function handleMarkResolved(id: number) {
        setResolvingId(id)
        const res = await updateSnagStatus(id, 'Resolved')
        setResolvingId(null)
        if (res.success) {
            toast.success('Snag marked as resolved')
            load()
        } else {
            toast.error(res.error ?? 'Failed to update status')
        }
    }

    // Summary counts using all-statuses fetch if needed — we use local state
    const openCount = snags.filter((s) => s.status === 'Open').length
    const inProgressCount = snags.filter((s) => s.status === 'In Progress').length
    const resolvedCount = snags.filter((s) => s.status === 'Resolved').length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Snag Reports</h1>
                    <p className="text-sm text-muted mt-1">
                        Manager view — all defect reports across bookings
                    </p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SummaryCard
                    label="Open"
                    count={openCount}
                    icon={AlertTriangle}
                    color="bg-red-500/10 text-red-700"
                />
                <SummaryCard
                    label="In Progress"
                    count={inProgressCount}
                    icon={WrenchIcon}
                    color="bg-amber-500/10 text-amber-700"
                />
                <SummaryCard
                    label="Resolved"
                    count={resolvedCount}
                    icon={CheckCircle2}
                    color="bg-emerald-500/10 text-emerald-700"
                />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                {STATUS_FILTER_OPTIONS.map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${statusFilter === s
                            ? 'bg-accent text-white'
                            : 'text-muted hover:text-foreground hover:bg-surface-hover border border-transparent hover:border-border'
                            }`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="space-y-2 p-4 animate-pulse">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-14 bg-surface rounded-lg" />
                        ))}
                    </div>
                ) : snags.length === 0 ? (
                    <div className="py-16 text-center text-muted">
                        <WrenchIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">No snag reports for &ldquo;{statusFilter}&rdquo;</p>
                        <p className="text-xs mt-1">Reports are added from individual deal / booking pages.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="crm-table min-w-[800px] whitespace-nowrap">
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Category</th>
                                    <th>Severity</th>
                                    <th>Status</th>
                                    <th>Contact</th>
                                    <th>Assigned To</th>
                                    <th>Reported</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snags.map((snag) => (
                                    <tr key={snag.id}>
                                        <td>
                                            <Link
                                                href={`/deals/${snag.dealId}`}
                                                className="font-medium text-foreground hover:text-accent text-sm line-clamp-1 max-w-[180px] block"
                                            >
                                                {snag.title}
                                            </Link>
                                            {snag.description && (
                                                <p className="text-[10px] text-muted line-clamp-1 max-w-[180px]">
                                                    {snag.description}
                                                </p>
                                            )}
                                        </td>
                                        <td>
                                            <span className="text-xs text-muted">{snag.category}</span>
                                        </td>
                                        <td>
                                            <SeverityBadge severity={snag.severity} />
                                        </td>
                                        <td>
                                            <StatusBadge status={snag.status} />
                                        </td>
                                        <td>
                                            <span className="text-xs text-foreground">{snag.contactName ?? '—'}</span>
                                        </td>
                                        <td>
                                            <span className="text-xs text-foreground">{snag.assignedToName ?? '—'}</span>
                                        </td>
                                        <td>
                                            <span className="text-xs text-muted">
                                                {new Date(snag.createdAt).toLocaleDateString('en-AE', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    year: 'numeric',
                                                })}
                                            </span>
                                        </td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    href={`/deals/${snag.dealId}`}
                                                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:border-accent/40"
                                                >
                                                    View Deal
                                                </Link>
                                                {(snag.status === 'Open' || snag.status === 'In Progress') && (
                                                    <button
                                                        onClick={() => handleMarkResolved(snag.id)}
                                                        disabled={resolvingId === snag.id}
                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 text-xs font-medium hover:bg-emerald-500/20 disabled:opacity-50"
                                                    >
                                                        {resolvingId === snag.id ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                        )}
                                                        Resolve
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
