'use client';

/**
 * Follow-ups section.
 *
 * A follow-up is an interested prospect who is not ready to buy yet and has
 * given a future date to reconnect. Supports manual add, status changes,
 * rescheduling, and quick call/WhatsApp actions. Leads are converted into
 * follow-ups from the Leads page.
 */

import { useState, useEffect, useCallback } from 'react';
import {
    Search, Plus, Phone, Mail, MessageSquare, CalendarClock, Clock,
    AlertTriangle, CheckCircle2, XCircle, Trash2, Pencil, User,
} from 'lucide-react';
import {
    getFollowUps, getFollowUpCounts, createFollowUp,
    updateFollowUpStatus, updateFollowUp, deleteFollowUp,
} from '@/app/actions/follow-ups';
import { getStaff } from '@/app/actions/staff';
import Modal from '@/components/Modal';
import { useAlertToast } from '@/components/AlertToastProvider';
import { LEAD_SOURCE_OPTIONS } from '@/lib/lead-sources';
import { RE_BUDGET_RANGES } from '@/lib/real-estate-options';

const STATUS_TABS = [
    { value: 'OPEN', label: 'Open' },
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'REMINDED', label: 'Reminded' },
    { value: 'CONTACTED', label: 'Contacted' },
    { value: 'CONVERTED', label: 'Converted' },
    { value: 'LOST', label: 'Lost' },
];

const statusBadge = {
    PENDING: 'bg-info-light text-info border-info/20',
    REMINDED: 'bg-purple-light text-purple border-purple/20',
    CONTACTED: 'bg-accent-light text-accent border-accent/20',
    CONVERTED: 'bg-success-light text-success border-success/20',
    LOST: 'bg-danger-light text-danger border-danger/20',
};

const dueBadge = {
    overdue: 'bg-red-500/10 text-red-700 border-red-500/20',
    today: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    upcoming: 'bg-surface text-muted border-border',
};

const priorityColor = {
    High: 'text-red-600',
    Medium: 'text-amber-600',
    Low: 'text-muted',
};

const normalizePhoneNumber = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00971')) return digits.slice(2);
    if (digits.startsWith('971')) return digits;
    if (digits.length === 10 && digits.startsWith('05')) return `971${digits.slice(1)}`;
    if (digits.length === 9 && digits.startsWith('5')) return `971${digits}`;
    return digits;
};

const buildWhatsAppUrl = (phone, message) => {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return '';
    return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};

const fmtDate = (iso) => {
    try {
        return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return iso;
    }
};

const dueLabel = (f) => {
    if (f.dueBucket === 'today') return 'Due today';
    if (f.dueBucket === 'overdue') return `${Math.abs(f.daysUntil)}d overdue`;
    return `in ${f.daysUntil}d`;
};

const initials = (name) => (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

export default function FollowUpsPage() {
    const { notify } = useAlertToast();
    const [items, setItems] = useState([]);
    const [counts, setCounts] = useState(null);
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('OPEN');
    const [search, setSearch] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(null);
    const [toDelete, setToDelete] = useState(null);

    const refresh = useCallback(async () => {
        const [listRes, countRes] = await Promise.all([getFollowUps(), getFollowUpCounts()]);
        if (listRes.success) setItems(listRes.data);
        if (countRes.success) setCounts(countRes.data);
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
        getStaff().then((res) => {
            if (res.success) setStaff(res.data);
        });
    }, [refresh]);

    const visible = items.filter((f) => {
        const matchesTab =
            tab === 'ALL' ? true : tab === 'OPEN' ? (f.status === 'PENDING' || f.status === 'CONTACTED' || f.status === 'REMINDED') : f.status === tab;
        const q = search.toLowerCase();
        const matchesSearch =
            !q || f.name.toLowerCase().includes(q) || f.interest.toLowerCase().includes(q) || (f.phone || '').includes(q);
        return matchesTab && matchesSearch;
    });

    const handleCreate = async (e) => {
        e.preventDefault();
        const f = e.target;
        setSaving(true);
        const res = await createFollowUp({
            name: f.name.value,
            phone: f.phone.value,
            email: f.email.value || '',
            interest: f.interest.value,
            budget: f.budget.value || undefined,
            followUpDate: f.followUpDate.value,
            reason: f.reason.value || undefined,
            priority: f.priority.value || undefined,
            source: f.source.value || undefined,
            notes: f.notes.value || undefined,
            assignedToId: f.assignedToId.value ? Number(f.assignedToId.value) : undefined,
        });
        setSaving(false);
        if (res.success) {
            setShowAdd(false);
            await refresh();
            notify('Follow-up added', { variant: 'success' });
        } else {
            notify(res.error || 'Failed to add follow-up', { variant: 'danger' });
        }
    };

    const handleStatus = async (id, status) => {
        const res = await updateFollowUpStatus({ id, status });
        if (res.success) await refresh();
        else notify(res.error || 'Failed to update status', { variant: 'danger' });
    };

    const handleEditSave = async (e) => {
        e.preventDefault();
        const f = e.target;
        setSaving(true);
        const res = await updateFollowUp({
            id: editing.id,
            followUpDate: f.followUpDate.value,
            reason: f.reason.value || undefined,
            priority: f.priority.value || undefined,
            interest: f.interest.value || undefined,
            budget: f.budget.value || undefined,
            notes: f.notes.value || undefined,
            assignedToId: f.assignedToId.value ? Number(f.assignedToId.value) : null,
        });
        setSaving(false);
        if (res.success) {
            setEditing(null);
            await refresh();
            notify('Follow-up updated', { variant: 'success' });
        } else {
            notify(res.error || 'Failed to update', { variant: 'danger' });
        }
    };

    const confirmDelete = async () => {
        if (!toDelete) return;
        const res = await deleteFollowUp(toDelete.id);
        setToDelete(null);
        if (res.success) {
            await refresh();
            notify('Follow-up removed', { variant: 'success' });
        } else {
            notify(res.error || 'Failed to remove', { variant: 'danger' });
        }
    };

    const openWhatsApp = (f) => {
        const url = buildWhatsAppUrl(f.phone, `Hello ${f.name}, following up regarding ${f.interest}.`);
        if (!url) return notify('Phone number is missing', { variant: 'danger' });
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const todayStr = new Date().toISOString().split('T')[0];

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 w-48 bg-surface rounded-lg" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-surface rounded-2xl" />)}</div>
                <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-surface rounded-xl" />)}</div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-[fade-in_0.5s_ease-out] min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <CalendarClock className="w-6 h-6 text-accent" />
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-foreground">Follow-ups</h1>
                        <p className="text-xs md:text-sm text-muted mt-0.5">Interested prospects to reconnect with on a scheduled date.</p>
                    </div>
                </div>
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all">
                    <Plus className="w-4 h-4" /> Add Follow-up
                </button>
            </div>

            {/* Stat cards */}
            {counts && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={AlertTriangle} label="Overdue" value={counts.overdue} accent="text-red-600" />
                    <StatCard icon={Clock} label="Due Today" value={counts.today} accent="text-amber-600" />
                    <StatCard icon={CalendarClock} label="Upcoming" value={counts.upcoming} accent="text-accent" />
                    <StatCard icon={CheckCircle2} label="Converted" value={counts.converted} accent="text-success" />
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex bg-surface rounded-xl border border-border p-0.5 flex-wrap">
                    {STATUS_TABS.map((t) => (
                        <button key={t.value} onClick={() => setTab(t.value)}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t.value ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>
                            {t.label}
                        </button>
                    ))}
                </div>
                <div className="relative flex-1 md:flex-none md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input type="text" placeholder="Search by name, interest, phone..." value={search} onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                </div>
            </div>

            {/* List */}
            {visible.length === 0 ? (
                <div className="glass-card py-16 text-center text-muted">
                    <CalendarClock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-foreground">No follow-ups here</p>
                    <p className="text-sm mt-1">Add one manually, or convert an interested lead from the Leads page.</p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {visible.map((f) => {
                        const closed = f.status === 'CONVERTED' || f.status === 'LOST';
                        return (
                            <div key={f.id} className="glass-card p-4">
                                <div className="flex items-start gap-3 flex-wrap">
                                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-sm font-semibold text-accent flex-shrink-0">
                                        {initials(f.name)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-semibold text-foreground">{f.name}</p>
                                            <span className={`badge ${statusBadge[f.status]}`}>{f.status}</span>
                                            {f.status === 'PENDING' && (
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${dueBadge[f.dueBucket]}`}>
                                                    <Clock className="w-3 h-3" /> {dueLabel(f)}
                                                </span>
                                            )}
                                            {f.status === 'REMINDED' && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border border-purple/20 bg-purple-light text-purple">
                                                    <CheckCircle2 className="w-3 h-3" /> Reminder sent
                                                </span>
                                            )}
                                            {f.leadId && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-light text-purple">From Lead</span>}
                                        </div>
                                        <p className="text-xs text-muted mt-1">🏠 {f.interest}{f.budget ? ` · ${f.budget}` : ''}</p>
                                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted flex-wrap">
                                            <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {fmtDate(f.followUpDate)}</span>
                                            <span className={`flex items-center gap-1 ${priorityColor[f.priority] || ''}`}>● {f.priority}</span>
                                            {f.assignedTo && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {f.assignedTo}</span>}
                                            {f.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {f.phone}</span>}
                                        </div>
                                        {f.reason && <p className="text-xs text-foreground mt-2 bg-surface rounded-lg px-2.5 py-1.5">💬 {f.reason}</p>}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                        <a href={`tel:${f.phone}`} title="Call" className="p-2 rounded-lg bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"><Phone className="w-3.5 h-3.5" /></a>
                                        <button onClick={() => openWhatsApp(f)} title="WhatsApp" className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground"><MessageSquare className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => setEditing(f)} title="Edit / reschedule" className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => setToDelete(f)} title="Remove" className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>

                                {/* Status quick-actions */}
                                {!closed && (
                                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/60 flex-wrap">
                                        {f.status !== 'CONTACTED' && (
                                            <button onClick={() => handleStatus(f.id, 'CONTACTED')} className="text-xs px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 font-medium">Mark Contacted</button>
                                        )}
                                        <button onClick={() => handleStatus(f.id, 'CONVERTED')} className="text-xs px-3 py-1.5 rounded-lg bg-success-light text-success hover:opacity-80 font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Converted</button>
                                        <button onClick={() => handleStatus(f.id, 'LOST')} className="text-xs px-3 py-1.5 rounded-lg bg-danger-light text-danger hover:opacity-80 font-medium flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Lost</button>
                                    </div>
                                )}
                                {closed && (
                                    <div className="mt-3 pt-3 border-t border-border/60">
                                        <button onClick={() => handleStatus(f.id, 'PENDING')} className="text-xs px-3 py-1.5 rounded-lg bg-surface border border-border text-muted hover:text-foreground font-medium">Reopen</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add modal */}
            <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Follow-up" size="lg">
                <form onSubmit={handleCreate} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FieldInput name="name" label="Name *" required />
                        <FieldInput name="phone" label="Phone *" required type="tel" />
                        <FieldInput name="email" label="Email" type="email" />
                        <FieldInput name="interest" label="Interest / Property *" required placeholder="e.g. 3-bedroom apartment in Dubai Marina" />
                        <FieldSelect name="budget" label="Budget" options={RE_BUDGET_RANGES} />
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Follow-up Date *</label>
                            <input name="followUpDate" type="date" required min={todayStr} defaultValue={todayStr} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                        </div>
                        <FieldSelect name="priority" label="Priority" options={['Low', 'Medium', 'High']} defaultValue="Medium" />
                        <FieldSelect name="source" label="Source" options={LEAD_SOURCE_OPTIONS} />
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Assign To</label>
                            <select name="assignedToId" className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm">
                                <option value="">Unassigned</option>
                                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Reason / When are they buying?</label>
                        <input name="reason" placeholder="e.g. Will decide after 2 months / after Diwali" className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Notes</label>
                        <textarea name="notes" rows={2} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                    </div>
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving...' : 'Add Follow-up'}</button>
                    </div>
                </form>
            </Modal>

            {/* Edit modal */}
            <Modal isOpen={!!editing} onClose={() => setEditing(null)} title="Edit Follow-up" size="lg">
                {editing && (
                    <form onSubmit={handleEditSave} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <FieldInput name="interest" label="Interest / Property" defaultValue={editing.interest} />
                            <FieldSelect name="budget" label="Budget" options={RE_BUDGET_RANGES} defaultValue={editing.budget || ''} />
                            <div>
                                <label className="block text-xs font-medium text-muted mb-1.5">Follow-up Date</label>
                                <input name="followUpDate" type="date" defaultValue={editing.followUpDate?.split('T')[0]} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                            </div>
                            <FieldSelect name="priority" label="Priority" options={['Low', 'Medium', 'High']} defaultValue={editing.priority} />
                            <div>
                                <label className="block text-xs font-medium text-muted mb-1.5">Assign To</label>
                                <select name="assignedToId" defaultValue={editing.assignedToId || ''} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm">
                                    <option value="">Unassigned</option>
                                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Reason / When are they buying?</label>
                            <input name="reason" defaultValue={editing.reason || ''} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Notes</label>
                            <textarea name="notes" rows={2} defaultValue={editing.notes || ''} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                        </div>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        </div>
                    </form>
                )}
            </Modal>

            {/* Delete confirm */}
            <Modal isOpen={!!toDelete} onClose={() => setToDelete(null)} title="Remove Follow-up" size="sm">
                {toDelete && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted">Remove the follow-up for <strong className="text-foreground">{toDelete.name}</strong>? This cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setToDelete(null)} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm">Remove</button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, accent }) {
    return (
        <div className="glass-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center flex-shrink-0">
                <Icon className={`w-5 h-5 ${accent}`} />
            </div>
            <div>
                <p className={`text-xl font-bold leading-none ${accent}`}>{value ?? 0}</p>
                <p className="text-[11px] text-muted mt-1">{label}</p>
            </div>
        </div>
    );
}

function FieldInput({ name, label, type = 'text', required, placeholder, defaultValue }) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
            <input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue}
                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
        </div>
    );
}

function FieldSelect({ name, label, options, defaultValue = '' }) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
            <select name={name} defaultValue={defaultValue} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm">
                <option value="">Select...</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
        </div>
    );
}
