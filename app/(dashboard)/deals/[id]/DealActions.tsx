'use client';

/**
 * Client actions for the deal detail page: inline-edit the deal's core fields
 * and log a manual activity (note / call / email / visit / meeting) to the
 * timeline. Both delegate to server actions and refresh the page on success.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Plus, Loader2, X } from 'lucide-react';
import { updateDeal, addDealActivity } from '@/app/actions/deals';

interface DealInitial {
    id: number;
    value: number;
    expectedCloseDate: string | null; // yyyy-mm-dd or ''
    source: string | null;
    assignedAgentId: number | null;
    notes: string | null;
}

const ACTIVITY_TYPES = ['note', 'call', 'email', 'visit', 'meeting'] as const;

export default function DealActions({
    deal,
    agents,
}: {
    deal: DealInitial;
    agents: Array<{ id: number; name: string }>;
}) {
    const router = useRouter();
    const [showEdit, setShowEdit] = useState(false);
    const [showLog, setShowLog] = useState(false);

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => setShowLog(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover"
            >
                <Plus className="h-3.5 w-3.5" /> Log activity
            </button>
            <button
                onClick={() => setShowEdit(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
                <Pencil className="h-3.5 w-3.5" /> Edit deal
            </button>

            {showEdit && <EditModal deal={deal} agents={agents} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); router.refresh(); }} />}
            {showLog && <LogModal dealId={deal.id} onClose={() => setShowLog(false)} onSaved={() => { setShowLog(false); router.refresh(); }} />}
        </div>
    );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full md:max-w-lg bg-surface border border-border shadow-2xl flex flex-col max-h-[92dvh] md:max-h-[85vh] rounded-t-3xl md:rounded-2xl md:mx-4">
                <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-border">
                    <h2 className="text-base md:text-lg font-semibold text-foreground">{title}</h2>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-hover text-muted hover:text-foreground"><X className="h-5 w-5" /></button>
                </div>
                <div className="px-5 md:px-6 py-5 overflow-y-auto flex-1">{children}</div>
            </div>
        </div>
    );
}

function EditModal({
    deal, agents, onClose, onSaved,
}: {
    deal: DealInitial;
    agents: Array<{ id: number; name: string }>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [value, setValue] = useState(String(deal.value || ''));
    const [expectedCloseDate, setExpectedCloseDate] = useState(deal.expectedCloseDate ?? '');
    const [source, setSource] = useState(deal.source ?? '');
    const [assignedAgentId, setAssignedAgentId] = useState(deal.assignedAgentId ? String(deal.assignedAgentId) : '');
    const [notes, setNotes] = useState(deal.notes ?? '');
    const [saving, setSaving] = useState(false);

    async function save() {
        setSaving(true);
        try {
            const res = await updateDeal(deal.id, {
                value: value.trim() ? Number(value) : undefined,
                expectedCloseDate: expectedCloseDate || null,
                source: source.trim() || null,
                assignedAgentId: assignedAgentId ? Number(assignedAgentId) : null,
                notes: notes.trim() || null,
            });
            if (res.success) { toast.success('Deal updated'); onSaved(); }
            else toast.error(res.error || 'Failed to update deal');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Shell title="Edit Deal" onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs text-muted mb-1.5">Deal value (AED )</label>
                        <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-muted mb-1.5">Expected close</label>
                        <input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-muted mb-1.5">Source</label>
                        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Walk-in, Referral" className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-muted mb-1.5">Assigned agent</label>
                        <select value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm">
                            <option value="">Unassigned</option>
                            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-muted mb-1.5">Notes</label>
                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                </div>
                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                    <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save
                    </button>
                </div>
            </div>
        </Shell>
    );
}

function LogModal({ dealId, onClose, onSaved }: { dealId: number; onClose: () => void; onSaved: () => void }) {
    const [type, setType] = useState<string>('note');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!description.trim()) { toast.error('Enter a description'); return; }
        setSaving(true);
        try {
            const res = await addDealActivity({ dealId, type, description: description.trim() });
            if (res.success) { toast.success('Activity logged'); onSaved(); }
            else toast.error(res.error || 'Failed to log activity');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Shell title="Log Activity" onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <label className="block text-xs text-muted mb-1.5">Type</label>
                    <div className="flex flex-wrap gap-2">
                        {ACTIVITY_TYPES.map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setType(t)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${type === t ? 'bg-accent text-white border-accent' : 'border-border text-muted hover:text-foreground hover:bg-surface-hover'}`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-muted mb-1.5">Description</label>
                    <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Called buyer — wants a site visit this weekend." className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                </div>
                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                    <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Log
                    </button>
                </div>
            </div>
        </Shell>
    );
}
