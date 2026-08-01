'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
    Target,
    Plus,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    RefreshCw,
} from 'lucide-react'
import Modal from '@/components/Modal'
import { getAgentTargets, upsertAgentTarget, syncAgentAttainment } from '@/app/actions/agent-targets'
import { getStaff } from '@/app/actions/staff'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentTargetRow = {
    id: number
    staffId: number
    staffName: string
    staffRole: string
    staffAvatar: string | null
    staffStatus: string
    period: string
    periodType: string
    unitTarget: number
    unitAchieved: number
    unitAttainmentPct: number
    revenueTarget: number
    revenueAchieved: number
    revenueAttainmentPct: number
    notes: string | null
    updatedAt: string
}

type StaffOption = { id: number; name: string; role: string }

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
    const clamped = Math.min(100, pct)
    const color =
        pct >= 100 ? 'bg-emerald-600' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${color}`}
                    style={{ width: `${clamped}%` }}
                />
            </div>
            <span className="text-xs font-medium text-foreground w-10 text-right">
                {pct}%
            </span>
        </div>
    )
}

// ─── Set Target Modal ─────────────────────────────────────────────────────────

type SetTargetForm = {
    staffId: string
    period: string
    unitTarget: string
    revenueTarget: string
    notes: string
}

const EMPTY_FORM: SetTargetForm = {
    staffId: '',
    period: new Date().toISOString().slice(0, 7),
    unitTarget: '',
    revenueTarget: '',
    notes: '',
}

interface SetTargetModalProps {
    isOpen: boolean
    onClose: () => void
    staffOptions: StaffOption[]
    prefillStaffId?: number
    onSaved: () => void
}

function SetTargetModal({
    isOpen,
    onClose,
    staffOptions,
    prefillStaffId,
    onSaved,
}: SetTargetModalProps) {
    const [form, setForm] = useState<SetTargetForm>({
        ...EMPTY_FORM,
        staffId: prefillStaffId ? String(prefillStaffId) : '',
    })
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (isOpen) {
            setForm({
                ...EMPTY_FORM,
                staffId: prefillStaffId ? String(prefillStaffId) : '',
            })
        }
    }, [isOpen, prefillStaffId])

    const field = (k: keyof SetTargetForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [k]: e.target.value }))

    async function handleSave() {
        if (!form.staffId) { toast.error('Select a staff member'); return }
        if (!form.period) { toast.error('Select a period'); return }
        setSaving(true)
        const res = await upsertAgentTarget({
            staffId: Number(form.staffId),
            period: form.period,
            unitTarget: form.unitTarget ? Number(form.unitTarget) : 0,
            revenueTarget: form.revenueTarget ? Number(form.revenueTarget) : 0,
            notes: form.notes || undefined,
        })
        setSaving(false)
        if (res.success) {
            toast.success('Target saved')
            onSaved()
            onClose()
        } else {
            toast.error(res.error ?? 'Failed to save target')
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Set Agent Target">
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Staff Member</label>
                    <select
                        value={form.staffId}
                        onChange={field('staffId')}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                    >
                        <option value="">— select staff —</option>
                        {staffOptions.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name} ({s.role})
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Period (YYYY-MM)</label>
                    <input
                        type="month"
                        value={form.period}
                        onChange={field('period')}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Unit Target</label>
                        <input
                            type="number"
                            min="0"
                            placeholder="e.g. 5"
                            value={form.unitTarget}
                            onChange={field('unitTarget')}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Revenue Target (AED )</label>
                        <input
                            type="number"
                            min="0"
                            placeholder="e.g. 5000000"
                            value={form.revenueTarget}
                            onChange={field('revenueTarget')}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Notes (optional)</label>
                    <textarea
                        rows={2}
                        placeholder="Any notes about this target…"
                        value={form.notes}
                        onChange={field('notes')}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground resize-none"
                    />
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {saving ? 'Saving…' : 'Save Target'}
                </button>
            </div>
        </Modal>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentTargetsTab() {
    const [targets, setTargets] = useState<AgentTargetRow[]>([])
    const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
    const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [modalPrefillStaffId, setModalPrefillStaffId] = useState<number | undefined>()
    const [syncingId, setSyncingId] = useState<number | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const [tRes, sRes] = await Promise.all([
            getAgentTargets(period),
            getStaff(),
        ])
        if (tRes.success) setTargets(tRes.data as AgentTargetRow[])
        if (sRes.success) {
            setStaffOptions(
                (sRes.data as { id: number; name: string; role: string }[]).map((s) => ({
                    id: s.id,
                    name: s.name,
                    role: s.role,
                }))
            )
        }
        setLoading(false)
    }, [period])

    useEffect(() => { load() }, [load])

    async function handleSync(staffId: number, staffName: string) {
        setSyncingId(staffId)
        const res = await syncAgentAttainment(staffId, period)
        setSyncingId(null)
        if (res.success) {
            toast.success(`Attainment synced for ${staffName}`)
            load()
        } else {
            toast.error(res.error ?? 'Sync failed')
        }
    }

    function openSetTarget(staffId?: number) {
        setModalPrefillStaffId(staffId)
        setModalOpen(true)
    }

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-64 bg-surface rounded-xl" />
                <div className="glass-card h-48 bg-surface rounded-xl" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-base font-semibold text-foreground">Agent Targets</h2>
                    <p className="text-xs text-muted mt-0.5">Monthly sales targets with live attainment tracking</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="month"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground"
                    />
                    <button
                        onClick={() => openSetTarget()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent/90"
                    >
                        <Plus className="w-3.5 h-3.5" /> Set Target
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden">
                {targets.length === 0 ? (
                    <div className="py-16 text-center text-muted">
                        <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">No targets set for {period}</p>
                        <p className="text-xs mt-1">Click &quot;Set Target&quot; to assign a monthly target to an agent.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="crm-table min-w-[900px] whitespace-nowrap">
                            <thead>
                                <tr>
                                    <th>Agent</th>
                                    <th>Period</th>
                                    <th>Units (T / A)</th>
                                    <th>Unit Attainment</th>
                                    <th>Revenue (T / A)</th>
                                    <th>Rev Attainment</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {targets.map((row) => (
                                    <tr key={row.id}>
                                        <td>
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
                                                    {row.staffAvatar ?? row.staffName.slice(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-foreground text-sm">{row.staffName}</p>
                                                    <p className="text-[10px] text-muted">{row.staffRole}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="text-xs font-mono text-foreground">{row.period}</span>
                                        </td>
                                        <td>
                                            <span className="text-sm font-semibold text-foreground">{row.unitAchieved}</span>
                                            <span className="text-xs text-muted"> / {row.unitTarget}</span>
                                        </td>
                                        <td className="min-w-[140px]">
                                            <ProgressBar pct={row.unitAttainmentPct} />
                                        </td>
                                        <td>
                                            <span className="text-sm font-semibold text-foreground">
                                                AED {(row.revenueAchieved / 100000).toFixed(1)}L
                                            </span>
                                            <span className="text-xs text-muted">
                                                {' '}/ AED {(row.revenueTarget / 100000).toFixed(1)}L
                                            </span>
                                        </td>
                                        <td className="min-w-[140px]">
                                            <ProgressBar pct={row.revenueAttainmentPct} />
                                        </td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => openSetTarget(row.staffId)}
                                                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:border-accent/40 flex items-center gap-1"
                                                >
                                                    <Target className="w-3 h-3" /> Edit
                                                </button>
                                                <button
                                                    onClick={() => handleSync(row.staffId, row.staffName)}
                                                    disabled={syncingId === row.staffId}
                                                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:border-accent/40 flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    {syncingId === row.staffId ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <RefreshCw className="w-3 h-3" />
                                                    )}
                                                    Sync
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Alert for agents with no targets */}
            {staffOptions.length > targets.length && (
                <div className="glass-card p-4 border-l-4 border-amber-500 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-foreground">
                            {staffOptions.length - targets.length} agent{staffOptions.length - targets.length !== 1 ? 's' : ''} without targets for {period}
                        </p>
                        <p className="text-xs text-muted mt-0.5">Use &quot;Set Target&quot; to assign monthly targets to all agents.</p>
                    </div>
                </div>
            )}

            <SetTargetModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                staffOptions={staffOptions}
                prefillStaffId={modalPrefillStaffId}
                onSaved={load}
            />
        </div>
    )
}
