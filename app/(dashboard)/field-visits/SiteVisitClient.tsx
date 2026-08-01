'use client';

/**
 * Site Visit 2.0 client UI (Req 12.2–12.6).
 *
 * Owns the interactive agent workflow:
 *   - OTP check-in: send an OTP to the buyer, then verify the entered code.
 *   - Geo check-in: capture the agent's browser location and validate it is
 *     within the project geofence (default 500m).
 *   - Structured feedback: rating, liked/disliked/concerns, duration, and a
 *     follow-up action (none / schedule lead follow-up / create deal).
 *   - Analytics: visit count, average buyer rating, average duration.
 *
 * All persistence is delegated to the `app/actions/field-visits.ts` server
 * actions; this component only collects input and renders results.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    MapPin, Fingerprint, Send, CheckCircle2, AlertTriangle, Star,
    ClipboardList, BarChart3, Loader2, Crosshair, Navigation, Plus,
    CalendarClock, Building2, Phone, UserRound,
} from 'lucide-react';
import {
    createFieldVisit,
    updateFieldVisit,
    sendCheckinOtp,
    verifyCheckinOtp,
    geoCheckin,
    submitVisitFeedback,
    getVisitAnalytics,
} from '@/app/actions/field-visits';

export interface VisitItem {
    id: number;
    displayId: string;
    customer: string;
    address: string;
    status: string;
    otpVerified: boolean;
    checkedIn: boolean;
    buyerRating: number | null;
    followUpAction: string | null;
    projectId: number | null;
    staffId: number;
    staffName: string | null;
    scheduledDate: string | null;
    scheduledTime: string | null;
    buyerPhone: string | null;
    unitIds: number[];
}

export interface StaffItem {
    id: number;
    name: string;
    role: string;
}

export interface LeadItem {
    id: number;
    name: string;
    phone: string | null;
}

export interface StageItem {
    id: number;
    name: string;
    isWon: boolean;
    isLost: boolean;
}

export interface ContactItem {
    id: number;
    name: string;
    phone: string | null;
}

export interface ProjectItem {
    id: number;
    name: string;
    location: string;
    emirate: string;
    hasCoordinates: boolean;
    units: Array<{
        id: number;
        label: string;
        type: string;
        status: string;
        totalPrice: number;
    }>;
}

type FollowUpAction = 'None' | 'FollowUp' | 'Deal';

interface Banner {
    type: 'success' | 'error';
    text: string;
}

interface Props {
    visits: VisitItem[];
    staff: StaffItem[];
    leads: LeadItem[];
    stages: StageItem[];
    contacts: ContactItem[];
    projects: ProjectItem[];
    canManage: boolean;
    initialVisitId?: number;
}

export default function SiteVisitClient({ visits, staff, leads, stages, contacts, projects, canManage, initialVisitId }: Props) {
    const router = useRouter();
    const [tab, setTab] = useState<'visits' | 'checkin' | 'analytics'>(initialVisitId ? 'checkin' : 'visits');
    const workflowVisits = visits.filter((visit) => visit.status === 'Scheduled' || visit.status === 'In Progress');

    return (
        <div className="space-y-5">
            {/* Tabs */}
            <div className="flex flex-wrap gap-1">
                <TabButton active={tab === 'visits'} onClick={() => setTab('visits')} icon={CalendarClock} label="Visits & Scheduling" />
                <TabButton active={tab === 'checkin'} onClick={() => setTab('checkin')} icon={MapPin} label="Check-In & Feedback" />
                <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={BarChart3} label="Analytics" />
            </div>

            {tab === 'visits' ? (
                <VisitsPanel
                    visits={visits}
                    staff={staff}
                    contacts={contacts}
                    projects={projects}
                    canManage={canManage}
                    onChanged={() => router.refresh()}
                />
            ) : tab === 'checkin' ? (
                <CheckinPanel
                    visits={workflowVisits}
                    leads={leads}
                    stages={stages}
                    contacts={contacts}
                    staff={staff}
                    initialVisitId={initialVisitId}
                    onChanged={() => router.refresh()}
                />
            ) : (
                <AnalyticsPanel staff={staff} />
            )}
        </div>
    );
}

function VisitsPanel({
    visits, staff, contacts, projects, canManage, onChanged,
}: {
    visits: VisitItem[];
    staff: StaffItem[];
    contacts: ContactItem[];
    projects: ProjectItem[];
    canManage: boolean;
    onChanged: () => void;
}) {
    const [showCreate, setShowCreate] = useState(false);
    const [staffId, setStaffId] = useState<number | ''>('');
    const [contactId, setContactId] = useState<number | ''>('');
    const [customer, setCustomer] = useState('');
    const [buyerPhone, setBuyerPhone] = useState('');
    const [projectId, setProjectId] = useState<number | ''>('');
    const [unitIds, setUnitIds] = useState<number[]>([]);
    const [address, setAddress] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState<Banner | null>(null);

    const selectedProject = projects.find((project) => project.id === projectId) ?? null;
    const statusCounts = visits.reduce<Record<string, number>>((counts, visit) => {
        counts[visit.status] = (counts[visit.status] ?? 0) + 1;
        return counts;
    }, {});

    function selectContact(value: string) {
        const id = value ? Number(value) : '';
        setContactId(id);
        const contact = contacts.find((item) => item.id === id);
        if (contact) {
            setCustomer(contact.name);
            setBuyerPhone(contact.phone ?? '');
        }
    }

    function selectProject(value: string) {
        const id = value ? Number(value) : '';
        setProjectId(id);
        setUnitIds([]);
        const project = projects.find((item) => item.id === id);
        setAddress(project ? `${project.name}, ${project.location}, ${project.emirate}` : '');
    }

    function toggleUnit(unitId: number) {
        setUnitIds((current) => current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId]);
    }

    async function handleCreate() {
        setBusy(true);
        setBanner(null);
        if (!scheduledAt) {
            setBanner({ type: 'error', text: 'Select the Dubai visit date and time.' });
            setBusy(false);
            return;
        }
        const res = await createFieldVisit({
            staffId: staffId === '' ? undefined : staffId,
            customer,
            buyerPhone,
            projectId: projectId === '' ? undefined : projectId,
            unitIds,
            address,
            scheduledAt: new Date(`${scheduledAt}:00+04:00`).toISOString(),
            type: 'Property Viewing',
            notes,
        });
        if (res.success && res.data) {
            setBanner({ type: 'success', text: `Visit ${res.data.displayId} scheduled successfully.` });
            setStaffId('');
            setContactId('');
            setCustomer('');
            setBuyerPhone('');
            setProjectId('');
            setUnitIds([]);
            setAddress('');
            setScheduledAt('');
            setNotes('');
            onChanged();
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Could not schedule visit' });
        }
        setBusy(false);
    }

    async function handleStatus(visit: VisitItem, status: 'Cancelled' | 'No Show') {
        if (!window.confirm(`Mark ${visit.displayId} as ${status}?`)) return;
        setBanner(null);
        const res = await updateFieldVisit({ visitId: visit.id, status });
        if (res.success) {
            setBanner({ type: 'success', text: `${visit.displayId} marked as ${status}.` });
            onChanged();
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Could not update visit' });
        }
    }

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                    { label: 'Scheduled', value: statusCounts.Scheduled ?? 0 },
                    { label: 'In Progress', value: statusCounts['In Progress'] ?? 0 },
                    { label: 'Completed', value: statusCounts.Completed ?? 0 },
                    { label: 'Cancelled / No Show', value: (statusCounts.Cancelled ?? 0) + (statusCounts['No Show'] ?? 0) },
                ].map(({ label, value }) => (
                    <div key={label} className="glass-card p-4">
                        <p className="text-xs text-muted">{label}</p>
                        <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
                    </div>
                ))}
            </div>

            <div className="glass-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">Visit Schedule</h3>
                        <p className="mt-1 text-xs text-muted">Assign an agent, buyer, project and inventory before check-in.</p>
                    </div>
                    {canManage && (
                        <button onClick={() => setShowCreate((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white">
                            <Plus className="h-4 w-4" /> {showCreate ? 'Close form' : 'Schedule visit'}
                        </button>
                    )}
                </div>

                {showCreate && (
                    <div className="mt-5 space-y-4 border-t border-border pt-5">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <Field label="Assigned agent">
                                <select value={staffId} onChange={(event) => setStaffId(event.target.value ? Number(event.target.value) : '')} className="feedback-input">
                                    <option value="">Select an agent…</option>
                                    {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                                </select>
                            </Field>
                            <Field label="Buyer / contact">
                                <select value={contactId} onChange={(event) => selectContact(event.target.value)} className="feedback-input">
                                    <option value="">Select a contact…</option>
                                    {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.phone ? ` — ${contact.phone}` : ''}</option>)}
                                </select>
                            </Field>
                            <Field label="Buyer name">
                                <input value={customer} onChange={(event) => setCustomer(event.target.value)} className="feedback-input" />
                            </Field>
                            <Field label="Buyer UAE phone">
                                <input type="tel" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} placeholder="+971 50 123 4567" className="feedback-input" />
                            </Field>
                            <Field label="Project">
                                <select value={projectId} onChange={(event) => selectProject(event.target.value)} className="feedback-input">
                                    <option value="">Select a project…</option>
                                    {projects.map((project) => (
                                        <option key={project.id} value={project.id} disabled={!project.hasCoordinates}>
                                            {project.name} — {project.location}{project.hasCoordinates ? '' : ' (add map coordinates)'}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Dubai visit date & time">
                                <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="feedback-input" />
                            </Field>
                        </div>

                        {selectedProject && selectedProject.units.length > 0 && (
                            <div>
                                <p className="mb-2 text-xs font-medium text-muted">Units to show (optional, maximum 20)</p>
                                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                                    {selectedProject.units.map((unit) => (
                                        <label key={unit.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-surface-hover">
                                            <input type="checkbox" checked={unitIds.includes(unit.id)} onChange={() => toggleUnit(unit.id)} className="mt-0.5" />
                                            <span className="min-w-0 text-xs text-foreground">
                                                <span className="block truncate">{unit.label}</span>
                                                <span className="text-muted">{unit.type} · {unit.status} · AED {unit.totalPrice.toLocaleString('en-AE')}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Field label="Meeting point / project address">
                            <input value={address} onChange={(event) => setAddress(event.target.value)} className="feedback-input" />
                        </Field>
                        <Field label="Internal preparation notes">
                            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="feedback-input" />
                        </Field>
                        <BannerView banner={banner} />
                        <button onClick={handleCreate} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Schedule site visit
                        </button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="xl:col-span-2"><BannerView banner={!showCreate ? banner : null} /></div>
                {visits.map((visit) => (
                    <article key={visit.id} className="glass-card p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-semibold text-foreground">{visit.displayId} · {visit.customer}</p>
                                <p className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin className="h-3.5 w-3.5" /> {visit.address}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">{visit.status}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted sm:grid-cols-3">
                            <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {visit.scheduledDate ? new Date(visit.scheduledDate).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled'}</span>
                            <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {visit.staffName ?? 'Unassigned'}</span>
                            <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {visit.buyerPhone ?? 'No phone'}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <StatusPill ok={visit.otpVerified} label={visit.otpVerified ? 'OTP verified' : 'OTP pending'} />
                            <StatusPill ok={visit.checkedIn} label={visit.checkedIn ? 'Geo checked-in' : 'Geo pending'} />
                            {visit.unitIds.length > 0 && <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted">{visit.unitIds.length} unit{visit.unitIds.length === 1 ? '' : 's'}</span>}
                        </div>
                        {canManage && visit.status === 'Scheduled' && (
                            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                                <button onClick={() => handleStatus(visit, 'No Show')} className="rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-500/10">Mark no-show</button>
                                <button onClick={() => handleStatus(visit, 'Cancelled')} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-500/10">Cancel visit</button>
                            </div>
                        )}
                    </article>
                ))}
                {visits.length === 0 && <div className="glass-card p-10 text-center text-sm text-muted xl:col-span-2">No site visits have been scheduled yet.</div>}
            </div>
        </div>
    );
}

function TabButton({
    active, onClick, icon: Icon, label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof MapPin;
    label: string;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${active ? 'bg-accent text-white' : 'text-muted hover:text-foreground hover:bg-surface-hover border border-border'
                }`}
        >
            <Icon className="w-3.5 h-3.5" /> {label}
        </button>
    );
}

// ─────────────────────────────────────────────────────────
// CHECK-IN & FEEDBACK
// ─────────────────────────────────────────────────────────

function CheckinPanel({
    visits, leads, stages, contacts, staff, initialVisitId, onChanged,
}: {
    visits: VisitItem[];
    leads: LeadItem[];
    stages: StageItem[];
    contacts: ContactItem[];
    staff: StaffItem[];
    initialVisitId?: number;
    onChanged: () => void;
}) {
    const [selectedId, setSelectedId] = useState<number | ''>(
        visits.some((visit) => visit.id === initialVisitId) ? initialVisitId! : visits[0]?.id ?? '',
    );
    const visit = useMemo(() => visits.find((v) => v.id === selectedId) ?? null, [visits, selectedId]);

    // Local optimistic flags so the UI advances through the steps without a full
    // reload; the server remains the source of truth on refresh.
    const [otpVerified, setOtpVerified] = useState(false);
    const [checkedIn, setCheckedIn] = useState(false);

    const effectiveOtpVerified = otpVerified || Boolean(visit?.otpVerified);
    const effectiveCheckedIn = checkedIn || Boolean(visit?.checkedIn);

    function handleSelect(id: number | '') {
        setSelectedId(id);
        setOtpVerified(false);
        setCheckedIn(false);
    }

    if (visits.length === 0) {
        return (
            <div className="glass-card py-16 text-center text-muted">
                <p className="font-medium">No site visits found</p>
                <p className="mt-1 text-sm">Create a field visit first, then return here to check in.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Visit selector + summary */}
            <div className="glass-card p-5 space-y-4">
                <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Select Visit</label>
                    <select
                        value={selectedId}
                        onChange={(e) => handleSelect(e.target.value ? Number(e.target.value) : '')}
                        className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                    >
                        {visits.map((v) => (
                            <option key={v.id} value={v.id}>
                                {v.displayId} — {v.customer} ({v.status})
                            </option>
                        ))}
                    </select>
                </div>

                {visit && (
                    <div className="space-y-2 text-sm">
                        <div className="flex items-start gap-2 text-muted">
                            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent" />
                            <span>{visit.address}</span>
                        </div>
                        <p className="text-xs text-muted">Agent: <span className="text-foreground">{visit.staffName ?? '—'}</span></p>
                        <div className="flex flex-wrap gap-2 pt-1">
                            <StatusPill ok={effectiveOtpVerified} label={effectiveOtpVerified ? 'OTP Verified' : 'OTP Pending'} />
                            <StatusPill ok={effectiveCheckedIn} label={effectiveCheckedIn ? 'Checked In' : 'Not Checked In'} />
                        </div>
                    </div>
                )}
            </div>

            {/* Steps */}
            <div className="lg:col-span-2 space-y-5">
                {visit && (
                    <>
                        <OtpStep key={`otp-${visit.id}`} visit={visit} onVerified={() => { setOtpVerified(true); onChanged(); }} verified={effectiveOtpVerified} />
                        <GeoStep key={`geo-${visit.id}`} visit={visit} enabled={effectiveOtpVerified} checkedIn={effectiveCheckedIn} onCheckedIn={() => { setCheckedIn(true); onChanged(); }} />
                        <FeedbackStep
                            key={`feedback-${visit.id}`}
                            visit={visit}
                            enabled={effectiveCheckedIn}
                            leads={leads}
                            stages={stages}
                            contacts={contacts}
                            staff={staff}
                            onSubmitted={onChanged}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'
                }`}
        >
            {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} {label}
        </span>
    );
}

function StepCard({ title, icon: Icon, children, disabled }: {
    title: string;
    icon: typeof MapPin;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        <div className={`glass-card p-5 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                <Icon className="w-4 h-4 text-accent" /> {title}
            </h3>
            {children}
        </div>
    );
}

function BannerView({ banner }: { banner: Banner | null }) {
    if (!banner) return null;
    return (
        <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${banner.type === 'success' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-red-500/10 text-red-700'
                }`}
        >
            {banner.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {banner.text}
        </div>
    );
}

// ── Step 1: OTP ──────────────────────────────────────────

function OtpStep({ visit, verified, onVerified }: { visit: VisitItem; verified: boolean; onVerified: () => void }) {
    const [phone, setPhone] = useState(visit.buyerPhone ?? '');
    const [otp, setOtp] = useState('');
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [sent, setSent] = useState(false);
    const [banner, setBanner] = useState<Banner | null>(null);

    async function handleSend() {
        setSending(true);
        setBanner(null);
        const res = await sendCheckinOtp({ visitId: visit.id, buyerPhone: phone });
        if (res.success) {
            setSent(true);
            const channel = (res.data as { channel?: string } | undefined)?.channel;
            setBanner({ type: 'success', text: `OTP sent${channel ? ` via ${channel}` : ''}.` });
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Could not send OTP' });
        }
        setSending(false);
    }

    async function handleVerify() {
        setVerifying(true);
        setBanner(null);
        const res = await verifyCheckinOtp({ visitId: visit.id, enteredOtp: otp });
        if (res.success) {
            setBanner({ type: 'success', text: 'OTP verified.' });
            onVerified();
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Incorrect OTP' });
        }
        setVerifying(false);
    }

    return (
        <StepCard title="1 · OTP Check-In" icon={Fingerprint}>
            {verified ? (
                <p className="text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Buyer OTP has been verified for this visit.
                </p>
            ) : (
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="tel"
                            placeholder="Buyer phone (e.g. +971 50 123 4567)"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="flex-1 px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground"
                        />
                        <button
                            onClick={handleSend}
                            disabled={sending || phone.trim().length < 8}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                        >
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {sent ? 'Resend' : 'Send OTP'}
                        </button>
                    </div>

                    {sent && (
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                inputMode="numeric"
                                placeholder="Enter OTP from buyer"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value)}
                                className="flex-1 px-3 py-2.5 bg-surface rounded-xl border border-border text-sm text-foreground tracking-widest"
                            />
                            <button
                                onClick={handleVerify}
                                disabled={verifying || otp.trim().length < 4}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                            >
                                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                Verify
                            </button>
                        </div>
                    )}

                    <BannerView banner={banner} />
                </div>
            )}
        </StepCard>
    );
}

// ── Step 2: Geo check-in ─────────────────────────────────

function GeoStep({
    visit, enabled, checkedIn, onCheckedIn,
}: {
    visit: VisitItem;
    enabled: boolean;
    checkedIn: boolean;
    onCheckedIn: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [coords, setCoords] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);

    function getPosition(): Promise<{ lat: number; lng: number; accuracyM: number }> {
        return new Promise((resolve, reject) => {
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                reject(new Error('Geolocation is not supported on this device'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
                (err) => reject(err),
                { enableHighAccuracy: true, timeout: 10000 },
            );
        });
    }

    async function handleCheckin() {
        setBusy(true);
        setBanner(null);
        try {
            const pos = await getPosition();
            setCoords(pos);
            const input: {
                visitId: number;
                agentLat: number;
                agentLng: number;
                accuracyM: number;
            } = { visitId: visit.id, agentLat: pos.lat, agentLng: pos.lng, accuracyM: pos.accuracyM };
            const res = await geoCheckin(input);
            if (res.success) {
                const dist = (res.data as { distanceM?: number } | undefined)?.distanceM;
                setBanner({ type: 'success', text: `Checked in${dist != null ? ` · ${Math.round(dist)}m from project` : ''}.` });
                onCheckedIn();
            } else {
                setBanner({ type: 'error', text: res.error ?? 'Geo check-in failed' });
            }
        } catch {
            setBanner({ type: 'error', text: 'Location access denied. Enable GPS and try again.' });
        } finally {
            setBusy(false);
        }
    }

    return (
        <StepCard title="2 · Geo Check-In" icon={Navigation} disabled={!enabled && !checkedIn}>
            {checkedIn ? (
                <p className="text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Geo check-in recorded for this visit.
                </p>
            ) : (
                <div className="space-y-3">
                    <p className="text-xs text-muted">
                        Your browser location is validated against the project geofence (within 500m).
                    </p>

                    {visit.projectId == null && (
                        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                            This legacy visit has no linked project. A manager must schedule a new project-linked visit before geo check-in.
                        </div>
                    )}

                    <button
                        onClick={handleCheckin}
                        disabled={busy || visit.projectId == null}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
                        Capture Location & Check In
                    </button>

                    {coords && (
                        <p className="text-[11px] text-muted">
                            Captured: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} · accuracy ±{Math.round(coords.accuracyM)}m
                        </p>
                    )}

                    <BannerView banner={banner} />
                </div>
            )}
        </StepCard>
    );
}

// ── Step 3: Structured feedback ──────────────────────────

function FeedbackStep({
    visit, enabled, leads, stages, contacts, staff, onSubmitted,
}: {
    visit: VisitItem;
    enabled: boolean;
    leads: LeadItem[];
    stages: StageItem[];
    contacts: ContactItem[];
    staff: StaffItem[];
    onSubmitted: () => void;
}) {
    const [rating, setRating] = useState<number>(0);
    const [liked, setLiked] = useState('');
    const [disliked, setDisliked] = useState('');
    const [concerns, setConcerns] = useState('');
    const [duration, setDuration] = useState('');
    const [action, setAction] = useState<FollowUpAction>('None');

    // Follow-up (lead) fields
    const [leadId, setLeadId] = useState<number | ''>('');
    const [followUpMessage, setFollowUpMessage] = useState('');
    const [followUpDate, setFollowUpDate] = useState('');

    // Deal fields
    const [contactId, setContactId] = useState<number | ''>('');
    const [stageId, setStageId] = useState<number | ''>('');
    const [dealValue, setDealValue] = useState('');
    const [assignedAgentId, setAssignedAgentId] = useState<number | ''>(visit.staffId);

    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [done, setDone] = useState(false);

    const sellableStages = useMemo(() => stages.filter((s) => !s.isLost), [stages]);

    async function handleSubmit() {
        setBusy(true);
        setBanner(null);

        const base: Record<string, unknown> = {
            visitId: visit.id,
            followUpAction: action,
        };
        if (rating > 0) base.buyerRating = rating;
        if (liked.trim()) base.feedbackLiked = liked.trim();
        if (disliked.trim()) base.feedbackDisliked = disliked.trim();
        if (concerns.trim()) base.feedbackConcerns = concerns.trim();
        if (duration.trim()) base.visitDurationMin = Number(duration);

        if (action === 'FollowUp') {
            base.leadId = leadId === '' ? undefined : leadId;
            base.followUpMessage = followUpMessage.trim();
            if (followUpDate) base.followUpDate = new Date(followUpDate).toISOString();
        } else if (action === 'Deal') {
            base.contactId = contactId === '' ? undefined : contactId;
            base.stageId = stageId === '' ? undefined : stageId;
            base.dealValue = dealValue.trim() ? Number(dealValue) : undefined;
            base.assignedAgentId = assignedAgentId === '' ? undefined : assignedAgentId;
        }

        const res = await submitVisitFeedback(base);
        if (res.success) {
            setBanner({ type: 'success', text: 'Feedback saved and visit completed.' });
            setDone(true);
            onSubmitted();
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Could not submit feedback' });
        }
        setBusy(false);
    }

    return (
        <StepCard title="3 · Visit Feedback" icon={ClipboardList} disabled={!enabled}>
            {done ? (
                <p className="text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Feedback recorded for {visit.displayId}.
                </p>
            ) : (
                <div className="space-y-4">
                    {/* Rating */}
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Buyer Rating</label>
                        <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={() => setRating(n === rating ? 0 : n)}
                                    className="p-0.5"
                                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                                >
                                    <Star className={`w-6 h-6 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-border'}`} />
                                </button>
                            ))}
                            {rating > 0 && <span className="ml-2 text-xs text-muted">{rating}/5</span>}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="What the buyer liked">
                            <textarea value={liked} onChange={(e) => setLiked(e.target.value)} rows={2} className="feedback-input" />
                        </Field>
                        <Field label="What the buyer disliked">
                            <textarea value={disliked} onChange={(e) => setDisliked(e.target.value)} rows={2} className="feedback-input" />
                        </Field>
                        <Field label="Concerns / objections">
                            <textarea value={concerns} onChange={(e) => setConcerns(e.target.value)} rows={2} className="feedback-input" />
                        </Field>
                        <Field label="Visit duration (minutes)">
                            <input
                                type="number"
                                min={0}
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="feedback-input"
                            />
                        </Field>
                    </div>

                    {/* Follow-up action */}
                    <div>
                        <label className="block text-xs font-medium text-muted mb-1.5">Follow-Up Action</label>
                        <div className="flex flex-wrap gap-2">
                            {(['None', 'FollowUp', 'Deal'] as FollowUpAction[]).map((a) => (
                                <button
                                    key={a}
                                    type="button"
                                    onClick={() => setAction(a)}
                                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-all border ${action === a ? 'bg-accent text-white border-accent' : 'border-border text-muted hover:text-foreground hover:bg-surface-hover'
                                        }`}
                                >
                                    {a === 'None' ? 'No follow-up' : a === 'FollowUp' ? 'Schedule follow-up' : 'Create deal'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {action === 'FollowUp' && (
                        <div className="space-y-3 rounded-xl border border-border p-3">
                            <Field label="Lead">
                                <select
                                    value={leadId}
                                    onChange={(e) => setLeadId(e.target.value ? Number(e.target.value) : '')}
                                    className="feedback-input"
                                >
                                    <option value="">Select a lead…</option>
                                    {leads.map((l) => (
                                        <option key={l.id} value={l.id}>{l.name}{l.phone ? ` — ${l.phone}` : ''}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Follow-up message">
                                <textarea value={followUpMessage} onChange={(e) => setFollowUpMessage(e.target.value)} rows={2} className="feedback-input" />
                            </Field>
                            <Field label="Follow-up date (optional)">
                                <input type="datetime-local" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="feedback-input" />
                            </Field>
                        </div>
                    )}

                    {action === 'Deal' && (
                        <div className="space-y-3 rounded-xl border border-border p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Field label="Contact">
                                    <select
                                        value={contactId}
                                        onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : '')}
                                        className="feedback-input"
                                    >
                                        <option value="">Select a contact…</option>
                                        {contacts.map((c) => (
                                            <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Pipeline stage">
                                    <select
                                        value={stageId}
                                        onChange={(e) => setStageId(e.target.value ? Number(e.target.value) : '')}
                                        className="feedback-input"
                                    >
                                        <option value="">Select a stage…</option>
                                        {sellableStages.map((s) => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Deal value (AED )">
                                    <input type="number" min={0} value={dealValue} onChange={(e) => setDealValue(e.target.value)} className="feedback-input" />
                                </Field>
                                <Field label="Assigned agent">
                                    <select
                                        value={assignedAgentId}
                                        onChange={(e) => setAssignedAgentId(e.target.value ? Number(e.target.value) : '')}
                                        className="feedback-input"
                                    >
                                        <option value="">Unassigned</option>
                                        {staff.map((s) => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </Field>
                            </div>
                        </div>
                    )}

                    <BannerView banner={banner} />

                    <button
                        onClick={handleSubmit}
                        disabled={busy}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Submit Feedback
                    </button>
                </div>
            )}
        </StepCard>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
            {children}
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────

interface AnalyticsResult {
    visitCount: number;
    averageRating: number | null;
    averageDuration: number | null;
}

function AnalyticsPanel({ staff }: { staff: StaffItem[] }) {
    const [staffId, setStaffId] = useState<number | ''>('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [result, setResult] = useState<AnalyticsResult | null>(null);

    async function handleLoad() {
        setBusy(true);
        setBanner(null);
        const input: {
            staffId?: number;
            startDate?: string;
            endDate?: string;
        } = {};
        if (staffId !== '') input.staffId = staffId;
        if (startDate) input.startDate = new Date(startDate).toISOString();
        if (endDate) input.endDate = new Date(endDate).toISOString();

        const res = await getVisitAnalytics(input);
        if (res.success) {
            setResult(res.data as AnalyticsResult);
        } else {
            setBanner({ type: 'error', text: res.error ?? 'Could not load analytics' });
            setResult(null);
        }
        setBusy(false);
    }

    return (
        <div className="space-y-5">
            <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4 text-accent" /> Visit Analytics
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <Field label="Agent">
                        <select
                            value={staffId}
                            onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : '')}
                            className="feedback-input"
                        >
                            <option value="">All agents</option>
                            {staff.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="From">
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="feedback-input" />
                    </Field>
                    <Field label="To">
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="feedback-input" />
                    </Field>
                    <button
                        onClick={handleLoad}
                        disabled={busy}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                        Load
                    </button>
                </div>
                <div className="mt-3">
                    <BannerView banner={banner} />
                </div>
            </div>

            {result && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <MetricCard label="Total Visits" value={String(result.visitCount)} icon={MapPin} tone="text-info" bg="bg-info-light" />
                    <MetricCard
                        label="Avg Buyer Rating"
                        value={result.averageRating != null ? `${result.averageRating.toFixed(1)} / 5` : '—'}
                        icon={Star}
                        tone="text-amber-700"
                        bg="bg-amber-500/10"
                    />
                    <MetricCard
                        label="Avg Duration"
                        value={result.averageDuration != null ? `${Math.round(result.averageDuration)} min` : '—'}
                        icon={ClipboardList}
                        tone="text-success"
                        bg="bg-success-light"
                    />
                </div>
            )}
        </div>
    );
}

function MetricCard({ label, value, icon: Icon, tone, bg }: {
    label: string;
    value: string;
    icon: typeof MapPin;
    tone: string;
    bg: string;
}) {
    return (
        <div className="glass-card p-4 flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${bg}`}><Icon className={`w-5 h-5 ${tone}`} /></div>
            <div>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-lg font-bold text-foreground">{value}</p>
            </div>
        </div>
    );
}
