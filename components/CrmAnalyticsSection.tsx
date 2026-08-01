'use client'

/**
 * CRM performance analytics — sales / lead / inventory / collections KPIs,
 * sourced live from `getCrmReports`. Designed to embed inside the Dashboard
 * (the standalone Reports page was merged here).
 *
 * Renders nothing when the data can't be loaded — including when the viewer
 * lacks the ADMIN/MANAGER role that `getCrmReports` requires — so it degrades
 * cleanly for staff dashboards.
 */

import { useEffect, useState } from 'react'
import {
    BarChart3, Loader2, TrendingUp, Building2, Banknote, Users, Trophy, Filter,
} from 'lucide-react'
import { getCrmReports, type CrmReports } from '@/app/actions/reports'
import { formatCompactCurrency } from '@/lib/currency'

function formatAed(amount: number): string {
    if (!Number.isFinite(amount) || amount === 0) return 'AED 0'
    return formatCompactCurrency(amount)
    return `AED ${Math.round(amount).toLocaleString('en-AE')}`
}

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0
    return (
        <div className="h-2 w-full rounded-full bg-surface-light overflow-hidden">
            <div className={`h-full ${className ?? 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
    )
}

function KpiCard({ label, value, sub, Icon, tint }: {
    label: string; value: string; sub?: string; Icon: React.ComponentType<{ className?: string }>; tint: string
}) {
    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted">{label}</p>
                <div className={`flex size-7 items-center justify-center rounded-lg ${tint}`}>
                    <Icon className="size-4" />
                </div>
            </div>
            <p className="text-xl font-bold text-foreground mt-1">{value}</p>
            {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
        </div>
    )
}

export default function CrmAnalyticsSection() {
    const [data, setData] = useState<CrmReports | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let active = true
            ; (async () => {
                const res = await getCrmReports()
                if (!active) return
                if (res.success) setData(res.data)
                setLoading(false)
            })()
        return () => { active = false }
    }, [])

    // Hide entirely while loading or when unavailable (e.g. staff role).
    if (loading || !data) return null

    const maxFunnel = Math.max(1, ...data.leads.funnel.map((f) => f.count))
    const maxSource = Math.max(1, ...data.leads.bySource.map((s) => s.count))
    const maxStageValue = Math.max(1, ...data.deals.byStage.map((s) => s.value))
    const maxAgent = Math.max(1, ...data.topAgents.map((a) => a.wonValue))

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-accent" />
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Performance Analytics</h2>
                        <p className="text-xs text-muted mt-0.5">Live sales, lead, inventory and collections performance.</p>
                    </div>
                </div>
            </div>

            {/* Headline KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Total Leads" value={String(data.leads.total)} sub={`${data.leads.conversionRate}% conversion`} Icon={Users} tint="bg-blue-500/10 text-blue-600" />
                <KpiCard label="Open Pipeline" value={formatAed(data.deals.openValue)} sub={`${data.deals.total} deals`} Icon={TrendingUp} tint="bg-accent/10 text-accent" />
                <KpiCard label="Bookings" value={String(data.bookings.count)} sub={formatAed(data.bookings.agreementValue)} Icon={Building2} tint="bg-emerald-500/10 text-emerald-600" />
                <KpiCard label="Collections" value={formatAed(data.collections.collected)} sub={`${data.collections.collectionRate}% of demanded`} Icon={Banknote} tint="bg-purple-500/10 text-purple-600" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
                {/* Lead funnel */}
                <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <Filter className="size-4 text-accent" />
                        <h3 className="text-sm font-semibold text-foreground">Lead Funnel</h3>
                    </div>
                    {data.leads.funnel.map((f) => (
                        <div key={f.status} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted">{f.label}</span>
                                <span className="font-medium text-foreground">{f.count}</span>
                            </div>
                            <Bar value={f.count} max={maxFunnel} className={f.status === 'WON' ? 'bg-emerald-500' : f.status === 'LOST' ? 'bg-red-500' : 'bg-accent'} />
                        </div>
                    ))}
                </div>

                {/* Deal pipeline by stage (value) */}
                <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="size-4 text-accent" />
                        <h3 className="text-sm font-semibold text-foreground">Deal Pipeline by Value</h3>
                    </div>
                    {data.deals.byStage.length === 0 ? (
                        <p className="text-sm text-muted">No deals yet.</p>
                    ) : (
                        data.deals.byStage.map((s) => (
                            <div key={s.stage} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted">{s.stage} <span className="opacity-70">({s.count})</span></span>
                                    <span className="font-medium text-foreground">{formatAed(s.value)}</span>
                                </div>
                                <Bar value={s.value} max={maxStageValue} className={s.isWon ? 'bg-emerald-500' : s.isLost ? 'bg-red-500' : 'bg-accent'} />
                            </div>
                        ))
                    )}
                </div>

                {/* Collections */}
                <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <Banknote className="size-4 text-accent" />
                        <h3 className="text-sm font-semibold text-foreground">Collections</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                            <p className="text-xs text-muted">Demanded</p>
                            <p className="text-sm font-bold text-foreground">{formatAed(data.collections.demanded)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted">Collected</p>
                            <p className="text-sm font-bold text-emerald-600">{formatAed(data.collections.collected)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted">Outstanding</p>
                            <p className="text-sm font-bold text-amber-600">{formatAed(data.collections.outstanding)}</p>
                        </div>
                    </div>
                    <Bar value={data.collections.collected} max={Math.max(1, data.collections.demanded)} className="bg-emerald-500" />
                    <p className="text-xs text-muted">
                        {data.collections.collectionRate}% collected · {data.collections.overdueMilestones} overdue milestone{data.collections.overdueMilestones === 1 ? '' : 's'}
                    </p>
                </div>

                {/* Inventory absorption */}
                <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <Building2 className="size-4 text-accent" />
                        <h3 className="text-sm font-semibold text-foreground">Inventory Absorption</h3>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground">{data.inventory.absorptionRate}%</span>
                        <span className="text-xs text-muted">of {data.inventory.totalUnits} units booked/sold</span>
                    </div>
                    <Bar value={data.inventory.absorptionRate} max={100} className="bg-emerald-500" />
                    <div className="flex flex-wrap gap-2 pt-1">
                        {data.inventory.byStatus.map((u) => (
                            <span key={u.status} className="px-2 py-0.5 rounded-full text-xs bg-surface border border-border text-muted">
                                {u.status}: <span className="text-foreground font-medium">{u.count}</span>
                            </span>
                        ))}
                    </div>
                    <p className="text-xs text-muted">Available stock value: <span className="text-foreground font-medium">{formatAed(data.inventory.availableStockValue)}</span></p>
                </div>
            </div>
        </div>
    )
}
