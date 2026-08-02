'use client'

/**
 * "New Project" creator for the Properties list. Creates a Project via
 * `createProject` and refreshes the grid.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, ImagePlus, X, FileText } from 'lucide-react'
import { createProject } from '@/app/actions/properties'
import ProjectLocationPicker from '@/components/ProjectLocationPicker'
import { DEFAULT_PROJECT_GEOFENCE_RADIUS_M } from '@/lib/project-location'

const TYPES = ['Residential', 'Commercial', 'Mixed']
const STATUSES: Array<{ value: string; label: string }> = [
    { value: 'Upcoming', label: 'Upcoming' },
    { value: 'UnderConstruction', label: 'Under Construction' },
    { value: 'ReadyToMove', label: 'Ready to Move' },
]

export default function NewProjectButton() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [photoUrls, setPhotoUrls] = useState<string[]>([])
    const [brochureUrl, setBrochureUrl] = useState('')
    const [form, setForm] = useState({
        name: '', location: '', city: '', emirate: '', type: 'Residential', status: 'UnderConstruction',
        dldProjectRegNo: '', dldProjectRegExpiry: '', escrowAccountNo: '', trakheesiPermitNo: '', saleType: 'Off-Plan (Primary)', isFreeholdZone: false, builderName: '', possessionDate: '',
        latitude: null as number | null, longitude: null as number | null, geofenceRadiusM: DEFAULT_PROJECT_GEOFENCE_RADIUS_M, locationConfirmed: false,
    })

    async function uploadFiles(files: FileList, folder: string): Promise<string[]> {
        const fd = new FormData()
        Array.from(files).forEach((f) => fd.append('files', f))
        fd.append('folder', folder)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed')
        return data.urls as string[]
    }

    async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files) e.target.value = ''
        if (!files || files.length === 0) return
        setUploading(true)
        try {
            const urls = await uploadFiles(files, 'projects')
            setPhotoUrls((prev) => [...prev, ...urls])
            toast.success(`Uploaded ${urls.length} image${urls.length === 1 ? '' : 's'}`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Image upload failed')
        } finally {
            setUploading(false)
        }
    }

    async function handleBrochureUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files) e.target.value = ''
        if (!files || files.length === 0) return
        setUploading(true)
        try {
            const urls = await uploadFiles(files, 'brochures')
            if (urls[0]) { setBrochureUrl(urls[0]); toast.success('Brochure uploaded') }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Brochure upload failed')
        } finally {
            setUploading(false)
        }
    }

    async function handleCreate() {
        if (!form.name.trim() || !form.location.trim() || !form.city.trim() || !form.emirate.trim()) {
            toast.error('Name, location, city and emirate are required')
            return
        }
        setSaving(true)
        try {
            const res = await createProject({
                name: form.name.trim(),
                location: form.location.trim(),
                city: form.city.trim(),
                emirate: form.emirate.trim(),
                type: form.type,
                status: form.status,
                dldProjectRegNo: form.dldProjectRegNo.trim() || undefined,
                dldProjectRegExpiry: form.dldProjectRegExpiry || undefined,
                escrowAccountNo: form.escrowAccountNo.trim() || undefined,
                trakheesiPermitNo: form.trakheesiPermitNo.trim() || undefined,
                saleType: form.saleType,
                isFreeholdZone: form.isFreeholdZone,
                builderName: form.builderName.trim() || undefined,
                possessionDate: form.possessionDate || undefined,
                photoUrls,
                brochureUrl: brochureUrl || undefined,
                latitude: form.latitude ?? undefined,
                longitude: form.longitude ?? undefined,
                geofenceRadiusM: form.geofenceRadiusM,
                locationConfirmed: form.locationConfirmed,
            })
            if (!res.success) { toast.error(res.error); return }
            toast.success('Project created')
            setOpen(false)
            setForm({ name: '', location: '', city: '', emirate: '', type: 'Residential', status: 'UnderConstruction', dldProjectRegNo: '', dldProjectRegExpiry: '', escrowAccountNo: '', trakheesiPermitNo: '', saleType: 'Off-Plan (Primary)', isFreeholdZone: false, builderName: '', possessionDate: '', latitude: null, longitude: null, geofenceRadiusM: DEFAULT_PROJECT_GEOFENCE_RADIUS_M, locationConfirmed: false })
            setPhotoUrls([])
            setBrochureUrl('')
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold">
                <Plus className="size-4" /> New Project
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
                    <div className="glass-card max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto bg-background p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-foreground">New Project</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-muted mb-1">Project Name *</label>
                                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., Skyline Towers" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Location *</label>
                                    <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">City *</label>
                                    <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Emirate *</label>
                                    <input value={form.emirate} onChange={(e) => setForm((f) => ({ ...f, emirate: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Type</label>
                                    <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Status</label>
                                    <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Escrow Account Number</label>
                                    <input value={form.escrowAccountNo} onChange={(e) => setForm((f) => ({ ...f, escrowAccountNo: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Trakheesi Permit Number</label>
                                    <input value={form.trakheesiPermitNo} onChange={(e) => setForm((f) => ({ ...f, trakheesiPermitNo: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Sale Type</label>
                                    <select value={form.saleType} onChange={(e) => setForm((f) => ({ ...f, saleType: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        <option>Off-Plan (Primary)</option><option>Secondary / Resale</option><option>Rental</option>
                                    </select>
                                </div>
                                <label className="flex items-end gap-2 pb-2 text-sm text-muted"><input type="checkbox" checked={form.isFreeholdZone} onChange={(e) => setForm((f) => ({ ...f, isFreeholdZone: e.target.checked }))} /> Freehold zone</label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">DLD Registration Number</label>
                                    <input value={form.dldProjectRegNo} onChange={(e) => setForm((f) => ({ ...f, dldProjectRegNo: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Builder Name</label>
                                    <input value={form.builderName} onChange={(e) => setForm((f) => ({ ...f, builderName: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Possession Date</label>
                                <input type="date" value={form.possessionDate} onChange={(e) => setForm((f) => ({ ...f, possessionDate: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                            </div>

                            <ProjectLocationPicker
                                value={{
                                    latitude: form.latitude,
                                    longitude: form.longitude,
                                    geofenceRadiusM: form.geofenceRadiusM,
                                    locationConfirmed: form.locationConfirmed,
                                }}
                                onChange={(location) => setForm((current) => ({ ...current, ...location }))}
                                initialSearch={[form.name, form.location, form.city, form.emirate, 'UAE'].filter(Boolean).join(', ')}
                                disabled={saving || uploading}
                            />

                            {/* Project images */}
                            <div>
                                <label className="block text-xs text-muted mb-1">Project Images</label>
                                <div className="flex flex-wrap gap-2">
                                    {photoUrls.map((url) => (
                                        <div key={url} className="relative size-16 rounded-lg overflow-hidden border border-border">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={url} alt="project" className="w-full h-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                                                className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white flex items-center justify-center"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                    <label className="size-16 rounded-lg border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-surface-hover">
                                        {uploading ? <Loader2 className="size-4 animate-spin text-muted" /> : <ImagePlus className="size-5 text-muted" />}
                                        <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>

                            {/* Brochure */}
                            <div>
                                <label className="block text-xs text-muted mb-1">Brochure (PDF)</label>
                                {brochureUrl ? (
                                    <div className="flex items-center gap-2 text-sm">
                                        <FileText className="size-4 text-accent" />
                                        <a href={brochureUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">View uploaded brochure</a>
                                        <button type="button" onClick={() => setBrochureUrl('')} className="text-muted hover:text-red-600"><X className="size-4" /></button>
                                    </div>
                                ) : (
                                    <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-sm text-muted cursor-pointer hover:bg-surface-hover">
                                        <FileText className="size-4" /> Upload brochure
                                        <input type="file" accept="application/pdf" onChange={handleBrochureUpload} className="hidden" />
                                    </label>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                            <button onClick={handleCreate} disabled={saving || uploading} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                {saving ? <><Loader2 className="size-4 animate-spin inline" /> Saving…</> : 'Create Project'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
