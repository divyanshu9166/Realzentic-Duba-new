'use client';

/**
 * Team Leaderboard & Gamification page (Module 10, Req 13.3 / 13.5).
 *
 * Renders, for a selected metric and period:
 *   - a ranked table of agents (via `getLeaderboard`),
 *   - an agent scorecard for the selected row, and
 *   - a badges panel showing all badge definitions (`listBadges`) and the
 *     badges the selected agent has earned for the period (`getAgentBadges`).
 *
 * Visibility gating (Req 13.5 / A10) is enforced server-side: `getLeaderboard`
 * returns `forbidden` when the acting user's role is not permitted, and the
 * page shows a restricted-access state instead of leaderboard data.
 */

import { useEffect, useState, useCallback } from 'react';
import { Trophy, Medal, Award, ShieldAlert, BarChart3, Star } from 'lucide-react';
import { getLeaderboard, getAgentBadges, listBadges } from '@/app/actions/gamification';

const METRIC_OPTIONS = [
    { value: 'deals', label: 'Deals Closed' },
    { value: 'revenue', label: 'Revenue' },
    { value: 'siteVisits', label: 'Site Visits' },
    { value: 'calls', label: 'Calls' },
    { value: 'npsScore', label: 'NPS Score' },
];

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

const initials = (name) =>
    (name || '?')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

const formatValue = (value, metric) => {
    if (metric === 'revenue') {
        return `AED ${Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`;
    }
    return Intl.NumberFormat('en-AE', { maximumFractionDigits: 1 }).format(value || 0);
};

export default function LeaderboardPage() {
    const [metric, setMetric] = useState('deals');
    const [period, setPeriod] = useState(currentPeriod);
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState(null);

    const [selectedId, setSelectedId] = useState(null);
    const [badges, setBadges] = useState([]);
    const [agentBadges, setAgentBadges] = useState([]);
    const [badgesLoading, setBadgesLoading] = useState(false);

    const metricLabel = METRIC_OPTIONS.find((m) => m.value === metric)?.label || metric;

    // Load the ranked leaderboard whenever metric or period changes.
    useEffect(() => {
        let isActive = true;
        setLoading(true);
        setForbidden(false);
        setError(null);

        getLeaderboard({ metric, period })
            .then((res) => {
                if (!isActive) return;
                if (res.success) {
                    setRows(res.data.rows);
                    // Keep selection if still present, else select the top agent.
                    setSelectedId((prev) => {
                        const stillThere = res.data.rows.some((r) => r.staffId === prev);
                        return stillThere ? prev : res.data.rows[0]?.staffId ?? null;
                    });
                } else if (res.forbidden) {
                    setForbidden(true);
                    setRows([]);
                } else {
                    setError(res.error || 'Failed to load leaderboard.');
                    setRows([]);
                }
            })
            .catch(() => {
                if (isActive) setError('Failed to load leaderboard.');
            })
            .finally(() => {
                if (isActive) setLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, [metric, period]);

    // Load all badge definitions once.
    useEffect(() => {
        let isActive = true;
        listBadges()
            .then((res) => {
                if (isActive && res.success) setBadges(res.data);
            })
            .catch(() => { });
        return () => {
            isActive = false;
        };
    }, []);

    // Load the selected agent's earned badges for the period.
    const loadAgentBadges = useCallback(() => {
        if (!selectedId) {
            setAgentBadges([]);
            return;
        }
        let isActive = true;
        setBadgesLoading(true);
        getAgentBadges(selectedId, period)
            .then((res) => {
                if (isActive && res.success) setAgentBadges(res.data);
            })
            .catch(() => { })
            .finally(() => {
                if (isActive) setBadgesLoading(false);
            });
        return () => {
            isActive = false;
        };
    }, [selectedId, period]);

    useEffect(() => {
        const cleanup = loadAgentBadges();
        return cleanup;
    }, [loadAgentBadges]);

    const selectedRow = rows?.find((r) => r.staffId === selectedId) || null;
    const earnedBadgeIds = new Set(agentBadges.map((ab) => ab.badgeId));

    return (
        <div className="space-y-6 animate-[fade-in_0.5s_ease-out]">
            {/* Page Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Trophy className="w-6 h-6 text-amber-500" />
                        <h1 className="text-xl md:text-2xl font-bold text-foreground">Team Leaderboard</h1>
                    </div>
                    <p className="text-xs md:text-sm text-muted mt-1">Ranked by {metricLabel} · {period}</p>
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="block text-[10px] uppercase tracking-wide text-muted mb-1">Metric</label>
                        <select
                            value={metric}
                            onChange={(e) => setMetric(e.target.value)}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                        >
                            {METRIC_OPTIONS.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-wide text-muted mb-1">Period</label>
                        <input
                            type="month"
                            value={period}
                            onChange={(e) => e.target.value && setPeriod(e.target.value)}
                            className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                        />
                    </div>
                </div>
            </div>

            {/* Restricted-access state (Req 13.5 / A10) */}
            {forbidden ? (
                <div className="glass-card py-16 text-center text-muted">
                    <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium text-foreground">Leaderboard access is restricted</p>
                    <p className="text-sm mt-1">An administrator has limited who can view the leaderboard.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
                    {/* Ranked table (Req 13.3) */}
                    <div className="lg:col-span-2 glass-card p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-accent" />
                                <h2 className="text-base font-semibold text-foreground">Rankings</h2>
                            </div>
                        </div>

                        {error && (
                            <div className="mb-3 p-3 rounded-lg bg-danger-light text-danger text-sm">{error}</div>
                        )}

                        {loading ? (
                            <div className="space-y-2 animate-pulse">
                                {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-surface rounded-xl" />)}
                            </div>
                        ) : !rows || rows.length === 0 ? (
                            <div className="py-12 text-center text-muted">
                                <Trophy className="w-10 h-10 mx-auto mb-2 opacity-20" />
                                <p className="text-sm">No scores recorded for this period yet.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-border">
                                            <th className="py-2 pr-2 font-medium w-12">Rank</th>
                                            <th className="py-2 px-2 font-medium">Agent</th>
                                            <th className="py-2 pl-2 font-medium text-right">{metricLabel}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => {
                                            const isSelected = row.staffId === selectedId;
                                            return (
                                                <tr
                                                    key={row.staffId}
                                                    onClick={() => setSelectedId(row.staffId)}
                                                    className={`cursor-pointer border-b border-border/60 transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}
                                                >
                                                    <td className="py-2.5 pr-2">
                                                        <span className={`inline-flex items-center justify-center font-bold ${rankAccent(row.rank)}`}>
                                                            {row.rank <= 3 ? <Medal className="w-4 h-4" /> : row.rank}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-2">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-accent/10 text-accent flex-shrink-0">
                                                                {initials(row.name)}
                                                            </div>
                                                            <span className="font-medium text-foreground truncate">{row.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 pl-2 text-right font-bold text-foreground">{formatValue(row.value, metric)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Agent scorecard + badges panel (Req 13.3) */}
                    <div className="space-y-4 md:space-y-5">
                        {/* Agent scorecard */}
                        <div className="glass-card p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <Star className="w-5 h-5 text-amber-500" />
                                <h2 className="text-base font-semibold text-foreground">Agent Scorecard</h2>
                            </div>
                            {!selectedRow ? (
                                <p className="text-sm text-muted text-center py-8">Select an agent to view their scorecard.</p>
                            ) : (
                                <div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold bg-accent/10 text-accent flex-shrink-0">
                                            {initials(selectedRow.name)}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-foreground truncate">{selectedRow.name}</p>
                                            <p className="text-xs text-muted">Rank #{selectedRow.rank} · {period}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mt-4">
                                        <div className="p-3 rounded-xl bg-surface text-center">
                                            <p className="text-[10px] uppercase tracking-wide text-muted">{metricLabel}</p>
                                            <p className="text-lg font-bold text-foreground mt-0.5">{formatValue(selectedRow.value, metric)}</p>
                                        </div>
                                        <div className="p-3 rounded-xl bg-surface text-center">
                                            <p className="text-[10px] uppercase tracking-wide text-muted">Badges</p>
                                            <p className="text-lg font-bold text-foreground mt-0.5">{agentBadges.length}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Badges panel */}
                        <div className="glass-card p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <Award className="w-5 h-5 text-purple" />
                                <h2 className="text-base font-semibold text-foreground">Badges</h2>
                            </div>
                            {badges.length === 0 ? (
                                <p className="text-sm text-muted text-center py-6">No badges defined yet.</p>
                            ) : badgesLoading && selectedId ? (
                                <div className="space-y-2 animate-pulse">
                                    {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-surface rounded-xl" />)}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {badges.map((badge) => {
                                        const earned = earnedBadgeIds.has(badge.id);
                                        return (
                                            <div
                                                key={badge.id}
                                                className={`flex items-center gap-3 p-2.5 rounded-xl border transition-colors ${earned ? 'bg-amber-500/10 border-amber-500/30' : 'bg-surface border-border/60 opacity-60'}`}
                                            >
                                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${earned ? 'bg-amber-500/20 text-amber-600' : 'bg-border/50 text-muted'}`}>
                                                    {badge.icon ? <span className="text-base">{badge.icon}</span> : <Award className="w-4 h-4" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-medium text-foreground truncate">{badge.name}</p>
                                                        {badge.tier && (
                                                            <span className="badge bg-purple-light text-purple text-[10px]">{badge.tier}</span>
                                                        )}
                                                    </div>
                                                    {badge.description && (
                                                        <p className="text-[11px] text-muted truncate">{badge.description}</p>
                                                    )}
                                                </div>
                                                {earned && (
                                                    <span className="badge bg-success-light text-success text-[10px] flex-shrink-0">Earned</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {selectedId && badges.length > 0 && (
                                <p className="text-[11px] text-muted mt-3">
                                    Showing badges earned by {selectedRow?.name || 'agent'} for {period}.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
