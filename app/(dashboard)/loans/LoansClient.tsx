'use client'

/**
 * Mortgage desk — track buyer mortgage applications through the UAE bank pipeline.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Landmark, Plus, Loader2, Phone } from 'lucide-react'
import { getLoans, createLoan, updateLoan, type LoanRow } from '@/app/actions/loans'
import { getStaff } from '@/app/actions/staff'
import { listContactsBrief } from '@/app/actions/contacts'

const STATUSES = ['Enquiry', 'Documentation', 'Submitted', 'Sanctioned', 'Disbursed', 'Rejected']
const STATUS_CLS: Record<string, string> = {
    Enquiry: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
    Documentation: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    Submitted: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
    Sanctioned: 'bg-teal-500/10 text-teal-700 border-teal-500/20',
    Disbursed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    Rejected: 'bg-red-500/10 text-red-700 border-red-500/20',
}

function formatAed(amount: number | null): string {
    if (amount == null || !Number.isFinite(amount) || amount === 0) return '—'
    if (amount >= 1e7) return `AED ${(amount / 1e7).toFixed(2)} Cr`
    if (amount >= 1e5) return `AED ${(amount / 1e5).toFixed(1)} L`
    return `AED ${Math.round(amount).toLocaleString('en-AE')}`
}

export default function LoansClient() {
    const [loans, setLoans] = useState<LoanRow[]>([])
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState('All')
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [staff, setStaff] = useState<Array<{ id: number; name: string }>>([])
    const [contacts, setContacts] = useState<Array<{ id: number; name: string }>>([])

    const [form, setForm] = useState({
        contactId: '', bankName: '', loanAmount: '', interestRate: '', tenureYears: '',
        status: 'Enquiry', applicationNo: '', assignedToId: '', notes: '',
    })

    const load = useCallback(async () => {
        setLoading(true)
        const res = await getLoans(statusFilter === 'All' ? {} : { status: statusFilter })
        if (res.success) setLoans(res.data)
        setLoading(false)
    }, [statusFilter])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        getStaff().then((r) => { if (r.success) setStaff(r.data.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name }))) })
        listContactsBrief().then((r) => { if (r.success) setContacts(r.data.map((c) => ({ id: c.id, name: c.name }))) })
    }, [])

    async function handleCreate() {
        if (!form.contactId) { toast.error('Select a contact'); return }
        if (!form.bankName.trim()) { toast.error('Bank name is required'); return }
        setSaving(true)
        try {
            const res = await createLoan({
                contactId: Number(form.contactId),
                bankName: form.bankName.trim(),
                loanAmount: form.loanAmount ? Math.round(Number(form.loanAmount)) : undefined,
                interestRate: form.interestRate ? Number(form.interestRate) : undefined,
                tenureYears: form.tenureYears ? Number(form.tenureYears) : undefined,
                status: form.status,
                applicationNo: form.applicationNo.trim() || undefined,
                assignedToId: form.assignedToId ? Number(form.assignedToId) : undefined,
                notes: form.notes.trim() || undefined,
            })
            if (!res.success) { toast.error(res.error); return }
            toast.success('Mortgage application added')
            setShowModal(false)
            setForm({ contactId: '', bankName: '', loanAmount: '', interestRate: '', tenureYears: '', status: 'Enquiry', applicationNo: '', assignedToId: '', notes: '' })
            await load()
        } finally {
            setSaving(false)
        }
    }

    async function handleStatusChange(id: number, status: string) {
        const res = await updateLoan({ id, status })
        if (!res.success) { toast.error(res.error); return }
        await load()
    }

    const sanctioned = loans.filter((l) => l.status === 'Sanctioned' || l.status === 'Disbursed').length

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10"><Landmark className="size-5 text-accent" /></div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Mortgage Desk</h1>
                        <p className="text-sm text-muted">{loans.length} applications · {sanctioned} sanctioned/disbursed</p>
                    </div>
                </div>
                <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold">
                    <Plus className="size-4" /> New Application
                </button>
            </div>

            <div className="flex gap-1 flex-wrap">
                {['All', ...STATUSES].map((s) => (
                    <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-accent text-white' : 'text-muted hover:text-foreground hover:bg-surface-hover'}`}>{s}</button>
                ))}
            </div>

            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-accent" /></div>
                ) : loans.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted">No mortgage applications</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="crm-table">
                            <thead>
                                <tr>
                                    <th>Applicant</th>
                                    <th>Bank</th>
                                    <th>Mortgage Amount</th>
                                    <th>Rate / Tenure</th>
                                    <th>Sanctioned</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loans.map((l) => (
                                    <tr key={l.id}>
                                        <td>
                                            <p className="font-medium text-foreground">{l.contactName}</p>
                                            {l.contactPhone && <p className="text-xs text-muted flex items-center gap-1"><Phone className="size-3" />{l.contactPhone}</p>}
                                        </td>
                                        <td className="text-foreground">{l.bankName}{l.applicationNo && <span className="block text-xs text-muted">#{l.applicationNo}</span>}</td>
                                        <td className="text-foreground">{formatAed(l.loanAmount)}</td>
                                        <td className="text-muted text-xs">{l.interestRate ? `${l.interestRate}%` : '—'}{l.tenureYears ? ` · ${l.tenureYears}y` : ''}</td>
                                        <td className="text-emerald-600 font-medium">{formatAed(l.sanctionedAmount)}</td>
                                        <td>
                                            <select
                                                value={l.status}
                                                onChange={(e) => handleStatusChange(l.id, e.target.value)}
                                                className={`px-2 py-1 rounded-full text-xs border bg-transparent ${STATUS_CLS[l.status] ?? 'border-border text-muted'}`}
                                            >
                                                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
                    <div className="glass-card w-full max-w-lg p-5 space-y-4 bg-background" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-foreground">New Mortgage Application</h2>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Applicant (contact) *</label>
                                    <select value={form.contactId} onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        <option value="">Select contact</option>
                                        {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Bank *</label>
                                    <input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g., HDFC, SBI" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Mortgage Amount (AED)</label>
                                    <input type="number" min="0" value={form.loanAmount} onChange={(e) => setForm((f) => ({ ...f, loanAmount: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Rate (%)</label>
                                    <input type="number" min="0" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Tenure (yrs)</label>
                                    <input type="number" min="1" max="40" value={form.tenureYears} onChange={(e) => setForm((f) => ({ ...f, tenureYears: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Status</label>
                                    <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Application No.</label>
                                    <input value={form.applicationNo} onChange={(e) => setForm((f) => ({ ...f, applicationNo: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Assigned to</label>
                                <select value={form.assignedToId} onChange={(e) => setForm((f) => ({ ...f, assignedToId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                    <option value="">Unassigned</option>
                                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Notes</label>
                                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm resize-none" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                {saving ? <><Loader2 className="size-4 animate-spin inline" /> Saving…</> : 'Add Application'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
