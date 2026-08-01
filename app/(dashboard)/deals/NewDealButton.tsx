'use client'

/**
 * "New Deal" creator for the pipeline page. Loads stages / contacts / agents
 * on demand, creates a deal via `createDeal`, and refreshes the board. When no
 * pipeline stages exist yet, offers a one-click default-pipeline setup.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { createDeal, listDealStages, seedDefaultDealStages } from '@/app/actions/deals'
import { listContactsBrief } from '@/app/actions/contacts'
import { getStaff } from '@/app/actions/staff'

type Stage = { id: number; name: string; isWon: boolean; isLost: boolean }

export default function NewDealButton() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [seeding, setSeeding] = useState(false)
    const [stages, setStages] = useState<Stage[]>([])
    const [contacts, setContacts] = useState<Array<{ id: number; name: string }>>([])
    const [staff, setStaff] = useState<Array<{ id: number; name: string }>>([])

    const [form, setForm] = useState({
        contactId: '', stageId: '', value: '', source: '', expectedCloseDate: '', assignedAgentId: '', notes: '',
    })

    async function openModal() {
        setOpen(true)
        const [st, cs, sf] = await Promise.all([listDealStages(), listContactsBrief(), getStaff()])
        if (st.success) {
            const list = st.data as Stage[]
            setStages(list)
            const firstOpen = list.find((s) => !s.isWon && !s.isLost) ?? list[0]
            if (firstOpen) setForm((f) => ({ ...f, stageId: String(firstOpen.id) }))
        }
        if (cs.success) setContacts(cs.data.map((c) => ({ id: c.id, name: c.name })))
        if (sf.success) setStaff(sf.data.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })))
    }

    async function handleSeed() {
        setSeeding(true)
        try {
            const res = await seedDefaultDealStages()
            if (!res.success) { toast.error('Could not create stages'); return }
            const st = await listDealStages()
            if (st.success) {
                const list = st.data as Stage[]
                setStages(list)
                const firstOpen = list.find((s) => !s.isWon && !s.isLost) ?? list[0]
                if (firstOpen) setForm((f) => ({ ...f, stageId: String(firstOpen.id) }))
            }
            toast.success('Default pipeline created')
            router.refresh()
        } finally {
            setSeeding(false)
        }
    }

    async function handleCreate() {
        if (!form.contactId) { toast.error('Select a contact'); return }
        if (!form.stageId) { toast.error('Select a stage'); return }
        if (!form.value || Number(form.value) <= 0) { toast.error('Enter a deal value'); return }
        setSaving(true)
        try {
            const res = await createDeal({
                contactId: Number(form.contactId),
                stageId: Number(form.stageId),
                value: Number(form.value),
                source: form.source.trim() || undefined,
                expectedCloseDate: form.expectedCloseDate || undefined,
                assignedAgentId: form.assignedAgentId ? Number(form.assignedAgentId) : undefined,
                notes: form.notes.trim() || undefined,
            })
            if (!res.success) { toast.error(res.error); return }
            toast.success('Deal created')
            setOpen(false)
            setForm({ contactId: '', stageId: '', value: '', source: '', expectedCloseDate: '', assignedAgentId: '', notes: '' })
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <button onClick={openModal} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold">
                <Plus className="size-4" /> New Deal
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
                    <div className="glass-card w-full max-w-lg p-5 space-y-4 bg-background" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-foreground">New Deal</h2>

                        {stages.length === 0 ? (
                            <div className="text-center py-6 space-y-3">
                                <p className="text-sm text-muted">No pipeline stages exist yet.</p>
                                <button onClick={handleSeed} disabled={seeding} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                    {seeding ? <><Loader2 className="size-4 animate-spin inline" /> Creating…</> : 'Set up default pipeline'}
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Contact *</label>
                                            <select value={form.contactId} onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                                <option value="">Select contact</option>
                                                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Stage *</label>
                                            <select value={form.stageId} onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Deal Value (AED ) *</label>
                                            <input type="number" min="0" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Expected Close</label>
                                            <input type="date" value={form.expectedCloseDate} onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Source</label>
                                            <input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="e.g., Walk-in, Referral" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Assign Agent</label>
                                            <select value={form.assignedAgentId} onChange={(e) => setForm((f) => ({ ...f, assignedAgentId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                                <option value="">Unassigned</option>
                                                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Notes</label>
                                        <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm resize-none" />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                                    <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                        {saving ? <><Loader2 className="size-4 animate-spin inline" /> Saving…</> : 'Create Deal'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
