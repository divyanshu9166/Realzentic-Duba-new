'use client';

/**
 * ContactTimeline — unified contact interaction timeline (Module 11).
 *
 * Renders:
 *   - An icon + colour badge per entry type (Req 14.3)
 *   - Entry description, relative timestamp, and performed-by attribution (Req 14.3)
 *   - A type-filter pill row to show only selected entry types (Req 14.4)
 *   - Infinite scroll: "Load more" trigger appends the next page from
 *     `getContactTimeline` using the cursor returned by the server (Req 14.5)
 *   - AI "Summarize Chat" button for contacts with WhatsApp messages
 *
 * Requirements: 14.3, 14.4, 14.5
 */

import { useState, useCallback, useTransition } from 'react';
import {
    Phone,
    MessageSquare,
    Mail,
    MapPin,
    CreditCard,
    FileText,
    GitBranch,
    StickyNote,
    Loader2,
    ChevronDown,
    User,
    Clock,
    Brain,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { getContactTimeline } from '@/app/actions/timeline';
import { summarizeWaConversation } from '@/app/actions/conversation-summary';
import type { ConversationSummaryResult } from '@/app/actions/conversation-summary';
import type { TimelineEntry, TimelineEntryType, TimelinePage } from '@/lib/timeline';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ContactTimelineProps {
    /** The numeric contact ID to load the timeline for. */
    contactId: number;
    /** Initial page already fetched server-side (avoids a client round-trip on mount). */
    initialPage: TimelinePage;
}

// ─── Entry-type configuration ────────────────────────────────────────────────

const TYPE_CONFIG: Record<
    TimelineEntryType,
    {
        label: string;
        /** Lucide icon component */
        Icon: React.ComponentType<{ className?: string }>;
        /** Tailwind classes for the icon badge background + text */
        badgeClass: string;
        /** Tailwind class for the vertical connector dot */
        dotClass: string;
    }
> = {
    call: {
        label: 'Call',
        Icon: Phone,
        badgeClass: 'bg-emerald-500/10 text-emerald-700',
        dotClass: 'bg-emerald-500',
    },
    message: {
        label: 'Message',
        Icon: MessageSquare,
        badgeClass: 'bg-blue-500/10 text-blue-700',
        dotClass: 'bg-blue-500',
    },
    email: {
        label: 'Email',
        Icon: Mail,
        badgeClass: 'bg-violet-500/10 text-violet-700',
        dotClass: 'bg-violet-500',
    },
    visit: {
        label: 'Site Visit',
        Icon: MapPin,
        badgeClass: 'bg-amber-500/10 text-amber-700',
        dotClass: 'bg-amber-500',
    },
    payment: {
        label: 'Payment',
        Icon: CreditCard,
        badgeClass: 'bg-pink-500/10 text-pink-700',
        dotClass: 'bg-pink-500',
    },
    document: {
        label: 'Document',
        Icon: FileText,
        badgeClass: 'bg-cyan-500/10 text-cyan-700',
        dotClass: 'bg-cyan-500',
    },
    deal_stage: {
        label: 'Deal Stage',
        Icon: GitBranch,
        badgeClass: 'bg-indigo-500/10 text-indigo-700',
        dotClass: 'bg-indigo-500',
    },
    note: {
        label: 'Note',
        Icon: StickyNote,
        badgeClass: 'bg-slate-500/10 text-slate-600',
        dotClass: 'bg-slate-400',
    },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG) as TimelineEntryType[];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format an epoch-milliseconds timestamp into a human-readable locale string.
 * Falls back to "—" for missing/invalid values.
 */
function formatTimestamp(ms: number): string {
    if (!ms) return '—';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-AE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** A single chip in the type-filter pill row (Req 14.4). */
function FilterChip({
    type,
    active,
    onToggle,
}: {
    type: TimelineEntryType;
    active: boolean;
    onToggle: (t: TimelineEntryType) => void;
}) {
    const { label, Icon, badgeClass } = TYPE_CONFIG[type];
    return (
        <button
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all select-none
        ${active
                    ? `${badgeClass} border-current ring-1 ring-current/30`
                    : 'bg-surface text-muted border-border hover:border-accent/40 hover:text-foreground'
                }`}
        >
            <Icon className="w-3 h-3" />
            {label}
        </button>
    );
}

/** Single timeline entry row with icon badge, description, timestamp, performed-by (Req 14.3). */
function TimelineRow({ entry }: { entry: TimelineEntry }) {
    const cfg = TYPE_CONFIG[entry.type];

    return (
        <li className="relative flex gap-4">
            {/* Vertical connector line — drawn via the parent's border-l */}
            {/* Coloured dot */}
            <div
                aria-hidden
                className={`absolute -left-[27px] top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background z-10 ${cfg.dotClass}`}
            />

            {/* Content */}
            <div className="flex-1 min-w-0 pb-4">
                {/* Icon badge + type label */}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.badgeClass}`}
                    >
                        <cfg.Icon className="w-3 h-3" />
                        {cfg.label}
                    </span>

                    {/* Timestamp (Req 14.3) */}
                    <span className="flex items-center gap-1 text-[11px] text-muted">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(entry.timestamp)}
                    </span>
                </div>

                {/* Description (Req 14.3) */}
                <p className="text-sm text-foreground leading-relaxed break-words">
                    {entry.description}
                </p>

                {/* Performed-by (Req 14.3) */}
                {entry.performedBy && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                        <User className="w-3 h-3" />
                        {entry.performedBy}
                    </p>
                )}
            </div>
        </li>
    );
}

// ─── AI Summary Panel ─────────────────────────────────────────────────────────

const SENTIMENT_STYLES: Record<
    ConversationSummaryResult['keyFacts']['sentiment'],
    string
> = {
    positive: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    neutral: 'bg-slate-500/10 text-slate-600 border-slate-400/20',
    negative: 'bg-red-500/10 text-red-700 border-red-500/20',
};

const SENTIMENT_LABELS: Record<
    ConversationSummaryResult['keyFacts']['sentiment'],
    string
> = {
    positive: '😊 Positive',
    neutral: '😐 Neutral',
    negative: '😟 Negative',
};

function AiSummaryPanel({
    summary,
    onDismiss,
}: {
    summary: ConversationSummaryResult;
    onDismiss: () => void;
}) {
    const { keyFacts } = summary;

    return (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-semibold text-foreground">
                        AI Conversation Summary
                    </span>
                    <span className="text-[11px] text-muted">
                        ({summary.messageCount} messages)
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss summary"
                    className="text-xs text-muted hover:text-foreground underline underline-offset-2 flex items-center gap-1 transition-colors"
                >
                    <X className="w-3 h-3" />
                    Dismiss
                </button>
            </div>

            {/* Summary paragraph */}
            <p className="text-sm text-foreground leading-relaxed">
                {summary.summary}
            </p>

            {/* Key-facts badges */}
            <div className="flex flex-wrap gap-2">
                {keyFacts.budget && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-700 border-amber-500/20">
                        💰 Budget: {keyFacts.budget}
                    </span>
                )}
                {keyFacts.propertyType && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-violet-500/10 text-violet-700 border-violet-500/20">
                        🏠 {keyFacts.propertyType}
                    </span>
                )}
                {keyFacts.location && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-cyan-500/10 text-cyan-700 border-cyan-500/20">
                        📍 {keyFacts.location}
                    </span>
                )}
                <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${SENTIMENT_STYLES[keyFacts.sentiment]}`}
                >
                    {SENTIMENT_LABELS[keyFacts.sentiment]}
                </span>
            </div>

            {/* Next step */}
            {keyFacts.nextStep && (
                <p className="text-sm text-foreground">
                    <span className="font-medium text-muted">Next step: </span>
                    {keyFacts.nextStep}
                </p>
            )}
        </div>
    );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function ContactTimeline({
    contactId,
    initialPage,
}: ContactTimelineProps) {
    // All entries accumulated so far (starts with the first page).
    const [entries, setEntries] = useState<TimelineEntry[]>(initialPage.items);
    const [nextCursor, setNextCursor] = useState<number | null>(initialPage.nextCursor);
    const [hasMore, setHasMore] = useState<boolean>(initialPage.hasMore);

    // Active type filter — null means "all types" (Req 14.4).
    const [activeFilter, setActiveFilter] = useState<TimelineEntryType | null>(null);

    // Whether a "load more" fetch is in flight (Req 14.5).
    const [isPending, startTransition] = useTransition();
    const [fetchError, setFetchError] = useState<string | null>(null);

    // AI conversation summary state.
    const [summarizing, setSummarizing] = useState<boolean>(false);
    const [summary, setSummary] = useState<ConversationSummaryResult | null>(null);

    // Only show the button when there are message-type entries in the initial page.
    const hasMessages = initialPage.items.some((e) => e.type === 'message');

    // ── Filter toggle ────────────────────────────────────────────────────────

    /**
     * Clicking an active filter chip clears the filter (shows all types).
     * Clicking an inactive chip activates it as the sole filter.
     * In both cases the displayed list resets to the initial page's cursor.
     */
    const handleFilterToggle = useCallback(
        (type: TimelineEntryType) => {
            const newFilter = activeFilter === type ? null : type;
            setActiveFilter(newFilter);
            // Reset pagination when the filter changes — re-fetch page 0 with the new filter.
            startTransition(async () => {
                setFetchError(null);
                const res = await getContactTimeline(contactId, 0, newFilter ?? undefined);
                if (!res.success) {
                    setFetchError(res.error ?? 'Failed to load timeline.');
                    return;
                }
                setEntries(res.data.items);
                setNextCursor(res.data.nextCursor);
                setHasMore(res.data.hasMore);
            });
        },
        [activeFilter, contactId],
    );

    // ── AI summarize handler ─────────────────────────────────────────────────

    const handleSummarize = useCallback(async () => {
        setSummarizing(true);
        setSummary(null);
        try {
            const res = await summarizeWaConversation(contactId);
            if (!res.success || !res.data) {
                toast.error(res.error ?? 'AI summary unavailable');
            } else {
                setSummary(res.data);
            }
        } finally {
            setSummarizing(false);
        }
    }, [contactId]);

    // ── Load next page (infinite scroll) ────────────────────────────────────

    const loadMore = useCallback(() => {
        if (nextCursor == null || isPending) return;
        startTransition(async () => {
            setFetchError(null);
            const res = await getContactTimeline(
                contactId,
                nextCursor,
                activeFilter ?? undefined,
            );
            if (!res.success) {
                setFetchError(res.error ?? 'Failed to load more entries.');
                return;
            }
            setEntries((prev) => [...prev, ...res.data.items]);
            setNextCursor(res.data.nextCursor);
            setHasMore(res.data.hasMore);
        });
    }, [nextCursor, isPending, contactId, activeFilter]);

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-5">
            {/* Type-filter pill row + AI summarize button (Req 14.4) */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                    role="group"
                    aria-label="Filter timeline by type"
                    className="flex flex-wrap gap-2"
                >
                    {/* "All" chip */}
                    <button
                        type="button"
                        onClick={() => {
                            if (activeFilter !== null) handleFilterToggle(activeFilter);
                        }}
                        aria-pressed={activeFilter === null}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
            ${activeFilter === null
                                ? 'bg-accent/10 text-accent border-accent/30 ring-1 ring-accent/30'
                                : 'bg-surface text-muted border-border hover:border-accent/40 hover:text-foreground'
                            }`}
                    >
                        All
                    </button>

                    {ALL_TYPES.map((type) => (
                        <FilterChip
                            key={type}
                            type={type}
                            active={activeFilter === type}
                            onToggle={handleFilterToggle}
                        />
                    ))}
                </div>

                {/* AI "Summarize Chat" button — only rendered when there are message entries */}
                {hasMessages && (
                    <button
                        type="button"
                        onClick={handleSummarize}
                        disabled={summarizing}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
                    >
                        {summarizing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Brain className="w-4 h-4" />
                        )}
                        {summarizing ? 'Summarizing…' : '✨ Summarize Chat'}
                    </button>
                )}
            </div>

            {/* AI Summary panel */}
            {summary && (
                <AiSummaryPanel
                    summary={summary}
                    onDismiss={() => setSummary(null)}
                />
            )}

            {/* Loading state when filter changed / initial load */}
            {isPending && entries.length === 0 && (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
            )}

            {/* Error state */}
            {fetchError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
                    {fetchError}
                </div>
            )}

            {/* Empty state */}
            {!isPending && entries.length === 0 && !fetchError && (
                <div className="glass-card py-16 text-center text-muted">
                    <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No timeline entries</p>
                    <p className="mt-1 text-sm">
                        {activeFilter
                            ? `No "${TYPE_CONFIG[activeFilter].label}" entries found.`
                            : 'No interactions recorded for this contact yet.'}
                    </p>
                </div>
            )}

            {/* Timeline list (Req 14.3) */}
            {entries.length > 0 && (
                <ol
                    aria-label="Contact interaction timeline"
                    className="relative border-l border-border pl-5 space-y-0"
                >
                    {entries.map((entry) => (
                        <TimelineRow key={entry.id} entry={entry} />
                    ))}

                    {/* Pending shimmer for load-more (Req 14.5) */}
                    {isPending && (
                        <li className="relative flex gap-4 pb-4">
                            <div className="absolute -left-[27px] top-2 h-3.5 w-3.5 rounded-full border-2 border-background bg-muted/40 animate-pulse" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 w-24 rounded-full bg-surface animate-pulse" />
                                <div className="h-3 w-3/4 rounded bg-surface animate-pulse" />
                            </div>
                        </li>
                    )}
                </ol>
            )}

            {/* Load-more button / end-of-list indicator (Req 14.5) */}
            {hasMore && !isPending && (
                <div className="flex justify-center pt-2">
                    <button
                        type="button"
                        onClick={loadMore}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface border border-border text-sm text-muted hover:text-foreground hover:border-accent/40 transition-all"
                    >
                        <ChevronDown className="w-4 h-4" />
                        Load more
                    </button>
                </div>
            )}

            {!hasMore && entries.length > 0 && (
                <p className="text-center text-[11px] text-muted pt-2">
                    — End of timeline —
                </p>
            )}
        </div>
    );
}
