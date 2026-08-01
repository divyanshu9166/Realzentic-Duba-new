'use client'

/**
 * Add-inventory control for a project: create a Tower, or bulk-create Units
 * across a floor range for a tower. Calls `createTower` / `bulkCreateUnits`
 * and refreshes the detail page.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, Building2, LayoutGrid } from 'lucide-react'
import { createTower, bulkCreateUnits } from '@/app/actions/properties'

const UNIT_TYPES = ['Studio', 'Apartment1', 'Apartment2', 'Apartment3', 'Apartment4Plus', 'Penthouse', 'Villa', 'Townhouse', 'Duplex', 'Retail', 'Office', 'Warehouse', 'LandPlot']
const FACINGS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']

export default function AddInventoryButton({
    projectId,
    towers,
}: {
    projectId: number
    towers: Array<{ id: number; name: string }>
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<'tower' | 'units'>(towers.length === 0 ? 'tower' : 'units')
    const [saving, setSaving] = useState(false)

    const [tower, setTower] = useState({ name: '', totalFloors: '10' })
    const [units, setUnits] = useState({
        towerId: towers[0] ? String(towers[0].id) : '',
        floorStart: '1', floorEnd: '10', unitsPerFloor: '4',
        type: 'Apartment2', netArea: '800', builtUpArea: '1000', facing: 'N',
        basePricePerSqft: '5000', floorRisePremium: '0', viewPremium: '0',
    })

    async function handleCreateTower() {
        if (!tower.name.trim()) { toast.error('Tower name is required'); return }
        const floors = Number(tower.totalFloors)
        if (!Number.isInteger(floors) || floors < 1) { toast.error('Total floors must be at least 1'); return }
        setSaving(true)
        try {
            const res = await createTower({ projectId, name: tower.name.trim(), totalFloors: floors, status: 'Active' })
            if (!res.success) { toast.error(res.error); return }
            toast.success('Tower added')
            setTower({ name: '', totalFloors: '10' })
            setOpen(false)
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    async function handleBulkUnits() {
        if (!units.towerId) { toast.error('Select a tower'); return }
        const start = Number(units.floorStart), end = Number(units.floorEnd), per = Number(units.unitsPerFloor)
        if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) { toast.error('Invalid floor range'); return }
        if (!Number.isInteger(per) || per < 1) { toast.error('Units per floor must be at least 1'); return }
        setSaving(true)
        try {
            const res = await bulkCreateUnits({
                towerId: Number(units.towerId),
                floorRange: { start, end },
                unitsPerFloor: per,
                unitTemplate: {
                    type: units.type,
                    netArea: Number(units.netArea),
                    builtUpArea: Number(units.builtUpArea),
                    facing: units.facing,
                    basePricePerSqft: Number(units.basePricePerSqft),
                    floorRisePremium: Number(units.floorRisePremium) || 0,
                    viewPremium: Number(units.viewPremium) || 0,
                },
            })
            if (!res.success) { toast.error(res.error); return }
            toast.success(`Created ${res.data.count} units`)
            setOpen(false)
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    const field = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm'

    return (
        <>
            <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">
                <Plus className="size-3.5" /> Add Inventory
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
                    <div className="glass-card w-full max-w-lg p-5 space-y-4 bg-background" onClick={(e) => e.stopPropagation()}>
                        <div className="flex bg-surface rounded-xl border border-border p-0.5 w-fit">
                            <button onClick={() => setMode('tower')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'tower' ? 'bg-accent text-white' : 'text-muted'}`}><Building2 className="size-3.5" /> Add Tower</button>
                            <button onClick={() => setMode('units')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'units' ? 'bg-accent text-white' : 'text-muted'}`}><LayoutGrid className="size-3.5" /> Add Units</button>
                        </div>

                        {mode === 'tower' ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Tower Name *</label>
                                    <input value={tower.name} onChange={(e) => setTower((t) => ({ ...t, name: e.target.value }))} placeholder="e.g., Tower A / Wing-1" className={field} />
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Total Floors *</label>
                                    <input type="number" min="1" value={tower.totalFloors} onChange={(e) => setTower((t) => ({ ...t, totalFloors: e.target.value }))} className={field} />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                                    <button onClick={handleCreateTower} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                        {saving ? <><Loader2 className="size-4 animate-spin inline" /> Saving…</> : 'Add Tower'}
                                    </button>
                                </div>
                            </div>
                        ) : towers.length === 0 ? (
                            <p className="text-sm text-muted py-4 text-center">Add a tower first, then create units in it.</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Tower *</label>
                                        <select value={units.towerId} onChange={(e) => setUnits((u) => ({ ...u, towerId: e.target.value }))} className={field}>
                                            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Units / Floor *</label>
                                        <input type="number" min="1" value={units.unitsPerFloor} onChange={(e) => setUnits((u) => ({ ...u, unitsPerFloor: e.target.value }))} className={field} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Floor From *</label>
                                        <input type="number" value={units.floorStart} onChange={(e) => setUnits((u) => ({ ...u, floorStart: e.target.value }))} className={field} />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Floor To *</label>
                                        <input type="number" value={units.floorEnd} onChange={(e) => setUnits((u) => ({ ...u, floorEnd: e.target.value }))} className={field} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Type</label>
                                        <select value={units.type} onChange={(e) => setUnits((u) => ({ ...u, type: e.target.value }))} className={field}>
                                            {UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Facing</label>
                                        <select value={units.facing} onChange={(e) => setUnits((u) => ({ ...u, facing: e.target.value }))} className={field}>
                                            {FACINGS.map((f) => <option key={f}>{f}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Net / suite area (sq ft)</label>
                                        <input type="number" value={units.netArea} onChange={(e) => setUnits((u) => ({ ...u, netArea: e.target.value }))} className={field} />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Built-up area / BUA (sq ft)</label>
                                        <input type="number" value={units.builtUpArea} onChange={(e) => setUnits((u) => ({ ...u, builtUpArea: e.target.value }))} className={field} />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted mb-1">AED  / sqft</label>
                                        <input type="number" value={units.basePricePerSqft} onChange={(e) => setUnits((u) => ({ ...u, basePricePerSqft: e.target.value }))} className={field} />
                                    </div>
                                </div>
                                <p className="text-[11px] text-muted">
                                    Creates {Math.max(0, (Number(units.floorEnd) - Number(units.floorStart) + 1)) * Number(units.unitsPerFloor || 0)} units
                                    (floors {units.floorStart}–{units.floorEnd} × {units.unitsPerFloor}/floor).
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                                    <button onClick={handleBulkUnits} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                        {saving ? <><Loader2 className="size-4 animate-spin inline" /> Creating…</> : 'Create Units'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
