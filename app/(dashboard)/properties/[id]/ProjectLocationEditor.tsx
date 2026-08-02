'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ExternalLink, Loader2, MapPin, Pencil, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { saveProjectLocation } from '@/app/actions/properties'
import ProjectLocationPicker, { type ProjectLocationValue } from '@/components/ProjectLocationPicker'
import { DEFAULT_PROJECT_GEOFENCE_RADIUS_M, isWithinUaeCoordinates } from '@/lib/project-location'

interface Props {
    projectId: number
    name: string
    location: string
    city: string
    emirate: string
    latitude: number | null
    longitude: number | null
    geofenceRadiusM: number | null
    locationConfirmedAt: string | null
    canManage: boolean
}

const hasCoordinates = (latitude: number | null, longitude: number | null) => latitude != null && longitude != null

export default function ProjectLocationEditor({
    projectId, name, location, city, emirate, latitude, longitude, geofenceRadiusM, locationConfirmedAt, canManage,
}: Props) {
    const router = useRouter()
    const locationIsReady = hasCoordinates(latitude, longitude)
        && isWithinUaeCoordinates(latitude!, longitude!)
        && locationConfirmedAt != null
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [value, setValue] = useState<ProjectLocationValue>({
        latitude,
        longitude,
        geofenceRadiusM: geofenceRadiusM ?? DEFAULT_PROJECT_GEOFENCE_RADIUS_M,
        locationConfirmed: locationIsReady,
    })

    const mapUrl = hasCoordinates(latitude, longitude)
        ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`
        : null

    function startEditing() {
        setValue({
            latitude,
            longitude,
            geofenceRadiusM: geofenceRadiusM ?? DEFAULT_PROJECT_GEOFENCE_RADIUS_M,
            locationConfirmed: locationIsReady,
        })
        setEditing(true)
    }

    async function save() {
        if (value.latitude == null || value.longitude == null || !value.locationConfirmed) {
            toast.error('Choose and confirm the UAE map pin before saving.')
            return
        }
        setSaving(true)
        try {
            const result = await saveProjectLocation({ projectId, ...value })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success('Project arrival point and geofence saved')
            setEditing(false)
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="mt-4 rounded-xl border border-border bg-surface/50 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Site-visit arrival point</h3>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${locationIsReady ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                            {locationIsReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                            {locationIsReady ? 'Location confirmed' : 'Location needs setup'}
                        </span>
                    </div>
                    {locationIsReady ? (
                        <p className="mt-1 text-xs text-muted">{latitude!.toFixed(6)}, {longitude!.toFixed(6)} · {geofenceRadiusM ?? DEFAULT_PROJECT_GEOFENCE_RADIUS_M}m geofence · confirmed {new Date(locationConfirmedAt!).toLocaleDateString('en-AE')}</p>
                    ) : (
                        <p className="mt-1 text-xs text-amber-700">This project cannot be assigned to a geo-verified site visit until a UAE map pin is reviewed and confirmed.</p>
                    )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-hover"><MapPin className="h-3.5 w-3.5" /> Preview map <ExternalLink className="h-3.5 w-3.5" /></a>}
                    {canManage && <button type="button" onClick={startEditing} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent/90"><Pencil className="h-3.5 w-3.5" /> {locationIsReady ? 'Edit location' : 'Configure location'}</button>}
                </div>
            </div>

            {editing && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <ProjectLocationPicker
                        value={value}
                        onChange={setValue}
                        initialSearch={[name, location, city, emirate, 'UAE'].filter(Boolean).join(', ')}
                        disabled={saving}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setEditing(false)} disabled={saving} className="min-h-11 rounded-lg px-3 text-sm text-muted hover:text-foreground disabled:opacity-50">Cancel</button>
                        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save confirmed location
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}
