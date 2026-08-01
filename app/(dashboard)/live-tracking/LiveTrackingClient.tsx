'use client';

/**
 * Live field-force map (manager view).
 *
 * Polls `getLiveAgentLocations` every POLL_MS and renders:
 *   - a live Leaflet/OpenStreetMap with one marker per agent (colour-coded by
 *     presence), and
 *   - a roster panel listing each agent with presence, last-seen, and accuracy.
 *
 * Leaflet is loaded from a CDN at runtime (no npm dependency). If it fails to
 * load (offline/dev), the map area shows a clear notice and the roster panel
 * still works — so the feature degrades gracefully rather than breaking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Users, RefreshCw, AlertTriangle, MapPin, Wifi, WifiOff } from 'lucide-react';
import { getLiveAgentLocations, type LiveAgentLocation } from '@/app/actions/agent-tracking';

const POLL_MS = 15_000;
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

const PRESENCE_COLOR: Record<string, string> = {
    online: '#10b981', // emerald
    away: '#f59e0b', // amber
    offline: '#94a3b8', // slate
};

// Minimal subset of the Leaflet runtime API we use, to avoid `any`.
interface LeafletMap {
    setView(center: [number, number], zoom: number): LeafletMap;
    remove(): void;
    fitBounds(bounds: [number, number][], opts?: Record<string, unknown>): void;
    addLayer(layer: unknown): void;
}
interface LeafletMarker {
    addTo(map: LeafletMap): LeafletMarker;
    setLatLng(latlng: [number, number]): LeafletMarker;
    bindPopup(html: string): LeafletMarker;
    setPopupContent(html: string): LeafletMarker;
    remove(): void;
}
interface LeafletStatic {
    map(el: HTMLElement, opts?: Record<string, unknown>): LeafletMap;
    tileLayer(url: string, opts?: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
    circleMarker(latlng: [number, number], opts?: Record<string, unknown>): LeafletMarker;
}
declare global {
    interface Window {
        L?: LeafletStatic;
    }
}

function loadLeaflet(): Promise<LeafletStatic> {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('no window'));
            return;
        }
        if (window.L) {
            resolve(window.L);
            return;
        }
        // CSS
        if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = LEAFLET_CSS;
            document.head.appendChild(link);
        }
        // JS
        const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
        if (existing) {
            existing.addEventListener('load', () => (window.L ? resolve(window.L) : reject(new Error('Leaflet missing'))));
            existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')));
            return;
        }
        const script = document.createElement('script');
        script.src = LEAFLET_JS;
        script.async = true;
        script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet missing')));
        script.onerror = () => reject(new Error('Leaflet failed to load'));
        document.head.appendChild(script);
    });
}

function relativeTime(secondsAgo: number): string {
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    const m = Math.floor(secondsAgo / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

const initials = (name: string) =>
    (name || '?')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

function popupHtml(a: LiveAgentLocation): string {
    const acc = a.accuracyM != null ? ` · ±${Math.round(a.accuracyM)}m` : '';
    return `<strong>${a.name}</strong><br/>${a.role} · ${a.presence}<br/>Seen ${relativeTime(a.secondsAgo)}${acc}`;
}

export default function LiveTrackingClient() {
    const [agents, setAgents] = useState<LiveAgentLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mapError, setMapError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const mapElRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const markersRef = useRef<Map<number, LeafletMarker>>(new Map());
    const fittedRef = useRef(false);

    // ── Initialise the Leaflet map once. ───────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        loadLeaflet()
            .then((L) => {
                if (cancelled || !mapElRef.current || mapRef.current) return;
                const map = L.map(mapElRef.current, { zoomControl: true }).setView([25.2048, 55.2708], 11); // Dubai
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap contributors',
                    maxZoom: 19,
                }).addTo(map);
                mapRef.current = map;
            })
            .catch(() => {
                if (!cancelled) setMapError('Map could not be loaded. The roster below still shows live positions.');
            });
        return () => {
            cancelled = true;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
            markersRef.current.clear();
        };
    }, []);

    // ── Sync markers whenever agent data changes. ──────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        const L = typeof window !== 'undefined' ? window.L : undefined;
        if (!map || !L) return;

        const seen = new Set<number>();
        for (const a of agents) {
            seen.add(a.staffId);
            const color = PRESENCE_COLOR[a.presence] ?? PRESENCE_COLOR.offline;
            let marker = markersRef.current.get(a.staffId);
            if (!marker) {
                marker = L.circleMarker([a.latitude, a.longitude], {
                    radius: 9,
                    color: '#fff',
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 0.9,
                }).addTo(map);
                marker.bindPopup(popupHtml(a));
                markersRef.current.set(a.staffId, marker);
            } else {
                marker.setLatLng([a.latitude, a.longitude]);
                marker.setPopupContent(popupHtml(a));
            }
        }
        // Remove markers for agents that dropped out of the window.
        for (const [staffId, marker] of markersRef.current) {
            if (!seen.has(staffId)) {
                marker.remove();
                markersRef.current.delete(staffId);
            }
        }

        // Fit bounds once when the first batch of agents arrives.
        if (!fittedRef.current && agents.length > 0) {
            const pts = agents.map((a) => [a.latitude, a.longitude] as [number, number]);
            try {
                map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
                fittedRef.current = true;
            } catch {
                /* single-point or invalid bounds — ignore */
            }
        }
    }, [agents]);

    // ── Poll the live roster. ──────────────────────────────────────────────
    const refresh = useCallback(async () => {
        const res = await getLiveAgentLocations({});
        if (res.success && res.data) {
            setAgents(res.data);
            setError(null);
        } else {
            setError(res.error ?? 'Failed to load live locations');
        }
        setLastRefresh(new Date());
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => clearInterval(id);
    }, [refresh]);

    const onlineCount = agents.filter((a) => a.presence === 'online').length;

    function focusAgent(a: LiveAgentLocation) {
        setSelectedId(a.staffId);
        const map = mapRef.current;
        if (map) {
            map.setView([a.latitude, a.longitude], 15);
            const marker = markersRef.current.get(a.staffId);
            // openPopup is available on circleMarker at runtime.
            (marker as unknown as { openPopup?: () => void } | undefined)?.openPopup?.();
        }
    }

    return (
        <div className="space-y-5">
            {/* Header / stats */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4">
                    <Stat icon={Users} label="Agents live" value={String(agents.length)} />
                    <Stat icon={Wifi} label="Online now" value={String(onlineCount)} accent="text-emerald-600" />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                    {lastRefresh && <span>Updated {lastRefresh.toLocaleTimeString()}</span>}
                    <button
                        onClick={refresh}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface-hover text-foreground transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-700 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Map */}
                <div className="lg:col-span-2 glass-card p-0 overflow-hidden">
                    {mapError ? (
                        <div className="h-[480px] flex flex-col items-center justify-center text-center text-muted p-6">
                            <MapPin className="w-10 h-10 mb-3 opacity-30" />
                            <p className="text-sm">{mapError}</p>
                        </div>
                    ) : (
                        <div ref={mapElRef} className="h-[480px] w-full" style={{ background: '#e5e7eb' }} />
                    )}
                </div>

                {/* Roster */}
                <div className="glass-card p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Radio className="w-5 h-5 text-accent" />
                        <h2 className="text-base font-semibold text-foreground">Live Roster</h2>
                    </div>

                    {loading ? (
                        <div className="space-y-2 animate-pulse">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-14 bg-surface rounded-xl" />
                            ))}
                        </div>
                    ) : agents.length === 0 ? (
                        <div className="py-12 text-center text-muted">
                            <WifiOff className="w-10 h-10 mx-auto mb-2 opacity-20" />
                            <p className="text-sm">No agents are sharing their location right now.</p>
                            <p className="text-xs mt-1">Agents can go live from their Staff Portal or a site visit.</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                            {agents.map((a) => {
                                const color = PRESENCE_COLOR[a.presence] ?? PRESENCE_COLOR.offline;
                                const selected = a.staffId === selectedId;
                                return (
                                    <button
                                        key={a.staffId}
                                        onClick={() => focusAgent(a)}
                                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors ${selected ? 'bg-accent/10 border-accent/40' : 'border-border/60 hover:bg-surface-hover'
                                            }`}
                                    >
                                        <div className="relative flex-shrink-0">
                                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold bg-accent/10 text-accent">
                                                {initials(a.name)}
                                            </div>
                                            <span
                                                className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card"
                                                style={{ backgroundColor: color }}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                                            <p className="text-[11px] text-muted">
                                                <span className="capitalize">{a.presence}</span> · seen {relativeTime(a.secondsAgo)}
                                            </p>
                                        </div>
                                        <span className="text-[10px] text-muted flex-shrink-0">
                                            {a.latitude.toFixed(3)}, {a.longitude.toFixed(3)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Stat({
    icon: Icon,
    label,
    value,
    accent,
}: {
    icon: typeof Users;
    label: string;
    value: string;
    accent?: string;
}) {
    return (
        <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center">
                <Icon className={`w-4 h-4 ${accent ?? 'text-accent'}`} />
            </div>
            <div>
                <p className={`text-lg font-bold leading-none ${accent ?? 'text-foreground'}`}>{value}</p>
                <p className="text-[11px] text-muted mt-0.5">{label}</p>
            </div>
        </div>
    );
}
