'use client';

/**
 * AtRiskPanel.tsx
 *
 * Displays a collapsible "At Risk" panel listing all deals whose `isAtRisk`
 * flag is set to true. Each row shows the contact name, current AI score
 * (probability badge), deal value, and a link to the deal detail.
 *
 * Requirement 17.10: "display an 'At Risk' panel listing all deals currently
 * marked At Risk."
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { BoardDealCard } from './DealsBoard';

interface AtRiskPanelProps {
    deals: BoardDealCard[];
}

function formatAed(value: number): string {
    return `AED ${Intl.NumberFormat('en-AE', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value || 0)}`;
}

export default function AtRiskPanel({ deals }: AtRiskPanelProps) {
    const [collapsed, setCollapsed] = useState(false);

    if (deals.length === 0) return null;

    return (
        <div className="rounded-2xl border border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20">
            {/* Header */}
            <button
                type="button"
                onClick={() => setCollapsed((p) => !p)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={!collapsed}
                aria-controls="at-risk-list"
            >
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                        At Risk Deals
                    </span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                        {deals.length}
                    </span>
                </div>
                {collapsed ? (
                    <ChevronDown className="h-4 w-4 text-red-500" />
                ) : (
                    <ChevronUp className="h-4 w-4 text-red-500" />
                )}
            </button>

            {/* Deal list */}
            {!collapsed && (
                <ul
                    id="at-risk-list"
                    className="divide-y divide-red-100 dark:divide-red-900/30 px-4 pb-3"
                    role="list"
                >
                    {deals.map((deal) => (
                        <li key={deal.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                                <Link
                                    href={`/deals/${deal.id}`}
                                    className="text-sm font-medium text-foreground hover:text-accent truncate block"
                                >
                                    {deal.contactName}
                                </Link>
                                {deal.contactPhone && (
                                    <p className="text-[11px] text-muted">{deal.contactPhone}</p>
                                )}
                            </div>

                            <div className="flex flex-shrink-0 items-center gap-2">
                                {/* Probability badge (Req 17.9) */}
                                {typeof deal.aiScore === 'number' && (
                                    <span
                                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                        title="AI probability score"
                                    >
                                        {deal.aiScore}%
                                    </span>
                                )}
                                <span className="text-xs font-medium text-muted whitespace-nowrap">
                                    {formatAed(deal.value)}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
