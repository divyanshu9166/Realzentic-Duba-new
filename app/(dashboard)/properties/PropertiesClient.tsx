'use client';

/**
 * Properties & Inventory client (Req 1.6, 2.8).
 *
 * Renders:
 *   - Project card grid (photo, name, location, DLD Registration badge, unit count, % sold)
 *   - Analytics tab with inventory KPIs per project (Req 2.8)
 *   - Links to per-project detail pages (tower tabs + floor grid, Req 1.7)
 *
 * Requirements: 1.6, 2.8
 */

import { useState } from 'react';
import Link from 'next/link';
import {
    Building2,
    MapPin,
    BarChart3,
    Search,
    ShieldCheck,
    TrendingUp,
    Home,
    LayoutGrid,
    BadgeCheck,
    AlertTriangle,
    CheckCircle2,
    Filter,
} from 'lucide-react';
import { getInventoryAnalytics } from '@/app/actions/properties';
import type { InventoryAnalytics } from '@/lib/inventory';
import NewProjectButton from './NewProjectButton';

export interface ProjectCardRow {
    id: number;
    name: string;
    location: string;
    city: string;
    emirate: string;
    dldProjectRegNo: string | null;
    dldProjectRegExpiry: string | null;
    escrowAccountNo: string | null;
    trakheesiPermitNo: string | null;
    saleType: string | null;
    type: string;
    status: string;
    builderName: string | null;
    locationConfirmed: boolean;
    photoUrl: string | null;
    unitCount: number;
    percentSold: number;
    availableUnitCount: number;
    blockedUnitCount: number;
    bookedUnitCount: number;
    soldUnitCount: number;
    mortgagedUnitCount: number;
    inventoryMismatch: boolean;
    goldenVisaEligibleUnitCount: number;
}

interface AnalyticsRow extends InventoryAnalytics {
    projectId: number;
    projectName: string;
}

const tabs = [
    { id: 'grid', label: 'Projects', icon: LayoutGrid },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
] as const;

type Tab = (typeof tabs)[number]['id'];

function formatAed(n: number): string {
    return `AED ${Intl.NumberFormat('en-AE', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(n)}`;
}

/** Color-coded sold-percentage pill. */
function SoldPill({ pct }: { pct: number }) {
    const color =
        pct >= 80
            ? 'bg-emerald-500/10 text-emerald-700'
            : pct >= 40
                ? 'bg-amber-500/10 text-amber-700'
                : 'bg-surface-hover text-muted';
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`}>
            {pct}% sold
        </span>
    );
}

function labelize(value: string | null | undefined): string {
    if (!value) return 'Not set';
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function projectNeedsAttention(project: ProjectCardRow): boolean {
    return !project.locationConfirmed
        || !project.dldProjectRegNo
        || !project.trakheesiPermitNo
        || (project.saleType === 'Off-Plan (Primary)' && !project.escrowAccountNo)
        || project.inventoryMismatch;
}

function ProjectCard({ project }: { project: ProjectCardRow }) {
    return (
        <Link
            href={`/properties/${project.id}`}
            className="glass-card flex flex-col overflow-hidden group hover:shadow-md transition-all tap-press"
        >
            {/* Photo */}
            <div className="h-40 bg-surface-light flex items-center justify-center overflow-hidden">
                {project.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={project.photoUrl}
                        alt={project.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                ) : (
                    <Building2 className="w-12 h-12 text-muted/30" />
                )}
            </div>

            {/* Content */}
            <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
                        {project.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                        <SoldPill pct={project.percentSold} />
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{labelize(project.type)}</span>
                    <span className="rounded-md border border-border bg-surface-light px-2 py-0.5 text-[11px] font-medium text-muted">{labelize(project.status)}</span>
                    {project.saleType && <span className="rounded-md border border-border bg-surface-light px-2 py-0.5 text-[11px] font-medium text-muted">{project.saleType}</span>}
                </div>

                <div className="flex items-center gap-1 text-xs text-muted">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                        {project.location}, {project.city}
                    </span>
                </div>

                <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                    {project.dldProjectRegNo && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-[11px] font-medium">
                            <ShieldCheck className="w-3 h-3" /> DLD Registration
                        </span>
                    )}
                    {project.goldenVisaEligibleUnitCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 text-[11px] font-medium">
                            <BadgeCheck className="w-3 h-3" />
                            {project.goldenVisaEligibleUnitCount} Golden Visa eligible
                        </span>
                    )}
                    <span className="text-[11px] text-muted flex items-center gap-1">
                        <Home className="w-3 h-3" />
                        {project.unitCount} unit{project.unitCount !== 1 ? 's' : ''}
                    </span>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-light/70 p-2 text-[10px]">
                    <div><p className="text-muted">Available</p><p className="mt-0.5 text-sm font-semibold text-emerald-700">{project.availableUnitCount}</p></div>
                    <div><p className="text-muted">On hold</p><p className="mt-0.5 text-sm font-semibold text-amber-700">{project.blockedUnitCount}</p></div>
                    <div><p className="text-muted">Booked / sold</p><p className="mt-0.5 text-sm font-semibold text-blue-700">{project.bookedUnitCount + project.soldUnitCount}</p></div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    {project.locationConfirmed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Location confirmed</span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" /> Location needs setup</span>
                    )}
                    {project.trakheesiPermitNo ? <span className="text-muted">Permit recorded</span> : <span className="text-amber-700">Permit missing</span>}
                    {project.inventoryMismatch && <span className="text-amber-700">Count mismatch</span>}
                </div>

                {/* Progress bar */}
                <div className="mt-auto pt-2">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted">Inventory sold</span>
                        <span className="text-[10px] font-medium text-foreground">{project.percentSold}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-light rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent rounded-full transition-all"
                            style={{ width: `${project.percentSold}%` }}
                        />
                    </div>
                </div>
            </div>
        </Link>
    );
}

function EmptyEmirate({ search }: { search: string }) {
    return (
        <div className="glass-card py-20 text-center text-muted col-span-full">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            {search ? (
                <>
                    <p className="font-medium">No projects match &ldquo;{search}&rdquo;</p>
                    <p className="mt-1 text-sm">Try a different search term.</p>
                </>
            ) : (
                <>
                    <p className="font-medium">No projects yet</p>
                    <p className="mt-1 text-sm">Create a project to start managing inventory.</p>
                </>
            )}
        </div>
    );
}

// ─── Analytics tab ──────────────────────────────────────────────────────────

function AnalyticsCard({ row }: { row: AnalyticsRow }) {
    return (
        <div className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
                <Link
                    href={`/properties/${row.projectId}`}
                    className="text-sm font-semibold text-foreground hover:text-accent transition-colors line-clamp-1"
                >
                    {row.projectName}
                </Link>
                <SoldPill pct={row.percentSold} />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <p className="text-[10px] text-muted uppercase tracking-wide">Revenue Potential</p>
                    <p className="text-base font-bold text-foreground mt-0.5">
                        {formatAed(row.revenuePotential)}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-muted uppercase tracking-wide">Available Stock Value</p>
                    <p className="text-base font-bold text-foreground mt-0.5">
                        {formatAed(row.availableStockValue)}
                    </p>
                </div>
            </div>

            {/* Mini bar */}
            <div>
                <div className="h-2 bg-surface-light rounded-full overflow-hidden">
                    <div
                        className="h-full bg-accent rounded-full"
                        style={{ width: `${row.percentSold}%` }}
                    />
                </div>
                <p className="text-[10px] text-muted mt-1">
                    {row.percentSold}% sold — {(100 - row.percentSold)}% available
                </p>
            </div>
        </div>
    );
}

function AnalyticsPanel({ projects }: { projects: ProjectCardRow[] }) {
    const [rows, setRows] = useState<AnalyticsRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadAnalytics() {
        setLoading(true);
        setError(null);
        try {
            const results = await Promise.all(
                projects.map(async (p) => {
                    const res = await getInventoryAnalytics(p.id);
                    if (!res.success) return null;
                    return { ...res.data, projectId: p.id, projectName: p.name } as AnalyticsRow;
                }),
            );
            setRows(results.filter((r): r is AnalyticsRow => r !== null));
        } catch {
            setError('Failed to load analytics. Please try again.');
        }
        setLoading(false);
        setLoaded(true);
    }

    if (!loaded) {
        return (
            <div className="text-center py-16">
                <TrendingUp className="w-10 h-10 mx-auto mb-3 text-accent opacity-60" />
                <p className="text-sm text-muted mb-4">Load analytics for all {projects.length} project{projects.length !== 1 ? 's' : ''}.</p>
                <button
                    onClick={loadAnalytics}
                    disabled={loading || projects.length === 0}
                    className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all"
                >
                    {loading ? 'Loading…' : 'Load Analytics'}
                </button>
                {projects.length === 0 && (
                    <p className="mt-3 text-xs text-muted">No projects to analyze.</p>
                )}
            </div>
        );
    }

    if (error) {
        return (
            <div className="glass-card py-12 text-center text-muted">
                <p className="font-medium text-danger">{error}</p>
                <button onClick={loadAnalytics} className="mt-4 px-4 py-2 bg-surface border border-border rounded-xl text-sm text-foreground hover:bg-surface-hover transition-colors">
                    Retry
                </button>
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="glass-card py-12 text-center text-muted">
                <p className="font-medium">No analytics data available</p>
                <p className="mt-1 text-sm">Add units to projects to see analytics.</p>
            </div>
        );
    }

    // Summary totals
    const totalRevenue = rows.reduce((s, r) => s + r.revenuePotential, 0);
    const totalAvailable = rows.reduce((s, r) => s + r.availableStockValue, 0);
    const avgSold = rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.percentSold, 0) / rows.length)
        : 0;

    return (
        <div className="space-y-5">
            {/* Summary row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                    { label: 'Total Revenue Potential', value: formatAed(totalRevenue), tint: 'text-accent bg-accent/10', Icon: BarChart3 },
                    { label: 'Available Stock Value', value: formatAed(totalAvailable), tint: 'text-info bg-info-light', Icon: TrendingUp },
                    { label: 'Avg % Sold', value: `${avgSold}%`, tint: 'text-success bg-success-light', Icon: Building2 },
                ].map(({ label, value, tint, Icon }) => (
                    <div key={label} className="glass-card p-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-muted">{label}</span>
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>
                                <Icon className="w-4 h-4" />
                            </span>
                        </div>
                        <p className="text-xl font-bold text-foreground">{value}</p>
                    </div>
                ))}
            </div>

            {/* Per-project cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rows.map((row) => (
                    <AnalyticsCard key={row.projectId} row={row} />
                ))}
            </div>
        </div>
    );
}

// ─── Root client component ───────────────────────────────────────────────────

export default function PropertiesClient({ projects }: { projects: ProjectCardRow[] }) {
    const [tab, setTab] = useState<Tab>('grid');
    const [search, setSearch] = useState('');
    const [emirate, setEmirate] = useState('');
    const [projectStatus, setProjectStatus] = useState('');
    const [saleType, setSaleType] = useState('');
    const [needsAttention, setNeedsAttention] = useState(false);

    const portfolio = projects.reduce((summary, project) => ({
        units: summary.units + project.unitCount,
        available: summary.available + project.availableUnitCount,
        held: summary.held + project.blockedUnitCount,
        closed: summary.closed + project.bookedUnitCount + project.soldUnitCount,
        attention: summary.attention + (projectNeedsAttention(project) ? 1 : 0),
    }), { units: 0, available: 0, held: 0, closed: 0, attention: 0 });

    const emirates = Array.from(new Set(projects.map((project) => project.emirate).filter(Boolean))).sort();
    const hasFilters = Boolean(search || emirate || projectStatus || saleType || needsAttention);

    const filtered = projects.filter(
        (p) =>
            (!search || [p.name, p.city, p.location, p.emirate, p.builderName ?? '', p.dldProjectRegNo ?? '', p.trakheesiPermitNo ?? '']
                .some((value) => value.toLowerCase().includes(search.toLowerCase()))) &&
            (!emirate || p.emirate === emirate) &&
            (!projectStatus || p.status === projectStatus) &&
            (!saleType || p.saleType === saleType) &&
            (!needsAttention || projectNeedsAttention(p)),
    );

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                {[
                    { label: 'Projects', value: projects.length, tint: 'text-accent' },
                    { label: 'Total units', value: portfolio.units, tint: 'text-foreground' },
                    { label: 'Available', value: portfolio.available, tint: 'text-emerald-700' },
                    { label: 'On hold', value: portfolio.held, tint: 'text-amber-700' },
                    { label: 'Needs attention', value: portfolio.attention, tint: 'text-red-700' },
                ].map((item) => (
                    <div key={item.label} className="glass-card p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted">{item.label}</p>
                        <p className={`mt-1 text-xl font-bold ${item.tint}`}>{item.value}</p>
                    </div>
                ))}
            </div>

            {/* Tab bar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex bg-surface rounded-xl border border-border p-0.5 overflow-x-auto">
                    {tabs.map((t) => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${tab === t.id
                                    ? 'bg-accent text-white'
                                    : 'text-muted hover:text-foreground'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" /> {t.label}
                            </button>
                        );
                    })}
                </div>

                {tab === 'grid' && (
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                            <input
                                type="text"
                                placeholder="Search projects…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm w-64"
                            />
                        </div>
                        <select aria-label="Filter by emirate" value={emirate} onChange={(e) => setEmirate(e.target.value)} className="hidden xl:block w-36 py-2.5 bg-surface rounded-xl border border-border text-xs">
                            <option value="">All emirates</option>
                            {emirates.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <select aria-label="Filter by project status" value={projectStatus} onChange={(e) => setProjectStatus(e.target.value)} className="hidden xl:block w-36 py-2.5 bg-surface rounded-xl border border-border text-xs">
                            <option value="">All statuses</option>
                            <option value="Upcoming">Upcoming</option>
                            <option value="UnderConstruction">Under construction</option>
                            <option value="ReadyToMove">Ready to move</option>
                        </select>
                        <select aria-label="Filter by sale type" value={saleType} onChange={(e) => setSaleType(e.target.value)} className="hidden xl:block w-36 py-2.5 bg-surface rounded-xl border border-border text-xs">
                            <option value="">All sale types</option>
                            <option value="Off-Plan (Primary)">Off-plan</option>
                            <option value="Secondary / Resale">Resale</option>
                            <option value="Rental">Rental</option>
                        </select>
                        <button type="button" onClick={() => setNeedsAttention((value) => !value)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium ${needsAttention ? 'border-red-300 bg-red-50 text-red-700' : 'border-border bg-surface text-muted hover:text-foreground'}`}>
                            <Filter className="h-3.5 w-3.5" /> Attention
                        </button>
                        <NewProjectButton />
                    </div>
                )}
            </div>

            {tab === 'grid' && hasFilters && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>Showing {filtered.length} of {projects.length} projects</span>
                    <button type="button" onClick={() => { setSearch(''); setEmirate(''); setProjectStatus(''); setSaleType(''); setNeedsAttention(false); }} className="text-accent hover:underline">Clear filters</button>
                    <span className="xl:hidden">Use the filters on a wider screen for emirate, status and sale type.</span>
                </div>
            )}

            {/* Content */}
            {tab === 'grid' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {filtered.length > 0
                        ? filtered.map((p) => <ProjectCard key={p.id} project={p} />)
                        : <EmptyEmirate search={search} />}
                </div>
            )}

            {tab === 'analytics' && <AnalyticsPanel projects={projects} />}
        </div>
    );
}
