/**
 * Deal detail view (Req 4.7).
 *
 * Server component: loads the deal detail bundle via `getDealDetail` and
 * renders the four required panels — the activity timeline, documents,
 * milestone tracker, and cost-sheet viewer. Decimal columns are read on the
 * server (so `Number(...)` resolves a real value) and only display strings
 * reach the markup.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
    ArrowLeft,
    Activity,
    FileText,
    ReceiptText,
    Flame,
    AlertTriangle,
    CheckCircle2,
    Clock,
    ExternalLink,
    BadgeCheck,
} from 'lucide-react';
import { getDealDetail } from '@/app/actions/deals';
import { getStaff } from '@/app/actions/staff';
import AiMatchPanel from '@/components/AiMatchPanel';
import MilestoneTracker, { type MilestoneView } from './MilestoneTracker';
import SnagPanel from './SnagPanel';
import DealActions from './DealActions';
import DldTransferPanel from './DldTransferPanel';
import { isGoldenVisaEligible } from '@/lib/golden-visa';

export const dynamic = 'force-dynamic';

function num(value: unknown): number {
    return value == null ? 0 : Number(value);
}

function formatAed(value: unknown): string {
    return `AED ${num(value).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function formatDate(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleString('en-AE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
}

const DOC_STATUS_CLASSES: Record<string, string> = {
    Pending: 'bg-amber-500/10 text-amber-700',
    Verified: 'bg-emerald-500/10 text-emerald-700',
    Rejected: 'bg-red-500/10 text-red-600',
    Expired: 'bg-slate-500/10 text-slate-600',
};

function formatFileSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DealDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const dealId = Number(id);

    if (!Number.isInteger(dealId) || dealId < 1) {
        notFound();
    }

    const res = await getDealDetail(dealId);

    if (!res.success || !res.data) {
        return (
            <div className="space-y-6">
                <Link
                    href="/deals"
                    className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
                >
                    <ArrowLeft className="h-4 w-4" /> Back to pipeline
                </Link>
                <div className="glass-card py-16 text-center text-muted">
                    <p className="font-medium">Deal not found</p>
                    <p className="mt-1 text-sm">{res.error ?? 'This deal may have been removed.'}</p>
                </div>
            </div>
        );
    }

    const { deal, timeline, documents, milestones, costSheet, dldTrusteeAppointment } = res.data;
    const developerNocDocument = documents.find((document) => document.type.toLowerCase().includes('developer noc')) ?? null;

    // Staff list for the inline-edit agent dropdown.
    const staffRes = await getStaff();
    const agents = staffRes.success
        ? (staffRes.data as Array<{ id: number; name: string }>).map((s) => ({ id: s.id, name: s.name }))
        : [];

    const expectedCloseInput = deal.expectedCloseDate
        ? new Date(deal.expectedCloseDate).toISOString().slice(0, 10)
        : '';

    // Serialize milestones (Decimal -> number, Date -> Date) for the client tracker.
    const milestoneViews: MilestoneView[] = milestones.map((m) => ({
        id: m.id,
        name: m.name,
        dueDate: m.dueDate,
        amount: num(m.amount),
        paidAmount: num(m.paidAmount),
        status: m.status,
        demandLetters: (m.demandLetters ?? []).map((l) => ({
            id: l.id,
            windowDays: l.windowDays,
            generatedAt: l.generatedAt,
            whatsappStatus: l.whatsappStatus,
            emailStatus: l.emailStatus,
            sentDate: l.sentDate,
        })),
    }));

    return (
        <div className="space-y-6">
            <Link
                href="/deals"
                className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
            >
                <ArrowLeft className="h-4 w-4" /> Back to pipeline
            </Link>

            {/* Summary header */}
            <div className="glass-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl md:text-2xl font-bold text-foreground">
                                {deal.contact?.name ?? 'Unknown contact'}
                            </h1>
                            <span
                                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                                style={{ backgroundColor: deal.stage?.color ?? '#888888' }}
                            >
                                {deal.stage?.name ?? 'No stage'}
                            </span>
                            {deal.isHot && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-600">
                                    <Flame className="h-3 w-3" /> Hot
                                </span>
                            )}
                            {deal.isAtRisk && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600">
                                    <AlertTriangle className="h-3 w-3" /> At risk
                                </span>
                            )}
                            {isGoldenVisaEligible(num(deal.booking?.agreementValue ?? deal.value)) && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                    <BadgeCheck className="h-3 w-3" /> Golden Visa eligibility indicator
                                </span>
                            )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                            {deal.contact?.phone && <span>{deal.contact.phone}</span>}
                            {deal.unit?.unitNumber && <span>Unit {deal.unit.unitNumber}</span>}
                            {deal.assignedAgent?.name && <span>Agent: {deal.assignedAgent.name}</span>}
                            {deal.channelPartner?.name && <span>Partner: {deal.channelPartner.name}</span>}
                            {deal.source && <span>Source: {deal.source}</span>}
                            <span>Expected close: {formatDate(deal.expectedCloseDate)}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-2xl font-bold text-foreground">{formatAed(deal.value)}</p>
                        {typeof deal.aiScore === 'number' && (
                            <p className="mt-1 text-xs text-muted">AI score: {deal.aiScore}</p>
                        )}
                        <div className="mt-3 flex justify-end">
                            <DealActions
                                deal={{
                                    id: deal.id,
                                    value: num(deal.value),
                                    expectedCloseDate: expectedCloseInput,
                                    source: deal.source ?? null,
                                    assignedAgentId: deal.assignedAgentId ?? null,
                                    notes: deal.notes ?? null,
                                }}
                                agents={agents}
                            />
                        </div>
                    </div>
                </div>
                {deal.lostReason && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                        Lost reason: {deal.lostReason}
                    </div>
                )}
            </div>

            <DldTransferPanel
                dealId={deal.id}
                workflow={{
                    developerNocStatus: deal.developerNocStatus,
                    dldTransferStatus: deal.dldTransferStatus,
                    dldTrusteeOffice: deal.dldTrusteeOffice,
                    dldTransferNotes: deal.dldTransferNotes,
                }}
                appointment={dldTrusteeAppointment ? {
                    date: dldTrusteeAppointment.date.toISOString(),
                    time: dldTrusteeAppointment.time,
                    status: dldTrusteeAppointment.status,
                } : null}
                nocDocument={developerNocDocument ? {
                    fileName: developerNocDocument.fileName,
                    fileUrl: developerNocDocument.fileUrl,
                    status: developerNocDocument.status,
                } : null}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {/* Activity timeline */}
                <div className="glass-card p-5 lg:col-span-2">
                    <div className="mb-4 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-accent" />
                        <h2 className="text-base font-semibold text-foreground">Activity Timeline</h2>
                        <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
                            {timeline.length}
                        </span>
                    </div>
                    {timeline.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted">No activity recorded yet.</p>
                    ) : (
                        <ol className="relative space-y-4 border-l border-border pl-5">
                            {timeline.map((event) => (
                                <li key={event.id} className="relative">
                                    <span className="absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-accent bg-surface" />
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                                            {event.type.replace(/_/g, ' ')}
                                        </span>
                                        <span className="text-[11px] text-muted">{formatDateTime(event.createdAt)}</span>
                                    </div>
                                    <p className="mt-0.5 text-sm text-foreground">{event.description}</p>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>

                {/* Right column: milestones + documents */}
                <div className="space-y-5">
                    {/* Milestone tracker with per-milestone demand/payment actions (Req 9.5) */}
                    <MilestoneTracker milestones={milestoneViews} />

                    {/* Documents */}
                    <div className="glass-card p-5">
                        <div className="mb-4 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-accent" />
                            <h2 className="text-base font-semibold text-foreground">Documents</h2>
                            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
                                {documents.length}
                            </span>
                        </div>
                        {documents.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted">No documents attached.</p>
                        ) : (
                            <ul className="space-y-2">
                                {documents.map((doc) => {
                                    const statusClass =
                                        DOC_STATUS_CLASSES[doc.status] ?? 'bg-slate-500/10 text-slate-600';
                                    return (
                                        <li
                                            key={doc.id}
                                            className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 p-2.5"
                                        >
                                            <FileText className="h-4 w-4 flex-shrink-0 text-muted" />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-foreground">{doc.fileName}</p>
                                                <p className="text-[11px] text-muted">
                                                    {doc.type} · {formatFileSize(doc.fileSize)}
                                                </p>
                                            </div>
                                            <span
                                                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}
                                            >
                                                {doc.status}
                                            </span>
                                            <a
                                                href={doc.fileUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0 text-muted hover:text-accent"
                                                title="Open document"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Cost-sheet viewer */}
            <div className="glass-card p-5">
                <div className="mb-4 flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-accent" />
                    <h2 className="text-base font-semibold text-foreground">Cost Sheet</h2>
                </div>
                {!costSheet ? (
                    <p className="py-6 text-center text-sm text-muted">
                        No cost sheet generated for this deal&apos;s unit and buyer yet.
                    </p>
                ) : (
                    <div className="space-y-4">
                        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                            {[
                                ['Base cost', costSheet.baseCost],
                                ['Floor rise', costSheet.floorRise],
                                ['View premium', costSheet.viewPremium],
                                ['Parking charges', costSheet.parkingCharges],
                                ['Clubhouse charges', costSheet.clubhouseCharges],
                                ['Legal charges', costSheet.legalCharges],
                                ['DLD transfer fee', costSheet.dldTransferFee],
                                ['VAT', costSheet.vatAmount],
                                ['Registration charges', costSheet.registrationCharges],
                                ['Discount', costSheet.discount],
                            ].map(([label, value]) => (
                                <div
                                    key={label as string}
                                    className="flex items-center justify-between border-b border-border/60 py-1.5"
                                >
                                    <dt className="text-sm text-muted">{label as string}</dt>
                                    <dd className="text-sm font-medium text-foreground">{formatAed(value)}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center justify-between gap-6">
                                <span className="text-sm text-muted">Total</span>
                                <span className="text-base font-semibold text-foreground">
                                    {formatAed(costSheet.total)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-6">
                                <span className="text-sm text-muted">Net payable</span>
                                <span className="text-lg font-bold text-accent">{formatAed(costSheet.netPayable)}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Generated {formatDate(costSheet.generatedAt)}
                            </span>
                            {costSheet.pdfUrl && (
                                <a
                                    href={costSheet.pdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-accent hover:text-accent-hover"
                                >
                                    <CheckCircle2 className="h-3 w-3" /> View PDF
                                </a>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Snag / Defect reports */}
            {deal.booking && (
                <SnagPanel bookingId={deal.booking.id} />
            )}

            {/* AI-suggested units — Req 16.5 */}
            <div className="glass-card p-5">
                <AiMatchPanel
                    preferences={{
                        maxBudget: num(deal.value) > 0 ? num(deal.value) : undefined,
                        type: deal.unit?.type ? [deal.unit.type] : undefined,
                    }}
                    buyerName={deal.contact?.name ?? undefined}
                    buyerPhone={deal.contact?.phone ?? undefined}
                />
            </div>
        </div>
    );
}
