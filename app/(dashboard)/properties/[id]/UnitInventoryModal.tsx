'use client'

import { useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
    blockUnit,
    changeUnitStatus,
    createUnit,
    getUnitPriceHistory,
    revisePrice,
    updateUnit,
} from '@/app/actions/properties'
import type { UnitPriceHistoryRow } from '@/app/actions/properties'
import type { UnitRow } from './ProjectDetailClient'

interface Props {
    projectId: number
    towerId: number
    floorCount: number
    defaultType: string
    unit: UnitRow | null
    canManage: boolean
    onClose: () => void
}

interface UnitForm {
    unitNumber: string
    floorNumber: string
    type: string
    facing: string
    netArea: string
    builtUpArea: string
    plotArea: string
    bedroomCount: string
    bathroomCount: string
    basePricePerSqft: string
    floorRisePremium: string
    viewPremium: string
    totalPrice: string
    parkingType: string
    parkingCount: string
    furnishingStatus: string
    maidRoom: boolean
    driverRoom: boolean
    privateGarden: boolean
    privatePool: boolean
}

const UNIT_TYPES = ['Studio', 'Apartment1', 'Apartment2', 'Apartment3', 'Apartment4Plus', 'Penthouse', 'Villa', 'Townhouse', 'Duplex', 'Retail', 'Office', 'Warehouse', 'LandPlot']
const FACINGS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']
const FURNISHING = ['Unfurnished', 'Semi-Furnished', 'Furnished']
const TRANSITIONS: Record<string, string[]> = {
    Available: ['Blocked', 'Booked'],
    Blocked: ['Available', 'Booked'],
    Booked: ['Sold', 'Available'],
    Sold: ['Mortgaged'],
    Mortgaged: [],
}

function formFromUnit(unit: UnitRow | null, defaultType: string): UnitForm {
    return {
        unitNumber: unit?.unitNumber ?? '',
        floorNumber: String(unit?.floorNumber ?? 1),
        type: unit?.type ?? defaultType,
        facing: unit?.facing ?? 'N',
        netArea: unit ? String(unit.netArea) : '',
        builtUpArea: unit ? String(unit.builtUpArea) : '',
        plotArea: unit?.plotArea != null ? String(unit.plotArea) : '',
        bedroomCount: unit?.bedroomCount != null ? String(unit.bedroomCount) : '',
        bathroomCount: unit?.bathroomCount != null ? String(unit.bathroomCount) : '',
        basePricePerSqft: unit?.basePricePerSqft != null ? String(unit.basePricePerSqft) : '',
        floorRisePremium: unit?.floorRisePremium != null ? String(unit.floorRisePremium) : '0',
        viewPremium: unit?.viewPremium != null ? String(unit.viewPremium) : '0',
        totalPrice: unit?.totalPrice != null ? String(unit.totalPrice) : '',
        parkingType: unit?.parkingType ?? '',
        parkingCount: String(unit?.parkingCount ?? 0),
        furnishingStatus: unit?.furnishingStatus ?? '',
        maidRoom: unit?.maidRoom ?? false,
        driverRoom: unit?.driverRoom ?? false,
        privateGarden: unit?.privateGarden ?? false,
        privatePool: unit?.privatePool ?? false,
    }
}

function optionalNumber(value: string): number | undefined {
    return value.trim() === '' ? undefined : Number(value)
}

function updateNumber(value: string): number | null {
    return value.trim() === '' ? null : Number(value)
}

function formatAed(value: number): string {
    return `AED ${Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
}

export default function UnitInventoryModal({
    projectId,
    towerId,
    floorCount,
    defaultType,
    unit,
    canManage,
    onClose,
}: Props) {
    const router = useRouter()
    const [form, setForm] = useState<UnitForm>(() => formFromUnit(unit, defaultType))
    const [saving, setSaving] = useState(false)
    const [holdHours, setHoldHours] = useState('48')
    const [newPrice, setNewPrice] = useState(unit?.totalPrice != null ? String(unit.totalPrice) : '')
    const [priceReason, setPriceReason] = useState('')
    const [priceHistory, setPriceHistory] = useState<UnitPriceHistoryRow[] | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)

    const transitions = useMemo(
        () => unit ? TRANSITIONS[unit.status] ?? [] : [],
        [unit],
    )

    function setField<K extends keyof UnitForm>(key: K, value: UnitForm[K]) {
        setForm((previous) => ({ ...previous, [key]: value }))
    }

    async function saveDetails(event: React.FormEvent) {
        event.preventDefault()
        if (!canManage) return
        setSaving(true)
        try {
            const optionalFieldNumber = (value: string) => unit ? updateNumber(value) : optionalNumber(value)
            const payload = {
                towerId,
                unitNumber: form.unitNumber.trim(),
                floorNumber: Number(form.floorNumber),
                type: form.type,
                facing: form.facing,
                netArea: Number(form.netArea),
                builtUpArea: Number(form.builtUpArea),
                plotArea: optionalFieldNumber(form.plotArea),
                bedroomCount: optionalFieldNumber(form.bedroomCount),
                bathroomCount: optionalFieldNumber(form.bathroomCount),
                basePricePerSqft: Number(form.basePricePerSqft),
                floorRisePremium: Number(form.floorRisePremium || 0),
                viewPremium: Number(form.viewPremium || 0),
                totalPrice: optionalFieldNumber(form.totalPrice),
                parkingType: form.parkingType.trim() || (unit ? null : undefined),
                parkingCount: Number(form.parkingCount || 0),
                furnishingStatus: form.furnishingStatus || (unit ? null : undefined),
                maidRoom: form.maidRoom,
                driverRoom: form.driverRoom,
                privateGarden: form.privateGarden,
                privatePool: form.privatePool,
            }
            const result = unit
                ? await updateUnit(unit.id, payload)
                : await createUnit(payload)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(unit ? 'Unit details updated' : 'Unit added to inventory')
            router.refresh()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    async function updateStatus(nextStatus: string) {
        if (!unit || !canManage) return
        setSaving(true)
        try {
            const result = nextStatus === 'Blocked'
                ? await blockUnit(unit.id, Number(holdHours))
                : await changeUnitStatus(unit.id, nextStatus)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(`Unit ${unit.unitNumber} is now ${nextStatus}`)
            router.refresh()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    async function savePriceRevision() {
        if (!unit || !canManage) return
        if (!priceReason.trim() || !newPrice.trim() || !Number.isFinite(Number(newPrice))) {
            toast.error('Enter a valid new price and a reason for the revision')
            return
        }
        setSaving(true)
        try {
            const result = await revisePrice(unit.id, Number(newPrice), priceReason.trim())
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success('Unit price revised')
            router.refresh()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    async function loadPriceHistory() {
        if (!unit || historyLoading) return
        setHistoryLoading(true)
        try {
            const result = await getUnitPriceHistory(unit.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setPriceHistory(result.data)
        } finally {
            setHistoryLoading(false)
        }
    }

    const field = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground'
    const label = 'block text-[11px] font-medium text-muted mb-1'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-semibold text-foreground">
                            {unit ? `Unit ${unit.unitNumber}` : 'Add unit to inventory'}
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                            {unit ? `Current status: ${unit.status}` : 'Save verified villa or property inventory details.'}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={saveDetails} className="space-y-4">
                    <fieldset disabled={!canManage || saving} className="space-y-4 disabled:opacity-70">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div><label className={label}>Unit number *</label><input required value={form.unitNumber} onChange={(e) => setField('unitNumber', e.target.value)} className={field} placeholder="V-19" /></div>
                            <div><label className={label}>Floor *</label><input required type="number" min="0" max={Math.max(0, floorCount)} value={form.floorNumber} onChange={(e) => setField('floorNumber', e.target.value)} className={field} /></div>
                            <div><label className={label}>Type *</label><select value={form.type} onChange={(e) => setField('type', e.target.value)} className={field}>{UNIT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
                            <div><label className={label}>Facing *</label><select value={form.facing} onChange={(e) => setField('facing', e.target.value)} className={field}>{FACINGS.map((facing) => <option key={facing}>{facing}</option>)}</select></div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                            <div><label className={label}>Net / suite area (sq ft) *</label><input required type="number" min="0.01" step="0.01" value={form.netArea} onChange={(e) => setField('netArea', e.target.value)} className={field} /></div>
                            <div><label className={label}>BUA (sq ft) *</label><input required type="number" min="0.01" step="0.01" value={form.builtUpArea} onChange={(e) => setField('builtUpArea', e.target.value)} className={field} /></div>
                            <div><label className={label}>Plot area (sq ft)</label><input type="number" min="0.01" step="0.01" value={form.plotArea} onChange={(e) => setField('plotArea', e.target.value)} className={field} /></div>
                            <div><label className={label}>Bedrooms</label><input type="number" min="0" step="1" value={form.bedroomCount} onChange={(e) => setField('bedroomCount', e.target.value)} className={field} /></div>
                            <div><label className={label}>Bathrooms</label><input type="number" min="0" step="1" value={form.bathroomCount} onChange={(e) => setField('bathroomCount', e.target.value)} className={field} /></div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div><label className={label}>Base price / sqft (AED) *</label><input required type="number" min="0" step="0.01" value={form.basePricePerSqft} onChange={(e) => setField('basePricePerSqft', e.target.value)} className={field} /></div>
                            <div><label className={label}>Floor-rise premium (AED)</label><input type="number" min="0" step="0.01" value={form.floorRisePremium} onChange={(e) => setField('floorRisePremium', e.target.value)} className={field} /></div>
                            <div><label className={label}>View premium (AED)</label><input type="number" min="0" step="0.01" value={form.viewPremium} onChange={(e) => setField('viewPremium', e.target.value)} className={field} /></div>
                            <div><label className={label}>Total price override (AED)</label><input type="number" min="0" step="0.01" value={form.totalPrice} onChange={(e) => setField('totalPrice', e.target.value)} className={field} placeholder="Auto-calculate" /></div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div><label className={label}>Parking type</label><input value={form.parkingType} onChange={(e) => setField('parkingType', e.target.value)} className={field} placeholder="Covered / Garage" /></div>
                            <div><label className={label}>Parking spaces</label><input type="number" min="0" step="1" value={form.parkingCount} onChange={(e) => setField('parkingCount', e.target.value)} className={field} /></div>
                            <div><label className={label}>Furnishing</label><select value={form.furnishingStatus} onChange={(e) => setField('furnishingStatus', e.target.value)} className={field}><option value="">Not specified</option>{FURNISHING.map((status) => <option key={status}>{status}</option>)}</select></div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {([
                                ['maidRoom', 'Maid room'],
                                ['driverRoom', 'Driver room'],
                                ['privateGarden', 'Private garden'],
                                ['privatePool', 'Private pool'],
                            ] as const).map(([key, text]) => (
                                <label key={key} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground">
                                    <input type="checkbox" checked={form[key]} onChange={(e) => setField(key, e.target.checked)} />
                                    {text}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground">Close</button>
                        {canManage && <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{unit ? 'Save details' : 'Add unit'}</button>}
                    </div>
                </form>

                {unit && canManage && (
                    <div className="mt-5 space-y-4 border-t border-border pt-4">
                        <div>
                            <h4 className="text-sm font-semibold text-foreground">Inventory controls</h4>
                            <p className="mt-1 text-xs text-muted">Each transition is validated server-side and audited.</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                            {transitions.includes('Blocked') && <div><label className={label}>Hold duration (hours)</label><input type="number" min="1" max="168" value={holdHours} onChange={(e) => setHoldHours(e.target.value)} className={`${field} w-32`} /></div>}
                            {transitions.map((status) => <button key={status} type="button" disabled={saving} onClick={() => void updateStatus(status)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:border-accent hover:text-accent disabled:opacity-50">{status === 'Blocked' ? 'Place timed hold' : `Mark ${status}`}</button>)}
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                            <div><label className={label}>New total price (AED)</label><input type="number" min="0" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className={field} /></div>
                            <div><label className={label}>Revision reason *</label><input value={priceReason} onChange={(e) => setPriceReason(e.target.value)} className={field} placeholder="Market update / approved discount" /></div>
                            <button type="button" disabled={saving} onClick={() => void savePriceRevision()} className="rounded-lg bg-surface-light px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent/10 hover:text-accent disabled:opacity-50">Revise price</button>
                        </div>
                        <button type="button" disabled={historyLoading} onClick={() => void loadPriceHistory()} className="text-xs font-medium text-accent hover:underline disabled:opacity-50">
                            {historyLoading ? 'Loading price history…' : priceHistory ? 'Refresh price history' : 'View price history'}
                        </button>
                        {priceHistory && (
                            <div className="overflow-x-auto rounded-lg border border-border">
                                {priceHistory.length === 0 ? (
                                    <p className="p-3 text-xs text-muted">No recorded price revisions for this unit.</p>
                                ) : (
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-surface text-muted"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Change</th><th className="px-3 py-2 font-medium">Reason</th></tr></thead>
                                        <tbody>{priceHistory.map((entry) => <tr key={entry.id} className="border-t border-border"><td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(entry.effectiveDate).toLocaleDateString('en-AE')}</td><td className="whitespace-nowrap px-3 py-2 text-foreground">{formatAed(entry.oldPrice)} → {formatAed(entry.newPrice)}</td><td className="px-3 py-2 text-muted">{entry.reason}</td></tr>)}</tbody>
                                    </table>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
