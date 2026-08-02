'use client';

/**
 * Project detail client (Req 1.7, 1.8, 2.8).
 *
 * Renders:
 *   - Project header (name, city, DLD Registration, status, type)
 *   - Tower tabs — one tab per tower (Req 1.7)
 *   - Color-coded floor grid — each unit cell shows unit number and is
 *     colored by status (Req 1.7)
 *   - Unit filter panel (type, status, price, area, facing, floor) with
 *     empty-state message when no units match (Req 1.8)
 *   - Analytics toggle (Req 2.8)
 *
 * Requirements: 1.7, 1.8, 2.8
 */

import { useState, useMemo } from 'react';
import {
    Building2, MapPin, ShieldCheck, SlidersHorizontal,
    BarChart3, ChevronDown, ChevronUp, Home, X, Clock, ExternalLink,
} from 'lucide-react';
import { getInventoryAnalytics } from '@/app/actions/properties';
import type { InventoryAnalytics } from '@/lib/inventory';
import { isGoldenVisaEligible } from '@/lib/golden-visa';
import AddInventoryButton from './AddInventoryButton';
import WaitlistPanel from './WaitlistPanel';
import ProjectLocationEditor from './ProjectLocationEditor';
import UnitInventoryModal from './UnitInventoryModal';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UnitRow {
    id: number;
    unitNumber: string;
    floorNumber: number;
    type: string;
    status: string;
    facing: string;
    netArea: number;
    builtUpArea: number;
    plotArea: number | null;
    bedroomCount: number | null;
    bathroomCount: number | null;
    maidRoom: boolean;
    driverRoom: boolean;
    privateGarden: boolean;
    privatePool: boolean;
    furnishingStatus: string | null;
    basePricePerSqft: number | null;
    floorRisePremium: number | null;
    viewPremium: number | null;
    totalPrice: number | null;
    parkingType: string | null;
    parkingCount: number;
}

export interface TowerRow {
    id: number;
    name: string;
    totalFloors: number;
    status: string;
    floors: Array<{ id: number; floorNumber: number; floorPlanUrl: string | null }>;
    units: UnitRow[];
}

export interface ProjectDetail {
    id: number;
    name: string;
    location: string;
    city: string;
    emirate: string;
    dldProjectRegNo: string | null;
    reraExpiry: string | null;
    type: string;
    status: string;
    builderName: string | null;
    totalUnits: number;
    inventoryUnitCount: number;
    description: string | null;
    photoUrls: string[];
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusM: number | null;
    locationConfirmedAt: string | null;
    possessionDate: string | null;
    towers: TowerRow[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
    Available: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
    Blocked: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
    Booked: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
    Sold: 'bg-red-500/10 text-red-700 border-red-500/30',
    Mortgaged: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
};

const STATUS_BG: Record<string, string> = {
    Available: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    Blocked: 'bg-amber-100 border-amber-300 text-amber-800',
    Booked: 'bg-blue-100 border-blue-300 text-blue-800',
    Sold: 'bg-red-100 border-red-300 text-red-800',
    Mortgaged: 'bg-purple-100 border-purple-300 text-purple-800',
};

const UNIT_TYPES = ['Studio', 'Apartment1', 'Apartment2', 'Apartment3', 'Apartment4Plus', 'Penthouse', 'Villa', 'Townhouse', 'Duplex', 'Retail', 'Office', 'Warehouse', 'LandPlot'];
const UNIT_STATUSES = ['Available', 'Blocked', 'Booked', 'Sold', 'Mortgaged'];
const FACINGS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

// ─── Helper functions ─────────────────────────────────────────────────────────

function formatAed(n: number | null | undefined): string {
    if (n == null) return '—';
    return `AED ${Intl.NumberFormat('en-AE', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(n)}`;
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-AE', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch { return '—'; }
}

function displayType(type: string): string {
    const labels: Record<string, string> = { Studio: 'Studio', Apartment1: '1 Bedroom Apartment', Apartment2: '2 Bedroom Apartment', Apartment3: '3 Bedroom Apartment', Apartment4Plus: '4+ Bedroom Apartment', Penthouse: 'Penthouse', Villa: 'Villa', Townhouse: 'Townhouse', Duplex: 'Duplex', Retail: 'Commercial Retail', Office: 'Office Space', Warehouse: 'Warehouse / Industrial', LandPlot: 'Land Plot' };
    return labels[type] ?? 'Property';
}

function Badge({ label, tint }: { label: string; tint: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${tint}`}>
            {label}
        </span>
    );
}

// ─── Filter panel ─────────────────────────────────────────────────────────────

interface Filters {
    type: string;
    status: string;
    facing: string;
    floor: string;
    minPrice: string;
    maxPrice: string;
    minArea: string;
    maxArea: string;
    minPlotArea: string;
    maxPlotArea: string;
}

const EMPTY_FILTERS: Filters = {
    type: '', status: '', facing: '', floor: '',
    minPrice: '', maxPrice: '', minArea: '', maxArea: '', minPlotArea: '', maxPlotArea: '',
};

function hasActiveFilters(f: Filters): boolean {
    return Object.values(f).some((v) => v !== '');
}

function applyFilters(units: UnitRow[], f: Filters): UnitRow[] {
    return units.filter((u) => {
        if (f.type && u.type !== f.type) return false;
        if (f.status && u.status !== f.status) return false;
        if (f.facing && u.facing !== f.facing) return false;
        if (f.floor && u.floorNumber !== parseInt(f.floor, 10)) return false;
        if (f.minPrice && (u.totalPrice ?? 0) < Number(f.minPrice)) return false;
        if (f.maxPrice && (u.totalPrice ?? 0) > Number(f.maxPrice)) return false;
        if (f.minArea && u.builtUpArea < Number(f.minArea)) return false;
        if (f.maxArea && u.builtUpArea > Number(f.maxArea)) return false;
        if (f.minPlotArea && (u.plotArea == null || u.plotArea < Number(f.minPlotArea))) return false;
        if (f.maxPlotArea && (u.plotArea == null || u.plotArea > Number(f.maxPlotArea))) return false;
        return true;
    });
}

function FilterPanel({
    tower,
    filters,
    onChange,
    onReset,
}: {
    tower: TowerRow;
    filters: Filters;
    onChange: (f: Filters) => void;
    onReset: () => void;
}) {
    const [open, setOpen] = useState(false);
    const floors = useMemo(
        () => Array.from(new Set(tower.units.map((u) => u.floorNumber))).sort((a, b) => a - b),
        [tower.units],
    );
    const active = hasActiveFilters(filters);

    function set(key: keyof Filters, value: string) {
        onChange({ ...filters, [key]: value });
    }

    return (
        <div className="glass-card">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground"
            >
                <span className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-accent" />
                    Filters
                    {active && (
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                            !
                        </span>
                    )}
                </span>
                {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {/* Type */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Type</label>
                            <select value={filters.type} onChange={(e) => set('type', e.target.value)} className="w-full text-xs">
                                <option value="">All</option>
                                {UNIT_TYPES.map((t) => <option key={t} value={t}>{displayType(t)}</option>)}
                            </select>
                        </div>
                        {/* Status */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Status</label>
                            <select value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-full text-xs">
                                <option value="">All</option>
                                {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        {/* Facing */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Facing</label>
                            <select value={filters.facing} onChange={(e) => set('facing', e.target.value)} className="w-full text-xs">
                                <option value="">All</option>
                                {FACINGS.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                        {/* Floor */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Floor</label>
                            <select value={filters.floor} onChange={(e) => set('floor', e.target.value)} className="w-full text-xs">
                                <option value="">All</option>
                                {floors.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                        {/* Min Price */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Min Price (AED )</label>
                            <input type="number" min={0} value={filters.minPrice} onChange={(e) => set('minPrice', e.target.value)} placeholder="e.g. 5000000" className="w-full text-xs" />
                        </div>
                        {/* Max Price */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Max Price (AED )</label>
                            <input type="number" min={0} value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} placeholder="e.g. 10000000" className="w-full text-xs" />
                        </div>
                        {/* Min Area */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Min Area (sq ft)</label>
                            <input type="number" min={0} value={filters.minArea} onChange={(e) => set('minArea', e.target.value)} placeholder="e.g. 500" className="w-full text-xs" />
                        </div>
                        {/* Max Area */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Max Area (sq ft)</label>
                            <input type="number" min={0} value={filters.maxArea} onChange={(e) => set('maxArea', e.target.value)} placeholder="e.g. 2000" className="w-full text-xs" />
                        </div>
                        {/* Villa plot area */}
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Min Plot (sq ft)</label>
                            <input type="number" min={0} value={filters.minPlotArea} onChange={(e) => set('minPlotArea', e.target.value)} placeholder="e.g. 3000" className="w-full text-xs" />
                        </div>
                        <div>
                            <label className="block text-[11px] font-medium text-muted mb-1">Max Plot (sq ft)</label>
                            <input type="number" min={0} value={filters.maxPlotArea} onChange={(e) => set('maxPlotArea', e.target.value)} placeholder="e.g. 8000" className="w-full text-xs" />
                        </div>
                    </div>
                    {active && (
                        <button onClick={onReset} className="flex items-center gap-1.5 text-xs text-muted hover:text-danger transition-colors">
                            <X className="w-3 h-3" /> Clear filters
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Floor grid ───────────────────────────────────────────────────────────────

function UnitCell({ unit, onSelect }: { unit: UnitRow; onSelect: (unit: UnitRow) => void }) {
    const [hovered, setHovered] = useState(false);
    const bg = STATUS_BG[unit.status] ?? 'bg-surface text-foreground border-border';

    return (
        <div
            className={`relative border rounded-lg p-1.5 text-center cursor-pointer transition-all hover:scale-[1.03] hover:shadow-sm ${bg}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(unit)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(unit)
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <p className="text-[11px] font-semibold leading-tight">{unit.unitNumber}</p>
            <p className="text-[9px] opacity-70 leading-tight">{displayType(unit.type)}</p>

            {/* Tooltip */}
            {hovered && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-surface border border-border rounded-xl shadow-lg p-2.5 text-left pointer-events-none">
                    <p className="text-xs font-semibold text-foreground mb-1">Unit {unit.unitNumber}</p>
                    <div className="space-y-0.5 text-[11px] text-muted">
                        <p>Type: <span className="text-foreground">{displayType(unit.type)}</span></p>
                        <p>Floor: <span className="text-foreground">{unit.floorNumber}</span></p>
                        <p>Status: <span className="text-foreground">{unit.status}</span></p>
                        <p>Area: <span className="text-foreground">{unit.builtUpArea} sq ft</span></p>
                        {unit.plotArea != null && <p>Plot: <span className="text-foreground">{unit.plotArea} sq ft</span></p>}
                        {unit.bedroomCount != null && <p>Bedrooms: <span className="text-foreground">{unit.bedroomCount}</span></p>}
                        <p>Price: <span className="text-foreground">{formatAed(unit.totalPrice)}</span></p>
                        {isGoldenVisaEligible(unit.totalPrice) && (
                            <p className="font-medium text-amber-700">Golden Visa eligibility indicator</p>
                        )}
                        <p>Facing: <span className="text-foreground">{unit.facing}</span></p>
                    </div>
                </div>
            )}
        </div>
    );
}

function FloorGrid({ tower, filteredUnits, onSelect }: { tower: TowerRow; filteredUnits: UnitRow[]; onSelect: (unit: UnitRow) => void }) {
    const filteredIds = useMemo(() => new Set(filteredUnits.map((u) => u.id)), [filteredUnits]);

    // Group units by floor, sorted descending (top floor first like a real building)
    const byFloor = useMemo(() => {
        const map = new Map<number, UnitRow[]>();
        for (let floor = 1; floor <= tower.totalFloors; floor++) map.set(floor, []);
        for (const floor of tower.floors) map.set(floor.floorNumber, []);
        for (const u of tower.units) {
            if (!map.has(u.floorNumber)) map.set(u.floorNumber, []);
            map.get(u.floorNumber)!.push(u);
        }
        // Sort within each floor by unit number
        for (const [, units] of map) {
            units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
        }
        return Array.from(map.entries()).sort((a, b) => b[0] - a[0]); // descending floor
    }, [tower.floors, tower.totalFloors, tower.units]);

    if (filteredUnits.length === 0 && tower.units.length > 0) {
        return (
            <div className="py-16 text-center text-muted">
                <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No units match the selected filters</p>
                <p className="mt-1 text-sm">Adjust or clear filters to see units.</p>
            </div>
        );
    }

    if (tower.units.length === 0 && byFloor.length === 0) {
        return (
            <div className="py-16 text-center text-muted">
                <Home className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No units in this tower yet</p>
                <p className="mt-1 text-sm">Use bulk unit creation to add units to this tower.</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <div className="space-y-1 min-w-[320px]">
                {byFloor.map(([floor, units]) => (
                    <div key={floor} className="flex items-stretch gap-1">
                        {/* Floor label */}
                        <div className="w-12 flex-shrink-0 flex items-center justify-center">
                            <span className="text-[11px] font-medium text-muted">F{floor}</span>
                            {tower.floors.find((item) => item.floorNumber === floor)?.floorPlanUrl && (
                                <a
                                    href={tower.floors.find((item) => item.floorNumber === floor)?.floorPlanUrl ?? '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:text-accent-hover"
                                    title={`Open floor ${floor} plan`}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        {/* Units row */}
                        <div className="flex flex-wrap gap-1 flex-1">
                            {units.length === 0 && <span className="self-center py-1 text-[11px] text-muted/70">No inventory configured</span>}
                            {units.map((u) => (
                                <div
                                    key={u.id}
                                    className={`transition-opacity ${filteredIds.has(u.id) ? 'opacity-100' : 'opacity-20'}`}
                                    style={{ width: '60px' }}
                                >
                                    <UnitCell unit={u} onSelect={onSelect} />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Status legend ────────────────────────────────────────────────────────────

function StatusLegend() {
    return (
        <div className="flex flex-wrap items-center gap-3">
            {UNIT_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded border ${STATUS_BG[s] ?? 'bg-surface'}`} />
                    <span className="text-[11px] text-muted">{s}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Analytics panel (per-project, Req 2.8) ──────────────────────────────────

function ProjectAnalytics({ projectId }: { projectId: number }) {
    const [analytics, setAnalytics] = useState<InventoryAnalytics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        const res = await getInventoryAnalytics(projectId);
        if (res.success) {
            setAnalytics(res.data);
        } else {
            setError(res.error ?? 'Failed to load analytics');
        }
        setLoading(false);
    }

    if (!analytics && !loading) {
        return (
            <div className="text-center py-8">
                <button
                    onClick={load}
                    className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all"
                >
                    Load Analytics
                </button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-pulse">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-surface-light rounded-2xl" />)}
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-8 text-center text-danger text-sm">
                {error}
                <button onClick={load} className="ml-3 underline text-muted hover:text-foreground">Retry</button>
            </div>
        );
    }

    if (!analytics) return null;

    const items = [
        { label: '% Sold', value: `${analytics.percentSold}%`, tint: 'text-emerald-700 bg-emerald-500/10' },
        { label: 'Revenue Potential', value: formatAed(analytics.revenuePotential), tint: 'text-accent bg-accent/10' },
        { label: 'Available Stock Value', value: formatAed(analytics.availableStockValue), tint: 'text-info bg-info-light' },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {items.map(({ label, value, tint }) => (
                <div key={label} className="glass-card p-4">
                    <p className="text-xs text-muted mb-1">{label}</p>
                    <p className={`text-xl font-bold px-2 py-0.5 rounded-lg inline-block ${tint}`}>{value}</p>
                </div>
            ))}
        </div>
    );
}

// ─── Tower view ────────────────────────────────────────────────────────────────

function TowerView({ tower, projectId, canManage }: { tower: TowerRow; projectId: number; canManage: boolean }) {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [selectedUnit, setSelectedUnit] = useState<UnitRow | null>(null);
    const [addingUnit, setAddingUnit] = useState(false);

    const filteredUnits = useMemo(() => applyFilters(tower.units, filters), [tower.units, filters]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">Select a unit to view its complete inventory record.</p>
                {canManage && (
                    <button
                        type="button"
                        onClick={() => setAddingUnit(true)}
                        className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/15"
                    >
                        Add single unit
                    </button>
                )}
            </div>
            <FilterPanel
                tower={tower}
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(EMPTY_FILTERS)}
            />

            {/* Status legend */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <StatusLegend />
                <span className="text-xs text-muted">
                    {filteredUnits.length} of {tower.units.length} unit{tower.units.length !== 1 ? 's' : ''}
                </span>
            </div>

            <FloorGrid tower={tower} filteredUnits={filteredUnits} onSelect={setSelectedUnit} />

            {(selectedUnit || addingUnit) && (
                <UnitInventoryModal
                    key={selectedUnit?.id ?? 'new-unit'}
                    projectId={projectId}
                    towerId={tower.id}
                    floorCount={tower.totalFloors}
                    defaultType={tower.units[0]?.type ?? 'Villa'}
                    unit={selectedUnit}
                    canManage={canManage}
                    onClose={() => {
                        setSelectedUnit(null)
                        setAddingUnit(false)
                    }}
                />
            )}
        </div>
    );
}

// ─── Root exported component ──────────────────────────────────────────────────

type ViewTab = 'floors' | 'analytics' | 'waitlist';

export default function ProjectDetailClient({ project, canManage = false }: { project: ProjectDetail; canManage?: boolean }) {
    const [activeTower, setActiveTower] = useState<number>(project.towers[0]?.id ?? 0);
    const [viewTab, setViewTab] = useState<ViewTab>('floors');

    const tower = project.towers.find((t) => t.id === activeTower) ?? project.towers[0];

    return (
        <div className="space-y-5">
            {/* Project header */}
            <div className="glass-card p-5">
                <div className="flex items-start gap-4 flex-wrap">
                    {/* Photo */}
                    {project.photoUrls[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={project.photoUrls[0]}
                            alt={project.name}
                            className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
                        />
                    )}
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                            <h2 className="text-lg font-bold text-foreground">{project.name}</h2>
                            <div className="flex flex-wrap gap-1.5">
                                <Badge label={project.type} tint="bg-accent/10 text-accent border-accent/20" />
                                <Badge
                                    label={project.status.replace(/([A-Z])/g, ' $1').trim()}
                                    tint="bg-surface-light text-muted border-border"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            {project.location}, {project.city}, {project.emirate}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                            {project.dldProjectRegNo && (
                                <span className="inline-flex items-center gap-1 text-accent font-medium">
                                    <ShieldCheck className="w-3 h-3" /> {project.dldProjectRegNo}
                                </span>
                            )}
                            {project.builderName && <span>By {project.builderName}</span>}
                            {project.possessionDate && (
                                <span>Possession: {formatDate(project.possessionDate)}</span>
                            )}
                            <span className="flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                {project.towers.length} tower{project.towers.length !== 1 ? 's' : ''},{' '}
                                {project.inventoryUnitCount} unit{project.inventoryUnitCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                        {project.totalUnits !== project.inventoryUnitCount && (
                            <p className="text-xs text-amber-700">
                                Inventory count differs from the project setup ({project.totalUnits} configured, {project.inventoryUnitCount} units recorded).
                            </p>
                        )}
                        {project.description && (
                            <p className="text-xs text-muted line-clamp-2">{project.description}</p>
                        )}
                        <ProjectLocationEditor
                            projectId={project.id}
                            name={project.name}
                            location={project.location}
                            city={project.city}
                            emirate={project.emirate}
                            latitude={project.latitude}
                            longitude={project.longitude}
                            geofenceRadiusM={project.geofenceRadiusM}
                            locationConfirmedAt={project.locationConfirmedAt}
                            canManage={canManage}
                        />
                    </div>
                </div>
            </div>

            {/* View toggle: Floors | Analytics | Waitlist */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex bg-surface rounded-xl border border-border p-0.5">
                    {([
                        { id: 'floors' as ViewTab, label: 'Floor Grid', Icon: Building2 },
                        { id: 'analytics' as ViewTab, label: 'Analytics', Icon: BarChart3 },
                        { id: 'waitlist' as ViewTab, label: 'Waitlist', Icon: Clock },
                    ] as const).map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setViewTab(id)}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${viewTab === id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
                                }`}
                        >
                            <Icon className="w-3.5 h-3.5" /> {label}
                        </button>
                    ))}
                </div>
                {canManage && <AddInventoryButton
                    projectId={project.id}
                    towers={project.towers.map((t) => ({ id: t.id, name: t.name }))}
                    canManage={canManage}
                />}
            </div>

            {viewTab === 'analytics' && <ProjectAnalytics projectId={project.id} />}

            {viewTab === 'waitlist' && <WaitlistPanel projectId={project.id} />}

            {viewTab === 'floors' && (
                <>
                    {project.towers.length === 0 ? (
                        <div className="glass-card py-16 text-center text-muted">
                            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="font-medium">No towers in this project yet</p>
                            <p className="mt-1 text-sm">Add towers to start managing units.</p>
                        </div>
                    ) : (
                        <>
                            {/* Tower tabs */}
                            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                                {project.towers.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setActiveTower(t.id)}
                                        className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all border ${activeTower === t.id
                                            ? 'bg-accent text-white border-accent'
                                            : 'bg-surface text-muted border-border hover:text-foreground hover:border-accent/30'
                                            }`}
                                    >
                                        <Building2 className="w-3.5 h-3.5" />
                                        {t.name}
                                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${activeTower === t.id ? 'bg-white/20' : 'bg-surface-light'}`}>
                                            {t.units.length}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* Active tower view */}
                            {tower && (
                                <div className="glass-card p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-semibold text-foreground">
                                            {tower.name} — {tower.totalFloors} floors
                                        </h3>
                                        <Badge label={tower.status} tint="bg-surface-light text-muted border-border" />
                                    </div>
                                    <TowerView tower={tower} projectId={project.id} canManage={canManage} />
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
