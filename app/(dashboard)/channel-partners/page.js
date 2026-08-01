'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Plus, Search, Handshake, Users2, Wallet, CircleDollarSign, Clock,
    CheckCircle2, Banknote, Layers, ShieldCheck,
} from 'lucide-react';
import {
    getPartners, getCommissions, getPayoutBatches, getPartnerMetrics,
    onboardPartner, createCommission, approveCommission,
    createPayoutBatch, completePayoutBatch,
} from '@/app/actions/channel-partners';
import Modal from '@/components/Modal';
import { useAlertToast } from '@/components/AlertToastProvider';

const PARTNER_TYPES = ['Individual', 'Firm', 'Company'];
const PARTNER_STATUSES = ['Active', 'Inactive', 'Suspended'];
const COMMISSION_TYPES = ['Percentage', 'Fixed', 'Slab'];

const tabs = [
    { id: 'partners', label: 'Partners', icon: Users2 },
    { id: 'commissions', label: 'Commission Ledger', icon: Banknote },
    { id: 'payouts', label: 'Payout Batches', icon: Layers },
];

const partnerStatusColor = {
    Active: 'bg-success-light text-success border-success/20',
    Inactive: 'bg-surface-hover text-muted border-border',
    Suspended: 'bg-danger-light text-danger border-danger/20',
};

const commissionStatusColor = {
    Pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    Approved: 'bg-info-light text-info border-info/20',
    Paid: 'bg-success-light text-success border-success/20',
    Disputed: 'bg-danger-light text-danger border-danger/20',
};

const batchStatusColor = {
    Draft: 'bg-surface-hover text-muted border-border',
    Processing: 'bg-info-light text-info border-info/20',
    Completed: 'bg-success-light text-success border-success/20',
};

const formatAed = (n) =>
    `AED ${Number(n || 0).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;

const formatDate = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return '—';
    }
};

export default function ChannelPartnersPage() {
    const { notify } = useAlertToast();
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('partners');
    const [search, setSearch] = useState('');

    const [partners, setPartners] = useState([]);
    const [commissions, setCommissions] = useState([]);
    const [batches, setBatches] = useState([]);
    const [metrics, setMetrics] = useState(null);

    const [showOnboard, setShowOnboard] = useState(false);
    const [showCommission, setShowCommission] = useState(false);
    const [showBatch, setShowBatch] = useState(false);
    const [batchToComplete, setBatchToComplete] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [selectedCommissionIds, setSelectedCommissionIds] = useState([]);

    const refresh = useCallback(async () => {
        const [p, c, b, m] = await Promise.all([
            getPartners(), getCommissions(), getPayoutBatches(), getPartnerMetrics(),
        ]);
        if (p.success) setPartners(p.data);
        if (c.success) setCommissions(c.data);
        if (b.success) setBatches(b.data);
        if (m.success) setMetrics(m.data);
        if (!p.success) notify(p.error, { variant: 'danger' });
    }, [notify]);

    useEffect(() => {
        refresh().finally(() => setLoading(false));
    }, [refresh]);

    // ─── Onboard partner ──────────────────────────────
    const handleOnboard = async (e) => {
        e.preventDefault();
        const f = e.target;
        const commissionType = f.commissionType.value;
        const payload = {
            name: f.name.value,
            company: f.company.value,
            brnNumber: f.brnNumber.value,
            phone: f.phone.value,
            email: f.email.value,
            type: f.type.value,
            status: f.status.value,
            commissionType,
            commissionRate: commissionType === 'Percentage' ? Number(f.commissionRate.value || 0) : 0,
            fixedCommission: commissionType === 'Fixed' ? Number(f.fixedCommission.value || 0) : 0,
            tradeLicenseNo: f.tradeLicenseNo.value,
            agreementDocUrl: f.agreementDocUrl.value,
        };
        setSubmitting(true);
        const res = await onboardPartner(payload);
        setSubmitting(false);
        if (res.success) {
            notify('Partner onboarded', { variant: 'success' });
            setShowOnboard(false);
            await refresh();
        } else {
            notify(res.error, { variant: 'danger' });
        }
    };

    // ─── Create commission ────────────────────────────
    const handleCreateCommission = async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = { partnerId: Number(f.partnerId.value) };
        if (f.bookingId.value) payload.bookingId = Number(f.bookingId.value);
        if (f.dealId.value) payload.dealId = Number(f.dealId.value);
        setSubmitting(true);
        const res = await createCommission(payload);
        setSubmitting(false);
        if (res.success) {
            notify(`Commission created: ${formatAed(res.data.amount)}`, { variant: 'success' });
            setShowCommission(false);
            await refresh();
        } else {
            notify(res.error, { variant: 'danger' });
        }
    };

    const handleApprove = async (commissionId) => {
        const res = await approveCommission({ commissionId });
        if (res.success) {
            notify('Commission approved', { variant: 'success' });
            await refresh();
        } else {
            notify(res.error, { variant: 'danger' });
        }
    };

    // ─── Create payout batch ──────────────────────────
    const toggleCommissionSelect = (id) => {
        setSelectedCommissionIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const handleCreateBatch = async (e) => {
        e.preventDefault();
        const f = e.target;
        if (selectedCommissionIds.length === 0) {
            notify('Select at least one approved commission', { variant: 'danger' });
            return;
        }
        setSubmitting(true);
        const res = await createPayoutBatch({
            batchName: f.batchName.value,
            commissionIds: selectedCommissionIds,
        });
        setSubmitting(false);
        if (res.success) {
            notify(`Batch created: ${formatAed(res.data.totalAmount)} across ${res.data.partnerCount} partner(s)`, { variant: 'success' });
            setShowBatch(false);
            setSelectedCommissionIds([]);
            await refresh();
        } else {
            notify(res.error, { variant: 'danger' });
        }
    };

    const handleCompleteBatch = async (e) => {
        e.preventDefault();
        if (!batchToComplete) return;
        const f = e.target;
        setSubmitting(true);
        const res = await completePayoutBatch({
            batchId: batchToComplete.id,
            utr: f.utr.value,
        });
        setSubmitting(false);
        if (res.success) {
            notify(`Batch completed: ${res.data.commissionsPaid} commission(s) marked Paid`, { variant: 'success' });
            setBatchToComplete(null);
            await refresh();
        } else {
            notify(res.error, { variant: 'danger' });
        }
    };

    // approved commissions not yet in a batch are eligible for payout
    const batchableCommissions = commissions.filter(
        (c) => c.status === 'Approved' && c.payoutBatchId === null
    );

    const filteredPartners = partners.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.brnNumber.toLowerCase().includes(search.toLowerCase()) ||
            (p.company || '').toLowerCase().includes(search.toLowerCase())
    );

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 w-56 bg-surface rounded-lg" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-surface rounded-2xl" />)}
                </div>
                <div className="h-64 bg-surface rounded-2xl" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-[fade-in_0.5s_ease-out] min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
                        <Handshake className="w-6 h-6 text-accent" /> Channel Partners
                    </h1>
                    <p className="text-xs md:text-sm text-muted mt-1">
                        Onboard brokers, track commissions, and manage payout batches.
                    </p>
                </div>
                <button
                    onClick={() => setShowOnboard(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all"
                >
                    <Plus className="w-4 h-4" /> Onboard Partner
                </button>
            </div>

            {/* Metrics */}
            <MetricsRow metrics={metrics} />

            {/* Tabs */}
            <div className="flex bg-surface rounded-xl border border-border p-0.5 w-fit overflow-x-auto">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${activeTab === t.id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                                }`}
                        >
                            <Icon className="w-3.5 h-3.5" /> {t.label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'partners' && (
                <PartnersTab
                    partners={filteredPartners}
                    search={search}
                    setSearch={setSearch}
                />
            )}

            {activeTab === 'commissions' && (
                <CommissionsTab
                    commissions={commissions}
                    onApprove={handleApprove}
                    onCreate={() => setShowCommission(true)}
                />
            )}

            {activeTab === 'payouts' && (
                <PayoutsTab
                    batches={batches}
                    batchable={batchableCommissions}
                    onCreate={() => { setSelectedCommissionIds([]); setShowBatch(true); }}
                    onComplete={(b) => setBatchToComplete(b)}
                />
            )}

            {/* ── Onboard Modal ── */}
            <Modal isOpen={showOnboard} onClose={() => setShowOnboard(false)} title="Onboard Channel Partner" size="lg">
                <OnboardForm submitting={submitting} onSubmit={handleOnboard} onCancel={() => setShowOnboard(false)} />
            </Modal>

            {/* ── Create Commission Modal ── */}
            <Modal isOpen={showCommission} onClose={() => setShowCommission(false)} title="Compute Commission">
                <form className="space-y-4" onSubmit={handleCreateCommission}>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Partner</label>
                        <select name="partnerId" required className="w-full" defaultValue="">
                            <option value="" disabled>Select a partner</option>
                            {partners.map((p) => (
                                <option key={p.id} value={p.id}>{p.name} — {p.commissionType}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Booking ID</label>
                            <input type="number" name="bookingId" min="1" placeholder="e.g. 12" className="w-full" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">Deal ID</label>
                            <input type="number" name="dealId" min="1" placeholder="optional" className="w-full" />
                        </div>
                    </div>
                    <p className="text-xs text-muted">
                        The commission amount is computed from the partner's configured rate and the booking agreement value. Provide at least a booking or deal.
                    </p>
                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setShowCommission(false)} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
                        <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">{submitting ? 'Computing...' : 'Create'}</button>
                    </div>
                </form>
            </Modal>

            {/* ── Create Payout Batch Modal ── */}
            <Modal isOpen={showBatch} onClose={() => setShowBatch(false)} title="Create Payout Batch" size="lg">
                <form className="space-y-4" onSubmit={handleCreateBatch}>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Batch Name</label>
                        <input type="text" name="batchName" required placeholder="e.g. October Payout" className="w-full" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted mb-2">Approved Commissions</label>
                        {batchableCommissions.length === 0 ? (
                            <div className="text-center py-8 text-sm text-muted border-2 border-dashed border-border rounded-xl">
                                No approved commissions awaiting payout
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {batchableCommissions.map((c) => (
                                    <label key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-border cursor-pointer hover:border-accent/30">
                                        <input
                                            type="checkbox"
                                            checked={selectedCommissionIds.includes(c.id)}
                                            onChange={() => toggleCommissionSelect(c.id)}
                                            className="w-4 h-4 accent-[var(--accent,#6366f1)]"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground truncate">{c.partnerName}</p>
                                            <p className="text-xs text-muted">Commission #{c.id}</p>
                                        </div>
                                        <span className="text-sm font-semibold text-accent">{formatAed(c.amount)}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center justify-between pt-2">
                        <p className="text-xs text-muted">{selectedCommissionIds.length} selected</p>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowBatch(false)} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
                            <button type="submit" disabled={submitting || selectedCommissionIds.length === 0} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">{submitting ? 'Creating...' : 'Create Batch'}</button>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* ── Complete Batch Modal ── */}
            <Modal isOpen={!!batchToComplete} onClose={() => setBatchToComplete(null)} title="Complete Payout Batch" size="sm">
                {batchToComplete && (
                    <form className="space-y-4" onSubmit={handleCompleteBatch}>
                        <p className="text-sm text-muted">
                            Completing <strong className="text-foreground">{batchToComplete.batchName}</strong> marks all{' '}
                            {batchToComplete.commissionCount} included commission(s) as <strong className="text-foreground">Paid</strong>. This cannot be undone.
                        </p>
                        <div>
                            <label className="block text-xs font-medium text-muted mb-1.5">UTR / Reference (optional)</label>
                            <input type="text" name="utr" placeholder="Bank transfer reference" className="w-full" />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={() => setBatchToComplete(null)} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
                            <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-success hover:bg-success/90 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">{submitting ? 'Completing...' : 'Mark Paid'}</button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
}

// ─── Metrics row ─────────────────────────────────────
function MetricsRow({ metrics }) {
    const byStatus = metrics?.commissionByStatus;
    const cards = [
        { label: 'Partners', value: metrics?.partnerCount ?? 0, icon: Users2, tint: 'text-accent bg-accent/10', money: false },
        { label: 'Total Commission', value: metrics?.totalCommissionAmount ?? 0, icon: CircleDollarSign, tint: 'text-info bg-info-light', money: true },
        { label: 'Pending Payout', value: metrics?.pendingPayoutTotal ?? 0, icon: Clock, tint: 'text-amber-700 bg-amber-500/10', money: true },
        { label: 'Paid Out', value: byStatus?.Paid?.amount ?? 0, icon: CheckCircle2, tint: 'text-success bg-success-light', money: true },
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cards.map((c) => {
                const Icon = c.icon;
                return (
                    <div key={c.label} className="glass-card p-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted">{c.label}</span>
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.tint}`}>
                                <Icon className="w-4 h-4" />
                            </span>
                        </div>
                        <p className="text-lg md:text-xl font-bold text-foreground">
                            {c.money ? formatAed(c.value) : c.value}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Partners tab ────────────────────────────────────
function PartnersTab({ partners, search, setSearch }) {
    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                    type="text"
                    placeholder="Search by name, company, or BRN number..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full md:max-w-md pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm"
                />
            </div>

            {partners.length === 0 ? (
                <div className="glass-card py-12 text-center text-sm text-muted">No partners found</div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="crm-table">
                            <thead>
                                <tr><th>Partner</th><th>RERA No.</th><th>Type</th><th>Commission</th><th>Commissions</th><th>Status</th><th>Onboarded</th></tr>
                            </thead>
                            <tbody>
                                {partners.map((p) => (
                                    <tr key={p.id}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-semibold text-accent">
                                                    {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-foreground">{p.name}</p>
                                                    <p className="text-xs text-muted">{p.company || p.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="inline-flex items-center gap-1 text-foreground">
                                                <ShieldCheck className="w-3.5 h-3.5 text-success" /> {p.brnNumber}
                                            </span>
                                        </td>
                                        <td className="text-muted">{p.type}</td>
                                        <td className="text-foreground">
                                            {p.commissionType === 'Percentage'
                                                ? `${p.commissionRate}%`
                                                : p.commissionType === 'Fixed'
                                                    ? formatAed(p.fixedCommission)
                                                    : 'Slab'}
                                        </td>
                                        <td className="text-muted">{p.commissionCount}</td>
                                        <td><span className={`badge ${partnerStatusColor[p.status] || ''}`}>{p.status}</span></td>
                                        <td className="text-muted">{formatDate(p.onboardingDate)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Commissions tab ─────────────────────────────────
function CommissionsTab({ commissions, onApprove, onCreate }) {
    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button onClick={onCreate} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border hover:border-accent/40 text-foreground rounded-xl text-sm font-medium transition-all">
                    <Plus className="w-4 h-4" /> Compute Commission
                </button>
            </div>
            {commissions.length === 0 ? (
                <div className="glass-card py-12 text-center text-sm text-muted">No commissions recorded</div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="crm-table">
                            <thead>
                                <tr><th>#</th><th>Partner</th><th>Amount</th><th>%</th><th>Reference</th><th>Batch</th><th>Status</th><th></th></tr>
                            </thead>
                            <tbody>
                                {commissions.map((c) => (
                                    <tr key={c.id}>
                                        <td className="text-muted">{c.id}</td>
                                        <td className="font-medium text-foreground">{c.partnerName}</td>
                                        <td className="text-accent font-medium">{formatAed(c.amount)}</td>
                                        <td className="text-muted">{c.percentage ? `${c.percentage}%` : '—'}</td>
                                        <td className="text-muted">
                                            {c.bookingId ? `Booking #${c.bookingId}` : c.dealId ? `Deal #${c.dealId}` : '—'}
                                        </td>
                                        <td className="text-muted">{c.payoutBatchId ? `#${c.payoutBatchId}` : '—'}</td>
                                        <td><span className={`badge ${commissionStatusColor[c.status] || ''}`}>{c.status}</span></td>
                                        <td>
                                            {c.status === 'Pending' && (
                                                <button onClick={() => onApprove(c.id)} className="text-xs font-medium text-info hover:text-info/80 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Payouts tab ─────────────────────────────────────
function PayoutsTab({ batches, batchable, onCreate, onComplete }) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-muted flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-accent" />
                    {batchable.length} approved commission(s) awaiting payout
                </p>
                <button onClick={onCreate} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border hover:border-accent/40 text-foreground rounded-xl text-sm font-medium transition-all">
                    <Plus className="w-4 h-4" /> New Batch
                </button>
            </div>
            {batches.length === 0 ? (
                <div className="glass-card py-12 text-center text-sm text-muted">No payout batches yet</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {batches.map((b) => (
                        <div key={b.id} className="glass-card p-4">
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <p className="text-sm font-semibold text-foreground">{b.batchName}</p>
                                    <p className="text-xs text-muted">{formatDate(b.date)}</p>
                                </div>
                                <span className={`badge ${batchStatusColor[b.status] || ''}`}>{b.status}</span>
                            </div>
                            <div className="flex items-center gap-4 mb-3">
                                <div>
                                    <p className="text-[11px] text-muted">Total</p>
                                    <p className="text-base font-bold text-accent">{formatAed(b.totalAmount)}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted">Partners</p>
                                    <p className="text-base font-semibold text-foreground">{b.partnerCount}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted">Items</p>
                                    <p className="text-base font-semibold text-foreground">{b.commissionCount}</p>
                                </div>
                            </div>
                            {b.status !== 'Completed' && (
                                <button onClick={() => onComplete(b)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-success/10 text-success border border-success/20 hover:bg-success/20 rounded-lg text-xs font-medium transition-colors">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark Paid
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Onboard form ────────────────────────────────────
function OnboardForm({ submitting, onSubmit, onCancel }) {
    const [commissionType, setCommissionType] = useState('Percentage');
    return (
        <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Partner Name *</label>
                    <input type="text" name="name" required placeholder="Full name" className="w-full" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Company</label>
                    <input type="text" name="company" placeholder="Firm / company" className="w-full" />
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-muted mb-1.5">RERA Broker Number *</label>
                <input type="text" name="brnNumber" required placeholder="e.g. A51234567890" className="w-full" />
                <p className="text-[11px] text-muted mt-1">Required and must be unique across all partners.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Phone *</label>
                    <input type="tel" name="phone" required placeholder="+971..." className="w-full" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Email *</label>
                    <input type="email" name="email" required placeholder="partner@email.com" className="w-full" />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Type</label>
                    <select name="type" className="w-full" defaultValue="Individual">
                        {PARTNER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Status</label>
                    <select name="status" className="w-full" defaultValue="Active">
                        {PARTNER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Commission Type</label>
                    <select name="commissionType" className="w-full" value={commissionType} onChange={(e) => setCommissionType(e.target.value)}>
                        {COMMISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                {commissionType === 'Percentage' && (
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Commission Rate (%)</label>
                        <input type="number" name="commissionRate" min="0" max="100" step="0.01" placeholder="e.g. 2" className="w-full" />
                    </div>
                )}
                {commissionType === 'Fixed' && (
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Fixed Commission (AED )</label>
                        <input type="number" name="fixedCommission" min="0" step="0.01" placeholder="e.g. 50000" className="w-full" />
                    </div>
                )}
                {commissionType === 'Slab' && (
                    <div className="flex items-end">
                        <p className="text-[11px] text-muted pb-2">Slab rates are configured separately after onboarding.</p>
                    </div>
                )}
            </div>

            {/* Hidden inputs so the form always exposes these fields regardless of commission type */}
            {commissionType !== 'Percentage' && <input type="hidden" name="commissionRate" value="0" />}
            {commissionType !== 'Fixed' && <input type="hidden" name="fixedCommission" value="0" />}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Trade License No.</label>
                    <input type="text" name="tradeLicenseNo" placeholder="ABCDE1234F" className="w-full" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Agreement Doc URL</label>
                    <input type="url" name="agreementDocUrl" placeholder="https://..." className="w-full" />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">{submitting ? 'Onboarding...' : 'Onboard Partner'}</button>
            </div>
        </form>
    );
}
