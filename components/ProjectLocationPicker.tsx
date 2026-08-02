'use client'

/**
 * Map-based project arrival-point editor.
 *
 * The pin is the geo-check-in reference used for site visits. It is kept
 * separate from a project's text address so an administrator can set the
 * exact building entrance, sales gallery, or agreed meeting point.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Search } from 'lucide-react'
import {
    DEFAULT_PROJECT_GEOFENCE_RADIUS_M,
    MAX_PROJECT_GEOFENCE_RADIUS_M,
    MIN_PROJECT_GEOFENCE_RADIUS_M,
    isWithinUaeCoordinates,
} from '@/lib/project-location'

const DUBAI_CENTER: [number, number] = [25.2048, 55.2708]
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export interface ProjectLocationValue {
    latitude: number | null
    longitude: number | null
    geofenceRadiusM: number
    locationConfirmed: boolean
}

interface Props {
    value: ProjectLocationValue
    onChange: (value: ProjectLocationValue) => void
    initialSearch?: string
    disabled?: boolean
}

interface LeafletLatLng {
    lat: number
    lng: number
}

interface LeafletMap {
    setView(center: [number, number], zoom: number): LeafletMap
    on(event: 'click', handler: (event: { latlng: LeafletLatLng }) => void): LeafletMap
    remove(): void
}

interface LeafletMarker {
    addTo(map: LeafletMap): LeafletMarker
    setLatLng(latlng: [number, number]): LeafletMarker
    getLatLng(): LeafletLatLng
    on(event: 'dragend', handler: () => void): LeafletMarker
    remove(): void
}

interface LeafletCircle {
    addTo(map: LeafletMap): LeafletCircle
    setLatLng(latlng: [number, number]): LeafletCircle
    setRadius(radius: number): LeafletCircle
    remove(): void
}

interface LeafletRuntime {
    map(el: HTMLElement, options?: Record<string, unknown>): LeafletMap
    tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: LeafletMap): unknown }
    marker(latlng: [number, number], options?: Record<string, unknown>): LeafletMarker
    circle(latlng: [number, number], options?: Record<string, unknown>): LeafletCircle
}

interface NominatimResult {
    lat: string
    lon: string
    display_name: string
}

function getLeaflet(): LeafletRuntime | undefined {
    return (window as unknown as { L?: LeafletRuntime }).L
}

function loadLeaflet(): Promise<LeafletRuntime> {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('No browser window'))
            return
        }
        const ready = getLeaflet()
        if (ready) {
            resolve(ready)
            return
        }
        if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
            const link = document.createElement('link')
            link.rel = 'stylesheet'
            link.href = LEAFLET_CSS
            document.head.appendChild(link)
        }
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`)
        if (existing) {
            existing.addEventListener('load', () => {
                const runtime = getLeaflet()
                if (runtime) resolve(runtime)
                else reject(new Error('Leaflet did not initialise'))
            }, { once: true })
            existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')), { once: true })
            return
        }
        const script = document.createElement('script')
        script.src = LEAFLET_JS
        script.async = true
        script.onload = () => {
            const runtime = getLeaflet()
            if (runtime) resolve(runtime)
            else reject(new Error('Leaflet did not initialise'))
        }
        script.onerror = () => reject(new Error('Leaflet failed to load'))
        document.head.appendChild(script)
    })
}

function isFiniteCoordinate(value: number | null): value is number {
    return value != null && Number.isFinite(value)
}

export default function ProjectLocationPicker({ value, onChange, initialSearch = '', disabled = false }: Props) {
    const [search, setSearch] = useState(initialSearch)
    const [results, setResults] = useState<NominatimResult[]>([])
    const [searching, setSearching] = useState(false)
    const [searchError, setSearchError] = useState<string | null>(null)
    const [mapError, setMapError] = useState<string | null>(null)
    const [mapReady, setMapReady] = useState(false)

    const mapElementRef = useRef<HTMLDivElement | null>(null)
    const mapRef = useRef<LeafletMap | null>(null)
    const markerRef = useRef<LeafletMarker | null>(null)
    const circleRef = useRef<LeafletCircle | null>(null)
    const valueRef = useRef(value)
    const onChangeRef = useRef(onChange)

    useEffect(() => { valueRef.current = value }, [value])
    useEffect(() => { onChangeRef.current = onChange }, [onChange])

    const setPoint = useCallback((latitude: number, longitude: number) => {
        const current = valueRef.current
        onChangeRef.current({
            ...current,
            latitude,
            longitude,
            // Moving a pin always requires a fresh, explicit confirmation.
            locationConfirmed: false,
        })
    }, [])

    useEffect(() => {
        let cancelled = false
        loadLeaflet()
            .then((L) => {
                if (cancelled || !mapElementRef.current || mapRef.current) return
                const current = valueRef.current
                const initialPoint: [number, number] = isFiniteCoordinate(current.latitude) && isFiniteCoordinate(current.longitude)
                    ? [current.latitude, current.longitude]
                    : DUBAI_CENTER
                const map = L.map(mapElementRef.current, { zoomControl: true }).setView(initialPoint, current.latitude != null ? 16 : 11)
                L.tileLayer(OSM_TILE_URL, {
                    attribution: '&copy; OpenStreetMap contributors',
                    maxZoom: 19,
                }).addTo(map)
                map.on('click', (event) => setPoint(event.latlng.lat, event.latlng.lng))
                mapRef.current = map
                setMapReady(true)
            })
            .catch(() => {
                if (!cancelled) setMapError('Map could not be loaded. Enter verified UAE coordinates manually and save.')
            })
        return () => {
            cancelled = true
            markerRef.current?.remove()
            circleRef.current?.remove()
            markerRef.current = null
            circleRef.current = null
            mapRef.current?.remove()
            mapRef.current = null
        }
    }, [setPoint])

    useEffect(() => {
        const map = mapRef.current
        const L = typeof window === 'undefined' ? undefined : getLeaflet()
        if (!map || !L) return
        const latitude = value.latitude
        const longitude = value.longitude
        if (!isFiniteCoordinate(latitude) || !isFiniteCoordinate(longitude)) {
            markerRef.current?.remove()
            circleRef.current?.remove()
            markerRef.current = null
            circleRef.current = null
            return
        }
        const point: [number, number] = [latitude, longitude]
        if (!markerRef.current) {
            const marker = L.marker(point, { draggable: true }).addTo(map)
            marker.on('dragend', () => {
                const position = marker.getLatLng()
                setPoint(position.lat, position.lng)
            })
            markerRef.current = marker
        } else {
            markerRef.current.setLatLng(point)
        }
        if (!circleRef.current) {
            circleRef.current = L.circle(point, {
                radius: value.geofenceRadiusM || DEFAULT_PROJECT_GEOFENCE_RADIUS_M,
                color: '#4f46e5',
                weight: 2,
                fillColor: '#818cf8',
                fillOpacity: 0.12,
            }).addTo(map)
        } else {
            circleRef.current.setLatLng(point).setRadius(value.geofenceRadiusM || DEFAULT_PROJECT_GEOFENCE_RADIUS_M)
        }
    }, [mapReady, setPoint, value.geofenceRadiusM, value.latitude, value.longitude])

    const hasPoint = isFiniteCoordinate(value.latitude) && isFiniteCoordinate(value.longitude)
    const pointIsInUae = isWithinUaeCoordinates(value.latitude ?? Number.NaN, value.longitude ?? Number.NaN)

    function setCoordinate(field: 'latitude' | 'longitude', raw: string) {
        const parsed = raw.trim() === '' ? null : Number(raw)
        const nextValue = Number.isFinite(parsed) ? parsed : null
        onChange({
            ...value,
            [field]: nextValue,
            locationConfirmed: false,
        })
    }

    function setRadius(raw: string) {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return
        onChange({
            ...value,
            geofenceRadiusM: Math.max(MIN_PROJECT_GEOFENCE_RADIUS_M, Math.min(MAX_PROJECT_GEOFENCE_RADIUS_M, Math.round(parsed))),
        })
    }

    async function searchMap() {
        const query = search.trim()
        if (query.length < 3) {
            setSearchError('Enter at least three characters to search the UAE map.')
            return
        }
        setSearching(true)
        setSearchError(null)
        setResults([])
        try {
            // This is an explicit, button-triggered search — never background
            // autocomplete — to stay respectful of the public geocoder.
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ae&accept-language=en&q=${encodeURIComponent(query)}`)
            if (!response.ok) throw new Error('Search is unavailable')
            const data = await response.json() as NominatimResult[]
            const uaeResults = data.filter((result) => isWithinUaeCoordinates(Number(result.lat), Number(result.lon)))
            if (uaeResults.length === 0) {
                setSearchError('No matching UAE place was found. Try a tower, community, or complete address.')
            } else {
                setResults(uaeResults)
            }
        } catch {
            setSearchError('Map search is unavailable. You can still place the pin manually or enter verified coordinates.')
        } finally {
            setSearching(false)
        }
    }

    function chooseResult(result: NominatimResult) {
        const latitude = Number(result.lat)
        const longitude = Number(result.lon)
        if (!isWithinUaeCoordinates(latitude, longitude)) return
        setPoint(latitude, longitude)
        mapRef.current?.setView([latitude, longitude], 16)
        setResults([])
    }

    return (
        <section className="space-y-3 rounded-xl border border-border bg-surface/50 p-3 sm:p-4" aria-label="Project map location">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Geo-verified site-visit location</h3>
                    <p className="mt-0.5 text-xs text-muted">Search, click, or drag the pin to the actual sales gallery, building entrance, or meeting point.</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${value.locationConfirmed && pointIsInUae ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                    {value.locationConfirmed && pointIsInUae ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {value.locationConfirmed && pointIsInUae ? 'Location confirmed' : 'Location needs confirmation'}
                </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchMap() } }}
                    disabled={disabled}
                    placeholder="Search a Dubai tower, community, or address"
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
                />
                <button type="button" onClick={() => void searchMap()} disabled={disabled || searching} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-accent/30 px-3 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50">
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search map
                </button>
            </div>
            {searchError && <p className="text-xs text-amber-700">{searchError}</p>}
            {results.length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-1">
                    {results.map((result) => (
                        <button key={`${result.lat}:${result.lon}`} type="button" onClick={() => chooseResult(result)} className="flex w-full items-start gap-2 rounded-md p-2 text-left text-xs text-foreground hover:bg-surface-hover">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                            <span>{result.display_name}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="relative h-64 overflow-hidden rounded-xl border border-border sm:h-80">
                <div ref={mapElementRef} className="h-full w-full" />
                {mapError && <div className="absolute inset-0 flex items-center justify-center bg-surface p-4 text-center text-sm text-muted">{mapError}</div>}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted">
                    Latitude
                    <input type="number" inputMode="decimal" step="any" value={value.latitude ?? ''} onChange={(event) => setCoordinate('latitude', event.target.value)} disabled={disabled} placeholder="25.2048" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <label className="text-xs text-muted">
                    Longitude
                    <input type="number" inputMode="decimal" step="any" value={value.longitude ?? ''} onChange={(event) => setCoordinate('longitude', event.target.value)} disabled={disabled} placeholder="55.2708" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </label>
                <label className="text-xs text-muted">
                    Geofence radius (m)
                    <input type="number" inputMode="numeric" min={MIN_PROJECT_GEOFENCE_RADIUS_M} max={MAX_PROJECT_GEOFENCE_RADIUS_M} step="25" value={value.geofenceRadiusM} onChange={(event) => setRadius(event.target.value)} disabled={disabled} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
                </label>
            </div>
            <input type="range" min={MIN_PROJECT_GEOFENCE_RADIUS_M} max={MAX_PROJECT_GEOFENCE_RADIUS_M} step="25" value={value.geofenceRadiusM} onChange={(event) => setRadius(event.target.value)} disabled={disabled} className="w-full accent-accent disabled:opacity-50" aria-label="Geofence radius" />

            {!hasPoint && <p className="text-xs text-amber-700">Set a map point before this project can be used for geo-verified site visits.</p>}
            {hasPoint && !pointIsInUae && <p className="text-xs text-red-700">The pin is outside the UAE. Select a UAE project location before saving.</p>}
            {hasPoint && pointIsInUae && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-background p-3 text-xs text-foreground">
                    <input type="checkbox" checked={value.locationConfirmed && pointIsInUae} onChange={(event) => onChange({ ...value, locationConfirmed: event.target.checked })} disabled={disabled} className="mt-0.5" />
                    <span>I confirm this pin marks the agent&apos;s intended arrival point. Site-visit check-in will require the agent to be within {value.geofenceRadiusM}m.</span>
                </label>
            )}
        </section>
    )
}
