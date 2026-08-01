'use client';

/**
 * AiMatchPanel — Req 16.4, 16.5
 *
 * Compact, reusable panel that:
 *  - Accepts an optional pre-derived `preferences` object (from a deal/lead)
 *    and/or lets the user fill a minimal inline form.
 *  - Calls `matchUnits` server action and shows ranked Available units with
 *    their match percentage.
 *  - Provides a WhatsApp "Send" action for each matched unit (Req 16.4).
 *
 * Used on:
 *  - Leads page  → inside the Lead Details modal (Req 16.4)
 *  - Deal detail → inline panel (Req 16.5)
 */

import { useState, useTransition } from 'react';
import { Sparkles, MessageSquare, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { matchUnits } from '@/app/actions/ai-matching';
import type { MatchedUnit } from '@/app/actions/ai-matching';
import { formatCurrency } from '@/lib/currency';
import { normalizePhoneForMetaUae } from '@/lib/whatsapp/phone-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiMatchPreferences {
    minBudget?: number;
    maxBudget?: number;
    type?: string | string[];
    location?: string;
}

interface Props {
    /** Pre-derived preferences from the lead / deal (all optional). */
    preferences?: AiMatchPreferences;
    /**
 * Free-text AED budget string from a lead (e.g. "800K", "2.5M").
     * If provided the panel will attempt to parse and pre-fill the budget fields.
     */
    initialBudgetText?: string;
    /** Buyer name shown in the WhatsApp message template. */
    buyerName?: string;
    /** Buyer phone for the WhatsApp send action. */
    buyerPhone?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(phone: string | undefined): string {
    return phone ? normalizePhoneForMetaUae(phone) : '';
}

function buildWhatsAppUrl(phone: string | undefined, text: string): string {
    const n = normalizePhone(phone);
    if (!n) return '';
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

function buildUnitMessage(unit: MatchedUnit, buyerName?: string): string {
    const name = buyerName ? `Hello ${buyerName}, ` : 'Hello, ';
    const unitDesc = `${unit.type} at ${unit.projectName || 'a project'}${unit.location ? `, ${unit.location}` : ''}`;
    const details = `Unit ${unit.unitNumber}, Floor ${unit.floorNumber}, ${unit.netArea} sq ft net area`;
    const price = formatCurrency(unit.totalPrice);
    return `${name}we have a great property match for you!\n\n🏠 ${unitDesc}\n📐 ${details}\n💰 ${price}\n✅ ${unit.matchPercentage}% match with your preferences\n\nInterested? Let's schedule a site visit!`;
}

const MATCH_COLOR = (pct: number) => {
    if (pct >= 80) return 'text-emerald-700 bg-emerald-500/10';
    if (pct >= 60) return 'text-amber-700 bg-amber-500/10';
    return 'text-slate-600 bg-slate-500/10';
};

const UNIT_TYPE_LABELS: Record<string, string> = {
    Studio: 'Studio', Apartment1: '1 Bedroom Apartment', Apartment2: '2 Bedroom Apartment',
    Apartment3: '3 Bedroom Apartment', Apartment4Plus: '4+ Bedroom Apartment',
    Penthouse: 'Penthouse', Villa: 'Villa', Townhouse: 'Townhouse', Duplex: 'Duplex',
    Retail: 'Retail', Office: 'Office', Warehouse: 'Warehouse', LandPlot: 'Land',
};

/**
 * Parse a free-text AED budget string (e.g. "800K", "2.5M") into a value.
 */
function parseFreeTextBudget(text: string): number | undefined {
    if (!text) return undefined;
    const cleaned = text.toLowerCase().replace(/[aed,\s]/g, '');
    const match = cleaned.match(/(\d+(?:\.\d+)?)([km])?/);
    if (!match) return undefined;
    const scale = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
    const val = Number(match[1]) * scale;
    return Number.isFinite(val) && val > 0 ? val : undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiMatchPanel({ preferences, initialBudgetText, buyerName, buyerPhone }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [results, setResults] = useState<MatchedUnit[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    // If `initialBudgetText` is provided, try to parse it as a budget ceiling
    const parsedInitialBudget = initialBudgetText ? parseFreeTextBudget(initialBudgetText) : undefined;

    // Inline form state (budget quick-override)
    const [minBudget, setMinBudget] = useState(
        preferences?.minBudget != null ? String(preferences.minBudget) : ''
    );
    const [maxBudget, setMaxBudget] = useState(
        preferences?.maxBudget != null
            ? String(preferences.maxBudget)
            : parsedInitialBudget != null
                ? String(parsedInitialBudget)
                : ''
    );

    const runMatch = () => {
        setError(null);
        const prefs: AiMatchPreferences = { ...preferences };
        if (minBudget && !Number.isNaN(Number(minBudget))) prefs.minBudget = Number(minBudget);
        if (maxBudget && !Number.isNaN(Number(maxBudget))) prefs.maxBudget = Number(maxBudget);

        startTransition(async () => {
            const res = await matchUnits(prefs);
            if (res.success) {
                setResults(res.data);
            } else {
                setError(res.error ?? 'Failed to match units');
            }
        });
    };

    return (
        <div className="rounded-xl border border-border bg-surface">
            {/* Header / trigger */}
            <button
                type="button"
                onClick={() => {
                    setExpanded((v) => !v);
                    if (!expanded && results === null && !isPending) runMatch();
                }}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-accent" />
                    AI Property Match
                    {results && results.length > 0 && (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                            {results.length} units
                        </span>
                    )}
                </span>
                {expanded ? (
                    <ChevronUp className="h-4 w-4 text-muted" />
                ) : (
                    <ChevronDown className="h-4 w-4 text-muted" />
                )}
            </button>

            {expanded && (
                <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
                    {/* Budget filter row */}
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-[110px]">
                            <label className="block text-[11px] text-muted mb-1">Min budget (AED )</label>
                            <input
                                type="number"
                                value={minBudget}
                                onChange={(e) => setMinBudget(e.target.value)}
                                placeholder="e.g. 3000000"
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
                            />
                        </div>
                        <div className="flex-1 min-w-[110px]">
                            <label className="block text-[11px] text-muted mb-1">Max budget (AED )</label>
                            <input
                                type="number"
                                value={maxBudget}
                                onChange={(e) => setMaxBudget(e.target.value)}
                                placeholder="e.g. 7000000"
                                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={runMatch}
                            disabled={isPending}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60 transition-colors"
                        >
                            {isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {isPending ? 'Matching…' : 'Match'}
                        </button>
                    </div>

                    {/* Error state */}
                    {error && (
                        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>
                    )}

                    {/* Loading skeleton */}
                    {isPending && !results && (
                        <div className="space-y-2 animate-pulse">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-16 rounded-xl bg-surface-hover" />
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!isPending && results !== null && results.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted">
                            No available units match the current preferences.
                        </p>
                    )}

                    {/* Results list */}
                    {results && results.length > 0 && (
                        <ul className="space-y-2">
                            {results.map((unit) => {
                                const waUrl = buildWhatsAppUrl(
                                    buyerPhone,
                                    buildUnitMessage(unit, buyerName)
                                );
                                return (
                                    <li
                                        key={unit.id}
                                        className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                                    >
                                        {/* Match badge */}
                                        <span
                                            className={`flex-shrink-0 rounded-full px-2 py-1 text-xs font-bold tabular-nums ${MATCH_COLOR(unit.matchPercentage)}`}
                                        >
                                            {unit.matchPercentage}%
                                        </span>

                                        {/* Unit details */}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-foreground">
                                                {UNIT_TYPE_LABELS[unit.type] ?? unit.type} — {unit.unitNumber}
                                            </p>
                                            <p className="truncate text-[11px] text-muted">
                                                {unit.projectName}
                                                {unit.location ? ` · ${unit.location}` : ''}
                                                {' · '}Floor {unit.floorNumber}
                                                {' · '}{unit.netArea} sq ft net
                                            </p>
                                            <p className="text-xs font-medium text-accent">{formatCurrency(unit.totalPrice)}</p>
                                        </div>

                                        {/* WhatsApp send */}
                                        {waUrl ? (
                                            <a
                                                href={waUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="Send via WhatsApp"
                                                className="flex-shrink-0 rounded-lg bg-emerald-500/10 p-2 text-emerald-700 hover:bg-emerald-500/20 transition-colors"
                                            >
                                                <MessageSquare className="h-4 w-4" />
                                            </a>
                                        ) : (
                                            <span
                                                title="No phone number — open lead to send"
                                                className="flex-shrink-0 rounded-lg bg-surface p-2 text-muted cursor-default"
                                            >
                                                <MessageSquare className="h-4 w-4" />
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
