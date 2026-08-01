'use client';

/**
 * Dashboard "Overdue Collections" widget (Req 9.6).
 *
 * Calls the `getOverdueCollections` server action and shows the count of
 * overdue milestones and the sum of their unpaid amounts. The server derives
 * each milestone's overdue status from payment + due date, so the figures stay
 * consistent with the booking engine. Links through to the deals pipeline for
 * follow-up.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Banknote } from 'lucide-react';
import { getOverdueCollections } from '@/app/actions/deals';

const formatAed = (value) =>
    `AED ${Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(value || 0)}`;

export default function OverdueCollectionsWidget() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isActive = true;

        getOverdueCollections()
            .then((res) => {
                if (!isActive) return;
                setData(res.success && res.data ? res.data : { count: 0, sumUnpaid: 0 });
            })
            .catch(() => {
                if (isActive) setData({ count: 0, sumUnpaid: 0 });
            })
            .finally(() => {
                if (isActive) setLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, []);

    const count = data?.count ?? 0;
    const sumUnpaid = data?.sumUnpaid ?? 0;
    const hasOverdue = count > 0;

    return (
        <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-5 h-5 ${hasOverdue ? 'text-red-500' : 'text-emerald-500'}`} />
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Overdue Collections</h2>
                        <p className="text-xs text-muted mt-0.5">Milestones past their due date</p>
                    </div>
                </div>
                <Link
                    href="/deals"
                    className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 transition-colors"
                >
                    View deals <ArrowRight className="w-3.5 h-3.5" />
                </Link>
            </div>

            {loading ? (
                <div className="grid grid-cols-2 gap-3 animate-pulse">
                    <div className="h-20 bg-surface rounded-xl" />
                    <div className="h-20 bg-surface rounded-xl" />
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-surface p-4">
                        <p className="text-xs text-muted">Overdue milestones</p>
                        <p className={`mt-1 text-2xl font-bold ${hasOverdue ? 'text-red-600' : 'text-foreground'}`}>
                            {count}
                        </p>
                    </div>
                    <div className="rounded-xl bg-surface p-4">
                        <p className="text-xs text-muted">Unpaid amount</p>
                        <p
                            className={`mt-1 flex items-center text-2xl font-bold ${hasOverdue ? 'text-red-600' : 'text-foreground'}`}
                        >
                            <Banknote className="w-5 h-5" />
                            {Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(sumUnpaid)}
                        </p>
                    </div>
                </div>
            )}

            {!loading && !hasOverdue && (
                <p className="mt-3 text-xs text-emerald-700">All milestones are on track. Nothing overdue.</p>
            )}
            {!loading && hasOverdue && (
                <p className="mt-3 text-xs text-muted">
                    {count} milestone{count === 1 ? '' : 's'} totaling {formatAed(sumUnpaid)} require follow-up.
                </p>
            )}
        </div>
    );
}
