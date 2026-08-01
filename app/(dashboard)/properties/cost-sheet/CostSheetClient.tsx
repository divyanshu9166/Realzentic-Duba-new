'use client';

/**
 * Cost Sheet & Payment Plan builder client (Req 3.1, 3.10, 3.11).
 *
 * Owns the interactive surfaces of the cost-sheet module:
 *   - Builder: pick a project → unit → buyer, enter add-on charges and a
 *     discount, and call `buildCostSheet`. The unit-derived figures (base
 *     cost, floor rise, view premium, total) are auto-populated by the server
 *     (Req 3.1); the resulting itemized breakdown is rendered below the form.
 *   - PDF: `generateCostSheetPdf` produces a branded PDF whose URL is shown
 *     with a live preview and download link (Req 3.9).
 *   - Share: `shareCostSheet` dispatches the PDF over WhatsApp / Email / Both
 *     and surfaces the per-channel delivery status (Req 3.10).
 *   - Payment-plan editor: define a named plan with milestone rows
 *     (name / due-offset-days / %), validated to sum to 100, saved via
 *     `upsertPaymentPlan` with an at-most-one-default flag (Req 3.11).
 *
 * Requirements: 3.1, 3.10, 3.11
 */

import { useState, useTransition } from 'react';
import {
    Building2,
    Home,
    User,
    FileText,
    Receipt,
    Share2,
    Plus,
    Trash2,
    Loader2,
    CheckCircle2,
    XCircle,
    MinusCircle,
    Download,
    Wallet,
} from 'lucide-react';
import {
    buildCostSheet,
    generateCostSheetPdf,
    shareCostSheet,
    upsertPaymentPlan,
    getProjectDetail,
    type ShareResult,
    type ShareDeliveryStatus,
} from '@/app/actions/properties';
import { formatCurrency } from '@/lib/currency';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectOption {
    id: number;
    name: string;
    city: string;
}

export interface ContactOption {
    id: number;
    name: string;
    phone: string | null;
}

interface UnitOption {
    id: number;
    unitNumber: string;
    floorNumber: number;
    type: string;
    status: string;
    totalPrice: number | null;
}

/** Serialized cost sheet returned by `buildCostSheet` (money fields as numbers). */
interface BuiltCostSheet {
    id: number;
    baseCost: number | null;
    floorRise: number | null;
    viewPremium: number | null;
    parkingCharges: number | null;
    clubhouseCharges: number | null;
    legalCharges: number | null;
    dldTransferFee: number | null;
    vatAmount: number | null;
    registrationCharges: number | null;
    total: number | null;
    discount: number | null;
    netPayable: number | null;
    pdfUrl: string | null;
}

interface Milestone {
    name: string;
    dueOffsetDays: number;
    percentage: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(n: number | null | undefined): string {
    return formatCurrency(n ?? 0);
}

/** Parse a free-text money input into a non-negative number (0 when blank). */
function toMoney(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ─── Reusable inputs ───────────────────────────────────────────────────────────

function MoneyField({
    label,
    value,
    onChange,
    placeholder = '0.00',
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{label}</span>
            <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                className="px-3 py-2 bg-surface rounded-lg border border-border text-sm w-full"
            />
        </label>
    );
}

/** Color-coded share-channel status pill. */
function DeliveryPill({ channel, status }: { channel: string; status: ShareDeliveryStatus }) {
    const map: Record<ShareDeliveryStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
        Sent: { cls: 'bg-emerald-500/10 text-emerald-700', Icon: CheckCircle2 },
        Failed: { cls: 'bg-red-500/10 text-red-700', Icon: XCircle },
        Skipped: { cls: 'bg-surface-hover text-muted', Icon: MinusCircle },
    };
    const { cls, Icon } = map[status];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${cls}`}>
            <Icon className="w-3.5 h-3.5" />
            {channel}: {status}
        </span>
    );
}

// ─── Itemized breakdown ────────────────────────────────────────────────────────

function CostBreakdown({ sheet }: { sheet: BuiltCostSheet }) {
    const rows: Array<{ label: string; value: number | null; muted?: boolean }> = [
        { label: 'Base cost', value: sheet.baseCost },
        { label: 'Floor rise', value: sheet.floorRise },
        { label: 'View premium', value: sheet.viewPremium },
        { label: 'Parking charges', value: sheet.parkingCharges },
        { label: 'Clubhouse charges', value: sheet.clubhouseCharges },
        { label: 'Legal charges', value: sheet.legalCharges },
        { label: 'DLD transfer fee', value: sheet.dldTransferFee },
        { label: 'VAT', value: sheet.vatAmount },
        { label: 'Registration charges', value: sheet.registrationCharges },
    ];

    return (
        <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.label} className="border-b border-border/60">
                            <td className="px-4 py-2 text-muted">{r.label}</td>
                            <td className="px-4 py-2 text-right font-medium text-foreground tabular-nums">
                                {formatMoney(r.value)}
                            </td>
                        </tr>
                    ))}
                    <tr className="border-b border-border/60 bg-surface-light/50">
                        <td className="px-4 py-2 font-semibold text-foreground">Unit total</td>
                        <td className="px-4 py-2 text-right font-semibold text-foreground tabular-nums">
                            {formatMoney(sheet.total)}
                        </td>
                    </tr>
                    <tr className="border-b border-border/60">
                        <td className="px-4 py-2 text-muted">Discount</td>
                        <td className="px-4 py-2 text-right font-medium text-danger tabular-nums">
                            − {formatMoney(sheet.discount)}
                        </td>
                    </tr>
                    <tr className="bg-accent/5">
                        <td className="px-4 py-3 font-bold text-foreground">Net payable</td>
                        <td className="px-4 py-3 text-right font-bold text-accent text-base tabular-nums">
                            {formatMoney(sheet.netPayable)}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

// ─── Cost-sheet builder ─────────────────────────────────────────────────────────

function CostSheetBuilder({
    projects,
    contacts,
}: {
    projects: ProjectOption[];
    contacts: ContactOption[];
}) {
    const [projectId, setProjectId] = useState<number | ''>('');
    const [units, setUnits] = useState<UnitOption[]>([]);
    const [unitsLoading, setUnitsLoading] = useState(false);
    const [unitId, setUnitId] = useState<number | ''>('');
    const [contactId, setContactId] = useState<number | ''>('');

    // Add-on charges (free-text → coerced to money on submit).
    const [parking, setParking] = useState('');
    const [clubhouse, setClubhouse] = useState('');
    const [legal, setLegal] = useState('');
    const [registration, setRegistration] = useState('');
    const [dldTransferFee, setDldTransferFee] = useState('');
    const [vatAmount, setVatAmount] = useState('');
    const [discount, setDiscount] = useState('');

    const [sheet, setSheet] = useState<BuiltCostSheet | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [building, startBuild] = useTransition();

    // PDF + share state.
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfBusy, setPdfBusy] = useState(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [shareBusy, setShareBusy] = useState<null | 'WhatsApp' | 'Email' | 'Both'>(null);
    const [shareResult, setShareResult] = useState<ShareResult | null>(null);
    const [shareError, setShareError] = useState<string | null>(null);

    async function loadUnits(pid: number) {
        setUnitsLoading(true);
        setUnits([]);
        setUnitId('');
        try {
            const res = await getProjectDetail(pid);
            if (res.success) {
                const detail = res.data as {
                    towers: Array<{ units: UnitOption[] }>;
                };
                const all = detail.towers.flatMap((t) =>
                    t.units.map((u) => ({
                        id: u.id,
                        unitNumber: u.unitNumber,
                        floorNumber: u.floorNumber,
                        type: u.type,
                        status: u.status,
                        totalPrice: u.totalPrice,
                    })),
                );
                setUnits(all);
            }
        } catch {
            // Leave units empty; the selector shows the empty option.
        }
        setUnitsLoading(false);
    }

    function handleProjectChange(value: string) {
        const pid = value === '' ? '' : Number(value);
        setProjectId(pid);
        resetResult();
        if (pid !== '') void loadUnits(pid);
        else setUnits([]);
    }

    function resetResult() {
        setSheet(null);
        setError(null);
        setPdfUrl(null);
        setPdfError(null);
        setShareResult(null);
        setShareError(null);
    }

    function handleBuild() {
        setError(null);
        if (unitId === '' || contactId === '') {
            setError('Select a unit and a buyer before building the cost sheet.');
            return;
        }

        const addons = {
            parkingCharges: toMoney(parking),
            clubhouseCharges: toMoney(clubhouse),
            legalCharges: toMoney(legal),
            registrationCharges: toMoney(registration),
            // Only send overrides when provided; blank → let the server compute.
            ...(dldTransferFee.trim() !== '' ? { dldTransferFee: toMoney(dldTransferFee) } : {}),
            ...(vatAmount.trim() !== '' ? { vatAmount: toMoney(vatAmount) } : {}),
        };

        startBuild(async () => {
            const res = await buildCostSheet(unitId, contactId, addons, toMoney(discount));
            if (res.success) {
                const built = res.data as BuiltCostSheet;
                setSheet(built);
                setPdfUrl(built.pdfUrl ?? null);
                setShareResult(null);
                setShareError(null);
            } else {
                setSheet(null);
                setError(res.error);
            }
        });
    }

    async function handleGeneratePdf() {
        if (!sheet) return;
        setPdfBusy(true);
        setPdfError(null);
        try {
            const res = await generateCostSheetPdf(sheet.id);
            if (res.success) setPdfUrl(res.data.pdfUrl);
            else setPdfError(res.error);
        } catch {
            setPdfError('Failed to generate PDF. Please try again.');
        }
        setPdfBusy(false);
    }

    async function handleShare(channel: 'WhatsApp' | 'Email' | 'Both') {
        if (!sheet) return;
        setShareBusy(channel);
        setShareError(null);
        setShareResult(null);
        try {
            const res = await shareCostSheet(sheet.id, { channel });
            if (res.success) setShareResult(res.data);
            else setShareError(res.error);
        } catch {
            setShareError('Failed to share cost sheet. Please try again.');
        }
        setShareBusy(null);
    }

    const selectedContact = contacts.find((c) => c.id === contactId);

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* ── Selection + add-ons form ── */}
                <div className="glass-card p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-accent" /> Build cost sheet
                    </h2>

                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted flex items-center gap-1">
                            <Building2 className="w-3 h-3" /> Project
                        </span>
                        <select
                            value={projectId}
                            onChange={(e) => handleProjectChange(e.target.value)}
                            className="px-3 py-2 bg-surface rounded-lg border border-border text-sm"
                        >
                            <option value="">Select a project…</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} — {p.city}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted flex items-center gap-1">
                            <Home className="w-3 h-3" /> Unit
                        </span>
                        <select
                            value={unitId}
                            disabled={projectId === '' || unitsLoading}
                            onChange={(e) => {
                                setUnitId(e.target.value === '' ? '' : Number(e.target.value));
                                resetResult();
                            }}
                            className="px-3 py-2 bg-surface rounded-lg border border-border text-sm disabled:opacity-50"
                        >
                            <option value="">
                                {unitsLoading
                                    ? 'Loading units…'
                                    : projectId === ''
                                        ? 'Select a project first'
                                        : units.length === 0
                                            ? 'No units in this project'
                                            : 'Select a unit…'}
                            </option>
                            {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.unitNumber} · Floor {u.floorNumber} · {u.type} · {u.status}
                                    {u.totalPrice != null ? ` · ${formatMoney(u.totalPrice)}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted flex items-center gap-1">
                            <User className="w-3 h-3" /> Buyer
                        </span>
                        <select
                            value={contactId}
                            onChange={(e) => {
                                setContactId(e.target.value === '' ? '' : Number(e.target.value));
                                resetResult();
                            }}
                            className="px-3 py-2 bg-surface rounded-lg border border-border text-sm"
                        >
                            <option value="">Select a buyer…</option>
                            {contacts.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.phone ? ` · ${c.phone}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="pt-1">
                        <p className="text-[11px] font-medium text-muted uppercase tracking-wide mb-2">
                            Add-on charges
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <MoneyField label="Parking" value={parking} onChange={setParking} />
                            <MoneyField label="Clubhouse" value={clubhouse} onChange={setClubhouse} />
                            <MoneyField label="Legal" value={legal} onChange={setLegal} />
                            <MoneyField label="Registration" value={registration} onChange={setRegistration} />
                            <MoneyField
                                label="DLD transfer fee (auto if blank)"
                                value={dldTransferFee}
                                onChange={setDldTransferFee}
                                placeholder="auto"
                            />
                            <MoneyField
                                label="VAT (auto if blank)"
                                value={vatAmount}
                                onChange={setVatAmount}
                                placeholder="auto"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <MoneyField label="Discount" value={discount} onChange={setDiscount} />
                    </div>

                    {error && (
                        <p className="text-xs text-danger bg-red-500/5 rounded-lg px-3 py-2">{error}</p>
                    )}

                    <button
                        onClick={handleBuild}
                        disabled={building}
                        className="w-full px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                    >
                        {building ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" /> Building…
                            </>
                        ) : (
                            <>
                                <Receipt className="w-4 h-4" /> Build cost sheet
                            </>
                        )}
                    </button>
                </div>

                {/* ── Result: breakdown + PDF + share ── */}
                <div className="glass-card p-5 space-y-4">
                    <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4 text-accent" /> Cost sheet
                    </h2>

                    {!sheet ? (
                        <div className="py-16 text-center text-muted">
                            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">
                                Select a unit and buyer, then build a cost sheet to see the itemized
                                breakdown here.
                            </p>
                        </div>
                    ) : (
                        <>
                            {selectedContact && (
                                <p className="text-xs text-muted">
                                    Cost sheet #{sheet.id} for{' '}
                                    <span className="font-medium text-foreground">{selectedContact.name}</span>
                                </p>
                            )}

                            <CostBreakdown sheet={sheet} />

                            {/* PDF actions */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={handleGeneratePdf}
                                    disabled={pdfBusy}
                                    className="px-4 py-2 bg-surface border border-border hover:bg-surface-hover disabled:opacity-50 rounded-xl text-sm font-medium text-foreground transition-colors flex items-center gap-2"
                                >
                                    {pdfBusy ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <FileText className="w-4 h-4" />
                                    )}
                                    {pdfUrl ? 'Regenerate PDF' : 'Generate PDF'}
                                </button>
                                {pdfUrl && (
                                    <a
                                        href={pdfUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-surface border border-border hover:bg-surface-hover rounded-xl text-sm font-medium text-foreground transition-colors flex items-center gap-2"
                                    >
                                        <Download className="w-4 h-4" /> Download
                                    </a>
                                )}
                            </div>

                            {pdfError && (
                                <p className="text-xs text-danger bg-red-500/5 rounded-lg px-3 py-2">
                                    {pdfError}
                                </p>
                            )}

                            {pdfUrl && (
                                <iframe
                                    title="Cost sheet PDF preview"
                                    src={pdfUrl}
                                    className="w-full h-72 rounded-xl border border-border bg-white"
                                />
                            )}

                            {/* Share actions */}
                            <div className="pt-1">
                                <p className="text-[11px] font-medium text-muted uppercase tracking-wide mb-2 flex items-center gap-1">
                                    <Share2 className="w-3 h-3" /> Share with buyer
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {(['WhatsApp', 'Email', 'Both'] as const).map((ch) => (
                                        <button
                                            key={ch}
                                            onClick={() => handleShare(ch)}
                                            disabled={shareBusy !== null}
                                            className="px-4 py-2 bg-accent/10 hover:bg-accent/20 disabled:opacity-50 text-accent rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                                        >
                                            {shareBusy === ch ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Share2 className="w-4 h-4" />
                                            )}
                                            {ch}
                                        </button>
                                    ))}
                                </div>

                                {shareError && (
                                    <p className="mt-2 text-xs text-danger bg-red-500/5 rounded-lg px-3 py-2">
                                        {shareError}
                                    </p>
                                )}

                                {shareResult && (
                                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                                        <DeliveryPill channel="WhatsApp" status={shareResult.whatsapp} />
                                        <DeliveryPill channel="Email" status={shareResult.email} />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Payment-plan editor ─────────────────────────────────────────────────────

const emptyMilestone = (): Milestone => ({ name: '', dueOffsetDays: 0, percentage: 0 });

function PaymentPlanEditor({ projects }: { projects: ProjectOption[] }) {
    const [projectId, setProjectId] = useState<number | ''>('');
    const [name, setName] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [milestones, setMilestones] = useState<Milestone[]>([
        { name: 'Booking amount', dueOffsetDays: 0, percentage: 10 },
        { name: 'On agreement', dueOffsetDays: 30, percentage: 40 },
        { name: 'On possession', dueOffsetDays: 365, percentage: 50 },
    ]);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [saving, startSave] = useTransition();

    const total = milestones.reduce((s, m) => s + (Number.isFinite(m.percentage) ? m.percentage : 0), 0);
    const sumsTo100 = Math.abs(total - 100) <= 0.01;

    function updateMilestone(index: number, patch: Partial<Milestone>) {
        setMilestones((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
    }

    function addMilestone() {
        setMilestones((prev) => [...prev, emptyMilestone()]);
    }

    function removeMilestone(index: number) {
        setMilestones((prev) => prev.filter((_, i) => i !== index));
    }

    function handleSave() {
        setError(null);
        setSuccess(null);
        if (projectId === '') {
            setError('Select a project for this payment plan.');
            return;
        }
        if (!sumsTo100) {
            setError(`Milestone percentages must sum to 100 (currently ${total}).`);
            return;
        }

        startSave(async () => {
            const res = await upsertPaymentPlan(projectId, {
                name: name.trim(),
                isDefault,
                milestones: milestones.map((m) => ({
                    name: m.name.trim(),
                    dueOffsetDays: Math.max(0, Math.trunc(m.dueOffsetDays)),
                    percentage: m.percentage,
                })),
            });
            if (res.success) {
                setSuccess(`Payment plan "${name.trim()}" saved.`);
            } else {
                setError(res.error);
            }
        });
    }

    return (
        <div className="glass-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Wallet className="w-4 h-4 text-accent" /> Payment plan editor
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Project
                    </span>
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value === '' ? '' : Number(e.target.value))}
                        className="px-3 py-2 bg-surface rounded-lg border border-border text-sm"
                    >
                        <option value="">Select a project…</option>
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} — {p.city}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted">Plan name</span>
                    <input
                        type="text"
                        value={name}
                        maxLength={100}
                        placeholder="e.g. Construction-linked plan"
                        onChange={(e) => setName(e.target.value)}
                        className="px-3 py-2 bg-surface rounded-lg border border-border text-sm"
                    />
                </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-border"
                />
                Set as default plan for this project
            </label>

            {/* Milestones */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-muted uppercase tracking-wide">Milestones</p>
                    <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${sumsTo100
                            ? 'bg-emerald-500/10 text-emerald-700'
                            : 'bg-amber-500/10 text-amber-700'
                            }`}
                    >
                        Sum: {total}%{sumsTo100 ? ' ✓' : ' (must be 100)'}
                    </span>
                </div>

                <div className="space-y-2">
                    {milestones.map((m, i) => (
                        <div key={i} className="flex items-end gap-2">
                            <label className="flex flex-col gap-1 flex-1">
                                {i === 0 && <span className="text-[10px] text-muted">Name</span>}
                                <input
                                    type="text"
                                    value={m.name}
                                    maxLength={100}
                                    placeholder="Milestone name"
                                    onChange={(e) => updateMilestone(i, { name: e.target.value })}
                                    className="px-3 py-2 bg-surface rounded-lg border border-border text-sm w-full"
                                />
                            </label>
                            <label className="flex flex-col gap-1 w-24">
                                {i === 0 && <span className="text-[10px] text-muted">Due (days)</span>}
                                <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={m.dueOffsetDays}
                                    onChange={(e) =>
                                        updateMilestone(i, { dueOffsetDays: Number(e.target.value) })
                                    }
                                    className="px-3 py-2 bg-surface rounded-lg border border-border text-sm w-full"
                                />
                            </label>
                            <label className="flex flex-col gap-1 w-20">
                                {i === 0 && <span className="text-[10px] text-muted">%</span>}
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.01"
                                    value={m.percentage}
                                    onChange={(e) =>
                                        updateMilestone(i, { percentage: Number(e.target.value) })
                                    }
                                    className="px-3 py-2 bg-surface rounded-lg border border-border text-sm w-full"
                                />
                            </label>
                            <button
                                onClick={() => removeMilestone(i)}
                                disabled={milestones.length <= 1}
                                aria-label="Remove milestone"
                                className="p-2 text-muted hover:text-danger disabled:opacity-30 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    onClick={addMilestone}
                    className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1"
                >
                    <Plus className="w-3.5 h-3.5" /> Add milestone
                </button>
            </div>

            {error && <p className="text-xs text-danger bg-red-500/5 rounded-lg px-3 py-2">{error}</p>}
            {success && (
                <p className="text-xs text-emerald-700 bg-emerald-500/5 rounded-lg px-3 py-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {success}
                </p>
            )}

            <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
            >
                {saving ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                    </>
                ) : (
                    <>
                        <Wallet className="w-4 h-4" /> Save payment plan
                    </>
                )}
            </button>
        </div>
    );
}

// ─── Root client component ─────────────────────────────────────────────────────

const tabs = [
    { id: 'builder', label: 'Cost Sheet', icon: Receipt },
    { id: 'plans', label: 'Payment Plans', icon: Wallet },
] as const;

type Tab = (typeof tabs)[number]['id'];

export default function CostSheetClient({
    projects,
    contacts,
}: {
    projects: ProjectOption[];
    contacts: ContactOption[];
}) {
    const [tab, setTab] = useState<Tab>('builder');

    return (
        <div className="space-y-5">
            <div className="flex bg-surface rounded-xl border border-border p-0.5 w-fit">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${tab === t.id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                                }`}
                        >
                            <Icon className="w-3.5 h-3.5" /> {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'builder' && <CostSheetBuilder projects={projects} contacts={contacts} />}
            {tab === 'plans' && <PaymentPlanEditor projects={projects} />}
        </div>
    );
}
