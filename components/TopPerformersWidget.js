'use client';

/**
 * Dashboard "Top Performers" widget (Req 13.6).
 *
 * Renders the top-ranked agents for the current period and a default metric by
 * calling the gamification `getLeaderboard` server action. Visibility gating is
 * enforced server-side (Req 13.5 / A10): if the acting user's role is not
 * permitted, the action returns `forbidden` and the widget renders nothing so
 * the dashboard stays clean for restricted users.
 */

import { useEffect, useState } from 'react';
import { Trophy, Medal } from 'lucide-react';
import { getLeaderboard } from '@/app/actions/gamification';

const DEFAULT_METRIC = 'deals';

const currentPeriod = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const rankAccent = (rank) => {
    if (rank === 1) return 'text-amber-500';
    if (rank === 2) return 'text-slate-400';
    if (rank === 3) return 'text-orange-600';
    return 'text-muted';
};

const formatValue = (value) => Intl.NumberFormat('en-AE', { maximumFractionDigits: 1 }).format(value || 0);

const metricLabel = (metric) => ({
    deals: 'deals closed',
    revenue: 'revenue',
    siteVisits: 'site visits',
    calls: 'calls',
    npsScore: 'NPS score',
}[metric] || metric);

export default function TopPerformersWidget({ metric = DEFAULT_METRIC }) {
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(true);
    const [hidden, setHidden] = useState(false);
    const period = currentPeriod();

    useEffect(() => {
        let isActive = true;

        getLeaderboard({ metric, period })
            .then((res) => {
                if (!isActive) return;
                if (res.success) {
                    setRows(res.data.rows);
                } else if (res.forbidden) {
                    // Restricted by admin visibility setting -> hide the widget entirely.
                    setHidden(true);
                } else {
                    setRows([]);
                }
            })
            .catch(() => {
                if (isActive) setRows([]);
            })
            .finally(() => {
                if (isActive) setLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, [metric, period]);

    if (hidden) return null;

    return (
        <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" />
                    <div>
                         <h2 className="text-base font-semibold text-foreground">Team Performance</h2>
                         <p className="text-xs text-muted mt-0.5">Basic leaderboard analytics · {period}</p>
                     </div>
                 </div>
             </div>

            {loading ? (
                <div className="space-y-2 animate-pulse">
                    {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-surface rounded-xl" />)}
                </div>
            ) : !rows || rows.length === 0 ? (
                <div className="py-10 text-center text-muted">
                    <Trophy className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No scores recorded for this period yet.</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
                        {[
                            ['Top performer', rows[0]?.name || '—'],
                            ['Team total', formatValue(rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0))],
                            ['Agents ranked', formatValue(rows.length)],
                            ['Average per agent', formatValue(rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0) / rows.length)],
                        ].map(([label, value]) => (
                            <div key={label} className="p-3 rounded-xl bg-surface border border-border/60 min-w-0">
                                <p className="text-[10px] uppercase tracking-wide text-muted truncate">{label}</p>
                                <p className="text-sm font-semibold text-foreground truncate mt-1">{value}</p>
                            </div>
                        ))}
                    </div>
                    <div className="space-y-2">
                        {rows.slice(0, 5).map((row) => (
                            <div key={row.staffId} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface">
                                <div className={`w-7 flex items-center justify-center font-bold text-sm ${rankAccent(row.rank)}`}>
                                    {row.rank <= 3 ? <Medal className="w-4 h-4" /> : row.rank}
                                </div>
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-accent/10 text-accent flex-shrink-0">
                                    {row.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <p className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{row.name}</p>
                                <span className="text-sm font-bold text-foreground">{formatValue(row.value)} <span className="text-[10px] font-normal text-muted">{metricLabel(metric)}</span></span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
