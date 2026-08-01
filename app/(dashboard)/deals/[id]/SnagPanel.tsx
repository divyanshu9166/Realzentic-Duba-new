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
import Modal from '@/components/Modal'
import { getSnagReports, createSnagReport, updateSnagStatus } from '@/app/actions/snag'

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

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ['Civil', 'Electrical', 'Plumbing', 'Painting', 'Flooring', 'General'] as const
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const

// ─── Status badge ─────────────────────────────────────────────────────────────

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
                status === 'Resolved' ? <CheckCircle2 className="w-3 h-3" /> :
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
    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
            {severity}
        </span>
    )
}

// ─── Report Snag Modal ────────────────────────────────────────────────────────

type SnagForm = {
    title: string
    category: typeof CATEGORIES[number]
    severity: typeof SEVERITIES[number]
    description: string
}

const EMPTY_SNAG_FORM: SnagForm = {
    title: '',
    category: 'General',
    severity: 'Medium',
    description: '',
}

interface ReportSnagModalProps {
    isOpen: boolean
    onClose: () => void
    bookingId: number
    onCreated: () => void
}

function ReportSnagModal({ isOpen, onClose, bookingId, onCreated }: ReportSnagModalProps) {
    const [form, setForm] = useState<SnagForm>(EMPTY_SNAG_FORM)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (isOpen) setForm(EMPTY_SNAG_FORM)
    }, [isOpen])

    const field =
        (k: keyof SnagForm) =>
            (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
                setForm((f) => ({ ...f, [k]: e.target.value }))

    async function handleSubmit() {
        if (!form.title.trim()) { toast.error('Title is required'); return }
        setSaving(true)
        const res = await createSnagReport({
            bookingId,
            title: form.title.trim(),
            category: form.category,
            severity: form.severity,
            description: form.description.trim() || undefined,
        })
        setSaving(false)
        if (res.success) {
            toast.success('Snag report created')
            onCreated()
            onClose()
        } else {
            toast.error(res.error ?? 'Failed to create snag report')
        }
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Report Snag / Defect">
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Title</label>
                    <input
                        type="text"
                        placeholder="e.g. Crack in bedroom wall"
                        value={form.title}
                        onChange={field('title')}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Category</label>
                        <select
                            value={form.category}
                            onChange={field('category')}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Severity</label>
                        <select
                            value={form.severity}
                            onChange={field('severity')}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground"
                        >
                            {SEVERITIES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Description (optional)</label>
                    <textarea
                        rows={3}
                        placeholder="Describe the defect in detail…"
                        value={form.description}
                        onChange={field('description')}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground resize-none"
                    />
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                    {saving ? 'Reporting…' : 'Report Snag'}
                </button>
            </div>
        </Modal>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SnagPanelProps {
    bookingId: number
}

export default function SnagPanel({ bookingId }: SnagPanelProps) {
    const [snags, setSnags] = useState<SnagRow[]>([])
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [resolvingId, setResolvingId] = useState<number | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const res = await getSnagReports({ bookingId })
        if (res.success) setSnags(res.data as SnagRow[])
        setLoading(false)
    }, [bookingId])

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

    const openCount = snags.filter((s) => s.status === 'Open' || s.status === 'In Progress').length

    return (
        <div className="glass-card p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <WrenchIcon className="w-4 h-4 text-accent" />
                    <h2 className="text-base font-semibold text-foreground">Snag Reports</h2>
                    {openCount > 0 && (
                        <span className="rounded-full bg-red-500/10 text-red-700 px-1.5 py-0.5 text-[10px] font-medium">
                            {openCount} open
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90"
                >
                    <Plus className="w-3.5 h-3.5" /> Report Snag
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="space-y-2 animate-pulse">
                    {[1, 2].map((i) => (
                        <div key={i} className="h-14 bg-surface rounded-lg" />
                    ))}
                </div>
            ) : snags.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No snag reports for this booking.</p>
            ) : (
                <ul className="space-y-2">
                    {snags.map((snag) => (
                        <li
                            key={snag.id}
                            className="flex items-start gap-3 rounded-lg border border-border bg-surface/60 p-3"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className="text-sm font-medium text-foreground">{snag.title}</span>
                                    <StatusBadge status={snag.status} />
                                    <SeverityBadge severity={snag.severity} />
                                    <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded">
                                        {snag.category}
                                    </span>
                                </div>
                                {snag.description && (
                                    <p className="text-xs text-muted line-clamp-2">{snag.description}</p>
                                )}
                                <div className="flex flex-wrap gap-x-3 mt-1 text-[10px] text-muted">
                                    {snag.assignedToName && <span>Assigned: {snag.assignedToName}</span>}
                                    <span>{new Date(snag.createdAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    {snag.resolvedAt && (
                                        <span className="text-emerald-700">
                                            Resolved: {new Date(snag.resolvedAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {(snag.status === 'Open' || snag.status === 'In Progress') && (
                                <button
                                    onClick={() => handleMarkResolved(snag.id)}
                                    disabled={resolvingId === snag.id}
                                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 text-xs font-medium hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                    {resolvingId === snag.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    Resolve
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <ReportSnagModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                bookingId={bookingId}
                onCreated={load}
            />
        </div>
    )
}
