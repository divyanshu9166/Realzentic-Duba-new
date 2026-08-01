'use client';

/**
 * Client milestone tracker for the deal detail page (Req 9.5).
 *
 * Renders each booking milestone with its name, due date, amount, paid amount
 * and status, plus per-milestone "Send Demand" and "Mark Paid" actions and a
 * demand-letter history. Actions call the already-implemented server actions
 * (`recordMilestonePayment`, `sendDemandLetter`, `generateDemandLetters`) and
 * refresh the server-rendered detail page on success so the timeline, history
 * and statuses stay in sync. All money math on the server uses Decimal; this
 * component receives plain numbers and only renders display strings.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Milestone as MilestoneIcon,
    Send,
    Banknote,
    Mail,
    MessageCircle,
    History,
    Loader2,
} from 'lucide-react';
import { recordMilestonePayment, sendDemandLetter, generateDemandLetters } from '@/app/actions/deals';

export interface DemandLetterView {
    id: number;
    windowDays: number;
    generatedAt: string | Date | null;
    whatsappStatus: string;
    emailStatus: string;
    sentDate: string | Date | null;
}

export interface MilestoneView {
    id: number;
    name: string;
    dueDate: string | Date;
    amount: number;
    paidAmount: number;
    status: string;
    demandLetters: DemandLetterView[];
}

const MILESTONE_STATUS_CLASSES: Record<string, string> = {
    Upcoming: 'bg-slate-500/10 text-slate-600',
    Due: 'bg-amber-500/10 text-amber-700',
    Overdue: 'bg-red-500/10 text-red-600',
    Paid: 'bg-emerald-500/10 text-emerald-700',
    Partially_Paid: 'bg-blue-500/10 text-blue-700',
};

const CHANNEL_STATUS_CLASSES: Record<string, string> = {
    Sent: 'text-emerald-600',
    Failed: 'text-red-600',
    Pending: 'text-muted',
};

const WINDOW_OPTIONS = [7, 15, 30];

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

export default function MilestoneTracker({ milestones }: { milestones: MilestoneView[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [windowDays, setWindowDays] = useState<number>(15);
    // The id of the action currently running, so only the clicked control spins.
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    // Per-milestone payment input drafts and which milestone's form is open.
    const [openPayment, setOpenPayment] = useState<number | null>(null);
    const [paymentAmount, setPaymentAmount] = useState<string>('');

    function runAction(key: string, fn: () => Promise<{ success: boolean; error?: string }>, onOk?: () => void) {
        setBusyKey(key);
        setError(null);
        setNotice(null);
        startTransition(async () => {
            try {
                const res = await fn();
                if (res.success) {
                    onOk?.();
                    router.refresh();
                } else {
                    setError(res.error ?? 'The action could not be completed.');
                }
            } catch {
                setError('Something went wrong. Please try again.');
            } finally {
                setBusyKey(null);
            }
        });
    }

    function handleGenerate() {
        runAction(
            'generate',
            () => generateDemandLetters(windowDays),
            () => setNotice(`Demand letters generated for milestones due within ${windowDays} days.`),
        );
    }

    function handleSend(milestone: MilestoneView) {
        const latest = milestone.demandLetters[0];
        if (!latest) {
            setError('No demand letter exists for this milestone yet. Generate one first.');
            return;
        }
        runAction(
            `send-${milestone.id}`,
            () => sendDemandLetter(latest.id),
            () => setNotice(`Demand letter sent for "${milestone.name}".`),
        );
    }

    function handleSendLetter(letterId: number) {
        runAction(`letter-${letterId}`, () => sendDemandLetter(letterId));
    }

    function submitPayment(milestone: MilestoneView) {
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter a payment amount greater than zero.');
            return;
        }
        runAction(
            `pay-${milestone.id}`,
            () => recordMilestonePayment(milestone.id, amount),
            () => {
                setNotice(`Payment of ${formatAed(amount)} recorded for "${milestone.name}".`);
                setOpenPayment(null);
                setPaymentAmount('');
            },
        );
    }

    return (
        <div className="glass-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <MilestoneIcon className="h-4 w-4 text-accent" />
                    <h2 className="text-base font-semibold text-foreground">Milestone Tracker</h2>
                </div>
                {milestones.length > 0 && (
                    <div className="flex items-center gap-2">
                        <select
                            value={windowDays}
                            onChange={(e) => setWindowDays(Number(e.target.value))}
                            disabled={isPending}
                            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground"
                            aria-label="Demand letter lead window in days"
                        >
                            {WINDOW_OPTIONS.map((d) => (
                                <option key={d} value={d}>
                                    {d}-day window
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                        >
                            {busyKey === 'generate' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Send className="h-3.5 w-3.5" />
                            )}
                            Generate demand letters
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                    {error}
                </div>
            )}
            {notice && (
                <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
                    {notice}
                </div>
            )}

            {milestones.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                    No payment milestones yet. Convert this deal to a booking to generate a schedule.
                </p>
            ) : (
                <ul className="space-y-3">
                    {milestones.map((m) => {
                        const amount = num(m.amount);
                        const paid = num(m.paidAmount);
                        const outstanding = Math.max(0, amount - paid);
                        const pct = amount > 0 ? Math.min(100, Math.round((paid / amount) * 100)) : 0;
                        const statusClass =
                            MILESTONE_STATUS_CLASSES[m.status] ?? 'bg-slate-500/10 text-slate-600';
                        const isPaid = m.status === 'Paid';
                        const sending = busyKey === `send-${m.id}`;
                        const paying = busyKey === `pay-${m.id}`;
                        return (
                            <li key={m.id} className="rounded-lg border border-border bg-surface/60 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-medium text-foreground">{m.name}</p>
                                    <span
                                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}
                                    >
                                        {m.status.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                                    <span>Due {formatDate(m.dueDate)}</span>
                                    <span>
                                        {formatAed(paid)} / {formatAed(amount)}
                                    </span>
                                </div>
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                                    <div
                                        className="h-full rounded-full bg-accent transition-all"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>

                                {/* Per-milestone actions (Req 9.5) */}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleSend(m)}
                                        disabled={isPending || m.demandLetters.length === 0}
                                        title={
                                            m.demandLetters.length === 0
                                                ? 'No demand letter generated for this milestone yet'
                                                : 'Send the latest demand letter'
                                        }
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface disabled:opacity-50"
                                    >
                                        {sending ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Send className="h-3.5 w-3.5" />
                                        )}
                                        Send Demand
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError(null);
                                            setNotice(null);
                                            setOpenPayment(openPayment === m.id ? null : m.id);
                                            setPaymentAmount(outstanding > 0 ? String(outstanding) : '');
                                        }}
                                        disabled={isPending || isPaid}
                                        title={isPaid ? 'Milestone already fully paid' : 'Record a payment'}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface disabled:opacity-50"
                                    >
                                        <Banknote className="h-3.5 w-3.5" />
                                        Mark Paid
                                    </button>
                                </div>

                                {/* Payment input */}
                                {openPayment === m.id && !isPaid && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2.5">
                                        <span className="text-[11px] text-muted">
                                            Outstanding {formatAed(outstanding)}
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={paymentAmount}
                                            onChange={(e) => setPaymentAmount(e.target.value)}
                                            placeholder="Amount"
                                            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => submitPayment(m)}
                                            disabled={isPending}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                                        >
                                            {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                            Record payment
                                        </button>
                                    </div>
                                )}

                                {/* Demand-letter history (Req 9.5) */}
                                {m.demandLetters.length > 0 && (
                                    <div className="mt-3 border-t border-border/60 pt-2">
                                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                                            <History className="h-3 w-3" />
                                            Demand letter history
                                        </div>
                                        <ul className="space-y-1.5">
                                            {m.demandLetters.map((letter) => (
                                                <li
                                                    key={letter.id}
                                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-2 py-1.5 text-[11px]"
                                                >
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <span className="text-muted">
                                                            {formatDate(letter.generatedAt)} · {letter.windowDays}-day
                                                        </span>
                                                        <span
                                                            className={`flex items-center gap-1 ${CHANNEL_STATUS_CLASSES[letter.whatsappStatus] ?? 'text-muted'}`}
                                                        >
                                                            <MessageCircle className="h-3 w-3" /> {letter.whatsappStatus}
                                                        </span>
                                                        <span
                                                            className={`flex items-center gap-1 ${CHANNEL_STATUS_CLASSES[letter.emailStatus] ?? 'text-muted'}`}
                                                        >
                                                            <Mail className="h-3 w-3" /> {letter.emailStatus}
                                                        </span>
                                                        {letter.sentDate && (
                                                            <span className="text-muted">
                                                                Sent {formatDate(letter.sentDate)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSendLetter(letter.id)}
                                                        disabled={isPending}
                                                        className="inline-flex items-center gap-1 text-accent hover:text-accent-hover disabled:opacity-50"
                                                    >
                                                        {busyKey === `letter-${letter.id}` ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <Send className="h-3 w-3" />
                                                        )}
                                                        {letter.sentDate ? 'Resend' : 'Send'}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
