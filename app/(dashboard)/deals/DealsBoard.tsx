'use client';

/**
 * Deal pipeline Kanban board (Req 4.5, 4.6, 17.9, 17.10).
 *
 * Renders one droppable column per DealStage and a draggable card per deal
 * using `@dnd-kit`. On drop the card is moved optimistically into the target
 * column (so the UI reflects the change well within the 2s budget, Req 4.5)
 * and `moveDeal` is called. If the server rejects the move, the card is
 * returned to its original column and an error toast is shown (Req 4.6).
 *
 * A move into a lost stage requires a lost reason; the board collects one
 * before applying the optimistic change so the server rule (Req 4.9) is met.
 *
 * Each deal card shows a probability badge (Req 17.9). A toolbar above the
 * board lets the user sort deals by score (asc/desc/default) and filter to
 * show only deals at or above a minimum score threshold (Req 17.10).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { Flame, AlertTriangle, Phone, Home, User, ReceiptText, ArrowUpDown, Filter, X } from 'lucide-react';
import { toast } from 'sonner';
import { moveDeal } from '@/app/actions/deals';

// ---------------------------------------------------------------------------
// Sort / filter types
// ---------------------------------------------------------------------------

type ScoreSort = 'default' | 'score-asc' | 'score-desc';
type ScoreFilter = 'all' | 'scored-only' | number; // number = min score threshold

export interface BoardDealCard {
    id: number;
    stageId: number;
    value: number;
    contactName: string;
    contactPhone: string | null;
    unitNumber: string | null;
    agentName: string | null;
    aiScore: number | null;
    isHot: boolean;
    isAtRisk: boolean;
    expectedCloseDate: string | null;
    source: string | null;
    hasBooking: boolean;
    daysInStage: number;
    lastActivityAt: string;
}

export interface BoardColumn {
    id: number;
    name: string;
    order: number;
    color: string;
    isWon: boolean;
    isLost: boolean;
    deals: BoardDealCard[];
}

function formatAed(value: number): string {
    return `AED ${Intl.NumberFormat('en-AE', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value || 0)}`;
}

function DealCardBody({ deal }: { deal: BoardDealCard }) {
    return (
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground truncate">{deal.contactName}</p>
                <span className="text-xs font-bold text-accent whitespace-nowrap">{formatAed(deal.value)}</span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                {deal.contactPhone && (
                    <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {deal.contactPhone}
                    </span>
                )}
                {deal.unitNumber && (
                    <span className="flex items-center gap-1">
                        <Home className="h-3 w-3" />
                        {deal.unitNumber}
                    </span>
                )}
                {deal.agentName && (
                    <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {deal.agentName}
                    </span>
                )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${deal.daysInStage >= 14 ? 'bg-amber-500/10 text-amber-700' : 'bg-muted/10 text-muted'}`}>
                    {deal.daysInStage}d in stage
                </span>
                {deal.isHot && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-600">
                        <Flame className="h-3 w-3" /> Hot
                    </span>
                )}
                {deal.isAtRisk && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" /> At risk
                    </span>
                )}
                {deal.hasBooking && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                        <ReceiptText className="h-3 w-3" /> Booked
                    </span>
                )}
                {/* Probability badge — Req 17.9 */}
                {typeof deal.aiScore === 'number' && (
                    <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${deal.aiScore > 80
                            ? 'bg-emerald-500/10 text-emerald-700'
                            : deal.aiScore < 30
                                ? 'bg-red-500/10 text-red-700'
                                : 'bg-accent/10 text-accent'
                            }`}
                        title="AI deal probability score"
                    >
                        {deal.aiScore}%
                    </span>
                )}
            </div>
        </div>
    );
}

function DraggableCard({
    deal,
    onOpen,
}: {
    deal: BoardDealCard;
    onOpen: (id: number) => void;
}) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `deal-${deal.id}`,
        data: { dealId: deal.id, fromStageId: deal.stageId },
    });

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(deal.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(deal.id);
                }
            }}
            className={`cursor-grab touch-none outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent rounded-xl ${isDragging ? 'opacity-40' : 'opacity-100'
                }`}
        >
            <DealCardBody deal={deal} />
        </div>
    );
}

function Column({
    column,
    sortedFilteredDeals,
    onOpenDeal,
}: {
    column: BoardColumn;
    sortedFilteredDeals: BoardDealCard[];
    onOpenDeal: (id: number) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `stage-${column.id}`,
        data: { stageId: column.id },
    });

    const total = sortedFilteredDeals.reduce((sum, d) => sum + d.value, 0);
    const totalAll = column.deals.reduce((sum, d) => sum + d.value, 0);
    const isFiltered = sortedFilteredDeals.length !== column.deals.length;

    return (
        <div className="flex w-72 flex-shrink-0 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 min-w-0">
                    <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: column.color }}
                    />
                    <span className="text-sm font-semibold text-foreground truncate">{column.name}</span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {isFiltered
                            ? `${sortedFilteredDeals.length}/${column.deals.length}`
                            : column.deals.length}
                    </span>
                </div>
                <span className="text-[11px] text-muted whitespace-nowrap" title={isFiltered ? `Filtered total: ${formatAed(total)} / All: ${formatAed(totalAll)}` : undefined}>
                    {formatAed(total)}
                </span>
            </div>

            <div
                ref={setNodeRef}
                className={`flex min-h-[60vh] flex-1 flex-col gap-2 rounded-2xl border border-dashed p-2 transition-colors ${isOver ? 'border-accent bg-accent/5' : 'border-border bg-surface/40'
                    }`}
            >
                {sortedFilteredDeals.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-muted">
                        {column.deals.length === 0 ? 'Drop deals here' : 'No deals match the filter'}
                    </div>
                ) : (
                    sortedFilteredDeals.map((deal) => (
                        <DraggableCard key={deal.id} deal={deal} onOpen={onOpenDeal} />
                    ))
                )}
            </div>
        </div>
    );
}

export default function DealsBoard({ initialColumns }: { initialColumns: BoardColumn[] }) {
    const router = useRouter();
    const [columns, setColumns] = useState<BoardColumn[]>(initialColumns);
    const [activeDeal, setActiveDeal] = useState<BoardDealCard | null>(null);

    // ── Sort / filter state (Req 17.10) ────────────────────────────────────
    const [scoreSort, setScoreSort] = useState<ScoreSort>('default');
    const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
    const [minScoreInput, setMinScoreInput] = useState('');
    const [staleOnly, setStaleOnly] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    );

    const dealsById = useMemo(() => {
        const map = new Map<number, BoardDealCard>();
        for (const col of columns) {
            for (const deal of col.deals) map.set(deal.id, deal);
        }
        return map;
    }, [columns]);

    /**
     * Derive the sorted + filtered deal list for a column.
     * Sort and filter are applied purely for display; the underlying `columns`
     * state (and drag-drop) always operate on the full unfiltered list so that
     * filtered-out cards can still be dropped and don't disappear from the board.
     */
    function getSortedFiltered(deals: BoardDealCard[]): BoardDealCard[] {
        // 1. Filter
        let filtered = deals;
        if (scoreFilter === 'scored-only') {
            filtered = deals.filter((d) => d.aiScore !== null);
        } else if (typeof scoreFilter === 'number') {
            filtered = deals.filter((d) => d.aiScore !== null && d.aiScore >= scoreFilter);
        }
        if (staleOnly) filtered = filtered.filter((d) => d.daysInStage >= 14);

        // 2. Sort
        if (scoreSort === 'score-asc') {
            filtered = [...filtered].sort(
                (a, b) => (a.aiScore ?? -1) - (b.aiScore ?? -1),
            );
        } else if (scoreSort === 'score-desc') {
            filtered = [...filtered].sort(
                (a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1),
            );
        }
        return filtered;
    }

    /** Whether any sort/filter is active. */
    const hasActiveControls = scoreSort !== 'default' || scoreFilter !== 'all' || staleOnly;

    function clearControls() {
        setScoreSort('default');
        setScoreFilter('all');
        setMinScoreInput('');
        setStaleOnly(false);
    }

    function applyMinScore() {
        const n = parseInt(minScoreInput, 10);
        if (!Number.isNaN(n) && n >= 0 && n <= 100) {
            setScoreFilter(n);
        } else {
            setScoreFilter('all');
        }
    }

    function handleDragStart(event: DragStartEvent) {
        const dealId = event.active.data.current?.dealId as number | undefined;
        if (typeof dealId === 'number') {
            setActiveDeal(dealsById.get(dealId) ?? null);
        }
    }

    async function handleDragEnd(event: DragEndEvent) {
        setActiveDeal(null);
        const { active, over } = event;
        if (!over) return;

        const dealId = active.data.current?.dealId as number | undefined;
        const fromStageId = active.data.current?.fromStageId as number | undefined;
        const toStageId = over.data.current?.stageId as number | undefined;

        if (typeof dealId !== 'number' || typeof toStageId !== 'number') return;
        if (fromStageId === toStageId) return;

        const targetColumn = columns.find((c) => c.id === toStageId);
        if (!targetColumn) return;

        // A move into a lost stage needs a lost reason up front (Req 4.9).
        let lostReason: string | undefined;
        if (targetColumn.isLost) {
            const entered = window.prompt(`Reason for marking this deal lost in "${targetColumn.name}":`);
            if (entered == null || entered.trim() === '') {
                toast.error('A lost reason is required to move a deal to a lost stage.');
                return;
            }
            lostReason = entered.trim();
        }

        // Snapshot for revert-on-failure (Req 4.6).
        const snapshot = columns;
        const movedCard = dealsById.get(dealId);
        if (!movedCard) return;

        // Optimistic move (Req 4.5).
        setColumns((prev) =>
            prev.map((col) => {
                if (col.id === fromStageId) {
                    return { ...col, deals: col.deals.filter((d) => d.id !== dealId) };
                }
                if (col.id === toStageId) {
                    return {
                        ...col,
                        deals: [{ ...movedCard, stageId: toStageId }, ...col.deals],
                    };
                }
                return col;
            }),
        );

        try {
            const res = await moveDeal(dealId, toStageId, lostReason);
            if (!res.success) {
                // Revert and surface the server error (Req 4.6).
                setColumns(snapshot);
                toast.error(res.error ?? 'Could not move the deal. Please try again.');
                return;
            }
            toast.success(`Moved to "${targetColumn.name}".`);
        } catch {
            setColumns(snapshot);
            toast.error('Could not move the deal. Please try again.');
        }
    }

    function openDeal(id: number) {
        router.push(`/deals/${id}`);
    }

    if (columns.length === 0) {
        return (
            <div className="glass-card py-16 text-center text-muted">
                <p className="font-medium">No pipeline stages configured yet</p>
                <p className="mt-1 text-sm">Create deal stages to start tracking deals on the board.</p>
            </div>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDeal(null)}
        >
            {/* Sort / filter toolbar (Req 17.10) */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2">
                {/* Sort */}
                <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="h-3.5 w-3.5 text-muted" />
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide">Sort by score</span>
                    <select
                        value={scoreSort}
                        onChange={(e) => setScoreSort(e.target.value as ScoreSort)}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                        aria-label="Sort deals by AI score"
                    >
                        <option value="default">Default</option>
                        <option value="score-desc">Highest first</option>
                        <option value="score-asc">Lowest first</option>
                    </select>
                </div>

                {/* Filter */}
                <div className="flex items-center gap-1.5">
                    <Filter className="h-3.5 w-3.5 text-muted" />
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wide">Filter</span>
                    <select
                        value={typeof scoreFilter === 'number' ? 'custom' : scoreFilter}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'all' || v === 'scored-only') {
                                setScoreFilter(v as ScoreFilter);
                                setMinScoreInput('');
                            }
                            // 'custom' handled by the number input below
                        }}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                        aria-label="Filter deals by AI score"
                    >
                        <option value="all">All deals</option>
                        <option value="scored-only">Scored only</option>
                        {typeof scoreFilter === 'number' && (
                            <option value="custom">Score ≥ {scoreFilter}</option>
                        )}
                    </select>
                </div>

                {/* Min score input */}
                <div className="flex items-center gap-1">
                    <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="Min score"
                        value={minScoreInput}
                        onChange={(e) => setMinScoreInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && applyMinScore()}
                        className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                        aria-label="Minimum score threshold"
                    />
                    <button
                        type="button"
                        onClick={applyMinScore}
                        className="rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
                    >
                        Apply
                    </button>
                </div>

                <button type="button" onClick={() => setStaleOnly((value) => !value)} className={`rounded-lg px-2 py-1 text-[11px] font-medium ${staleOnly ? 'bg-amber-500/15 text-amber-700' : 'border border-border text-muted'}`}>
                    {staleOnly ? 'Showing stale (14d+)' : 'Show stale deals'}
                </button>

                {/* Clear */}
                {hasActiveControls && (
                    <button
                        type="button"
                        onClick={clearControls}
                        className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted hover:text-foreground transition-colors"
                        aria-label="Clear sort and filter"
                    >
                        <X className="h-3.5 w-3.5" />
                        Clear
                    </button>
                )}
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4">
                {columns.map((column) => (
                    <Column
                        key={column.id}
                        column={column}
                        sortedFilteredDeals={getSortedFiltered(column.deals)}
                        onOpenDeal={openDeal}
                    />
                ))}
            </div>

            <DragOverlay>
                {activeDeal ? (
                    <div className="w-72 rotate-2">
                        <DealCardBody deal={activeDeal} />
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
