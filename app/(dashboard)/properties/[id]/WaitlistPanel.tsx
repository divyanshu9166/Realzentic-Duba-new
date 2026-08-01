'use client';

/**
 * WaitlistPanel — collapsible panel showing the pre-launch waitlist for a
 * project. Renders a table of waitlist entries, an inline "Add to Waitlist"
 * form with contact search, and per-row status dropdowns.
 */

import { useState, useEffect, useCallback, useTransition } from 'react';
import {
    UserPlus,
    Clock,
    CheckCircle2,
    X,
    Loader2,
    ChevronDown,
    ChevronUp,
    Search,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
    addToWaitlist,
    getWaitlistForProject,
    updateWaitlistStatus,
    searchContactsForWaitlist,
} from '@/app/actions/waitlist';
import type { WaitlistEntry } from '@/app/actions/waitlist';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactHit {
    id: number;
    name: string;
    phone: string | null;
}

interface WaitlistPanelProps {
    projectId: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ['Waiting', 'Offered', 'Converted', 'Withdrawn'] as const;
type WStatus = (typeof STATUSES)[number];

const STATUS_STYLES: Record<WStatus, string> = {
    Waiting: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
    Offered: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
    Converted: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
    Withdrawn: 'bg-red-500/10 text-red-700 border-red-500/30',
};

const STATUS_ICONS: Record<WStatus, React.ReactNode> = {
    Waiting: <Clock className="w-3 h-3" />,
    Offered: <UserPlus className="w-3 h-3" />,
    Converted: <CheckCircle2 className="w-3 h-3" />,
    Withdrawn: <X className="w-3 h-3" />,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAed(n: number | null | undefined): string {
    if (n == null) return '—';
    return `AED ${Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('en-AE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '—';
    }
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const s = (STATUSES as readonly string[]).includes(status) ? (status as WStatus) : 'Waiting';
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${STATUS_STYLES[s]}`}
        >
            {STATUS_ICONS[s]}
            {s}
        </span>
    );
}

// ─── StatusDropdown ───────────────────────────────────────────────────────────

function StatusDropdown({
    entryId,
    current,
    onChanged,
}: {
    entryId: number;
    current: string;
    onChanged: (id: number, newStatus: string) => void;
}) {
    const [pending, startTransition] = useTransition();

    function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const newStatus = e.target.value;
        startTransition(async () => {
            const res = await updateWaitlistStatus(entryId, newStatus);
            if (res.success) {
                onChanged(entryId, newStatus);
                toast.success(`Status updated to ${newStatus}`);
            } else {
                toast.error(res.error ?? 'Failed to update status');
            }
        });
    }

    return (
        <div className="relative flex items-center gap-1">
            {pending && <Loader2 className="w-3 h-3 animate-spin text-muted flex-shrink-0" />}
            <select
                value={current}
                onChange={handleChange}
                disabled={pending}
                className="text-[11px] py-0.5 px-1.5 rounded-md border border-border bg-surface text-foreground disabled:opacity-50 cursor-pointer"
            >
                {STATUSES.map((s) => (
                    <option key={s} value={s}>
                        {s}
                    </option>
                ))}
            </select>
        </div>
    );
}

// ─── AddWaitlistForm ──────────────────────────────────────────────────────────

function AddWaitlistForm({
    projectId,
    onAdded,
    onCancel,
}: {
    projectId: number;
    onAdded: (entry: WaitlistEntry) => void;
    onCancel: () => void;
}) {
    const [contactSearch, setContactSearch] = useState('');
    const [contactHits, setContactHits] = useState<ContactHit[]>([]);
    const [selectedContact, setSelectedContact] = useState<ContactHit | null>(null);
    const [searching, setSearching] = useState(false);
    const [config, setConfig] = useState('');
    const [budgetMin, setBudgetMin] = useState('');
    const [budgetMax, setBudgetMax] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Debounced contact search
    useEffect(() => {
        if (contactSearch.trim().length < 2) {
            setContactHits([]);
            return;
        }
        const timer = setTimeout(async () => {
            setSearching(true);
            const res = await searchContactsForWaitlist(contactSearch.trim());
            setSearching(false);
            if (res.success) setContactHits(res.data);
        }, 300);
        return () => clearTimeout(timer);
    }, [contactSearch]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedContact) {
            toast.error('Please select a contact');
            return;
        }

        setSubmitting(true);
        const res = await addToWaitlist({
            projectId,
            contactId: selectedContact.id,
            config: config.trim() || undefined,
            budgetMin: budgetMin ? Number(budgetMin) : undefined,
            budgetMax: budgetMax ? Number(budgetMax) : undefined,
            notes: notes.trim() || undefined,
        });
        setSubmitting(false);

        if (res.success) {
            toast.success(`${selectedContact.name} added to waitlist`);
            onAdded(res.data);
        } else {
            toast.error(res.error ?? 'Failed to add to waitlist');
        }
    }

    return (
        <form onSubmit={handleSubmit} className="border border-border rounded-xl p-4 bg-surface space-y-3">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-accent" />
                Add to Waitlist
            </h4>

            {/* Contact search */}
            <div>
                <label className="block text-[11px] font-medium text-muted mb-1">
                    Contact <span className="text-danger">*</span>
                </label>
                {selectedContact ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/5 border border-accent/20">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{selectedContact.name}</p>
                            {selectedContact.phone && (
                                <p className="text-[11px] text-muted">{selectedContact.phone}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { setSelectedContact(null); setContactSearch(''); setContactHits([]); }}
                            className="p-1 rounded-md hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ) : (
                    <div className="relative">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
                            <input
                                type="text"
                                value={contactSearch}
                                onChange={(e) => setContactSearch(e.target.value)}
                                placeholder="Search by name or phone…"
                                className="w-full text-xs pl-8"
                            />
                            {searching && (
                                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted" />
                            )}
                        </div>
                        {contactHits.length > 0 && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                                {contactHits.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => { setSelectedContact(c); setContactSearch(''); setContactHits([]); }}
                                        className="w-full text-left px-3 py-2 hover:bg-surface-light transition-colors"
                                    >
                                        <p className="text-xs font-medium text-foreground">{c.name}</p>
                                        {c.phone && <p className="text-[11px] text-muted">{c.phone}</p>}
                                    </button>
                                ))}
                            </div>
                        )}
                        {contactSearch.trim().length >= 2 && !searching && contactHits.length === 0 && (
                            <p className="mt-1.5 text-[11px] text-muted">No contacts found. Try a different search.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Config + Budget row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <label className="block text-[11px] font-medium text-muted mb-1">Preferred Config</label>
                    <input
                        type="text"
                        value={config}
                        onChange={(e) => setConfig(e.target.value)}
                        placeholder="e.g. 3-bedroom, marina view"
                        className="w-full text-xs"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-muted mb-1">Budget Min (AED )</label>
                    <input
                        type="number"
                        min={0}
                        value={budgetMin}
                        onChange={(e) => setBudgetMin(e.target.value)}
                        placeholder="e.g. 5000000"
                        className="w-full text-xs"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-medium text-muted mb-1">Budget Max (AED )</label>
                    <input
                        type="number"
                        min={0}
                        value={budgetMax}
                        onChange={(e) => setBudgetMax(e.target.value)}
                        placeholder="e.g. 10000000"
                        className="w-full text-xs"
                    />
                </div>
            </div>

            {/* Notes */}
            <div>
                <label className="block text-[11px] font-medium text-muted mb-1">Notes</label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Any additional notes…"
                    className="w-full text-xs resize-none"
                />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
                <button
                    type="submit"
                    disabled={submitting || !selectedContact}
                    className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                    )}
                    Add to Waitlist
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-xs text-muted hover:text-foreground rounded-xl border border-border hover:border-foreground/20 transition-all"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

// ─── WaitlistTable ────────────────────────────────────────────────────────────

function WaitlistTable({
    entries,
    onStatusChanged,
}: {
    entries: WaitlistEntry[];
    onStatusChanged: (id: number, newStatus: string) => void;
}) {
    if (entries.length === 0) {
        return (
            <div className="py-12 text-center text-muted">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">No waitlist entries</p>
                <p className="mt-1 text-xs">Add contacts to the waitlist using the button above.</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
                <thead>
                    <tr className="border-b border-border">
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3 w-10">#</th>
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3">Contact</th>
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3">Preferred Config</th>
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3">Budget Range</th>
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3">Status</th>
                        <th className="text-left text-[11px] font-semibold text-muted py-2 px-3">Registered</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {entries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-surface-light transition-colors">
                            {/* Priority */}
                            <td className="py-2.5 px-3">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold">
                                    {entry.priority}
                                </span>
                            </td>

                            {/* Contact */}
                            <td className="py-2.5 px-3">
                                <p className="font-medium text-foreground">{entry.contactName}</p>
                                {entry.contactPhone && (
                                    <p className="text-[11px] text-muted">{entry.contactPhone}</p>
                                )}
                                {entry.unitNumber && (
                                    <p className="text-[11px] text-accent">Unit {entry.unitNumber}</p>
                                )}
                            </td>

                            {/* Config */}
                            <td className="py-2.5 px-3 text-muted">
                                {entry.config ?? <span className="opacity-40">—</span>}
                            </td>

                            {/* Budget range */}
                            <td className="py-2.5 px-3 text-muted whitespace-nowrap">
                                {entry.budgetMin != null || entry.budgetMax != null ? (
                                    <>
                                        {formatAed(entry.budgetMin)}
                                        {' – '}
                                        {formatAed(entry.budgetMax)}
                                    </>
                                ) : (
                                    <span className="opacity-40">—</span>
                                )}
                            </td>

                            {/* Status dropdown */}
                            <td className="py-2.5 px-3">
                                <StatusDropdown
                                    entryId={entry.id}
                                    current={entry.status}
                                    onChanged={onStatusChanged}
                                />
                            </td>

                            {/* Registered */}
                            <td className="py-2.5 px-3 text-muted whitespace-nowrap">
                                {formatDate(entry.registeredAt)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── WaitlistPanel (exported) ─────────────────────────────────────────────────

export default function WaitlistPanel({ projectId }: WaitlistPanelProps) {
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);

    const loadEntries = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        const res = await getWaitlistForProject(projectId);
        setLoading(false);
        if (res.success) {
            setEntries(res.data);
        } else {
            setLoadError(res.error ?? 'Failed to load waitlist');
        }
    }, [projectId]);

    // Load when panel is opened
    useEffect(() => {
        if (open && entries.length === 0 && !loading) {
            loadEntries();
        }
    }, [open, entries.length, loading, loadEntries]);

    function handleAdded(entry: WaitlistEntry) {
        setEntries((prev) => [...prev, entry].sort((a, b) => a.priority - b.priority));
        setShowAddForm(false);
    }

    function handleStatusChanged(id: number, newStatus: string) {
        setEntries((prev) =>
            prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e)),
        );
    }

    return (
        <div className="glass-card">
            {/* Header / toggle */}
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between p-4 text-sm font-semibold text-foreground"
            >
                <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-accent" />
                    Waitlist
                    {entries.length > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold px-1.5">
                            {entries.length}
                        </span>
                    )}
                </span>
                {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
            </button>

            {open && (
                <div className="border-t border-border">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                        <p className="text-xs text-muted">
                            {loading ? 'Loading…' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
                        </p>
                        {!showAddForm && (
                            <button
                                onClick={() => setShowAddForm(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-semibold transition-all"
                            >
                                <UserPlus className="w-3.5 h-3.5" />
                                Add to Waitlist
                            </button>
                        )}
                    </div>

                    {/* Add form */}
                    {showAddForm && (
                        <div className="px-4 pb-4">
                            <AddWaitlistForm
                                projectId={projectId}
                                onAdded={handleAdded}
                                onCancel={() => setShowAddForm(false)}
                            />
                        </div>
                    )}

                    {/* Loading state */}
                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                        </div>
                    )}

                    {/* Error state */}
                    {loadError && !loading && (
                        <div className="px-4 pb-4 text-center text-sm text-danger">
                            {loadError}
                            <button
                                onClick={loadEntries}
                                className="ml-3 underline text-muted hover:text-foreground text-xs"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {/* Table */}
                    {!loading && !loadError && (
                        <div className="px-4 pb-4">
                            <WaitlistTable entries={entries} onStatusChanged={handleStatusChanged} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
