'use client'

/**
 * AI Property Matching UI (Module 13 / Req 16.1, 16.2) + one-click
 * AI-generated listing copy per matched unit (Unique edge #22).
 *
 * Captures a buyer's preferences, ranks the live Available inventory via the
 * `matchUnits` server action (match % in [0,100], non-increasing order), and
 * lets the agent generate marketing copy for any result with `generateUnitDescription`.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2, Copy, Check, Wand2, Building2, BadgeCheck } from 'lucide-react'
import { matchUnits, type MatchedUnit } from '@/app/actions/ai-matching'
import { generateUnitDescription } from '@/app/actions/properties'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/currency'
import { isGoldenVisaEligible } from '@/lib/golden-visa'

const UNIT_TYPES = ['Studio', 'Apartment1', 'Apartment2', 'Apartment3', 'Apartment4Plus', 'Penthouse', 'Villa', 'Townhouse', 'Duplex', 'Retail', 'Office', 'Warehouse', 'LandPlot'] as const
const TYPE_LABELS: Record<string, string> = {
    Studio: 'Studio', Apartment1: '1 Bedroom Apartment', Apartment2: '2 Bedroom Apartment',
    Apartment3: '3 Bedroom Apartment', Apartment4Plus: '4+ Bedroom Apartment',
    Penthouse: 'Penthouse', Villa: 'Villa', Townhouse: 'Townhouse', Duplex: 'Duplex',
    Retail: 'Retail', Office: 'Office', Warehouse: 'Warehouse', LandPlot: 'Land',
}
const FACINGS = ['', 'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as const

function formatPropertyPrice(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return 'On request'
    return formatCurrency(amount)
}

function matchColor(pct: number): string {
    if (pct >= 70) return 'bg-emerald-500'
    if (pct >= 40) return 'bg-amber-500'
    return 'bg-red-500'
}

export default function RecommendClient() {
    const [minBudget, setMinBudget] = useState('')
    const [maxBudget, setMaxBudget] = useState('')
    const [types, setTypes] = useState<string[]>([])
    const [facing, setFacing] = useState('')
    const [location, setLocation] = useState('')
    const [minFloor, setMinFloor] = useState('')
    const [maxFloor, setMaxFloor] = useState('')
    const [minNetArea, setMinNetArea] = useState('')
    const [maxNetArea, setMaxNetArea] = useState('')

    const [loading, setLoading] = useState(false)
    const [searched, setSearched] = useState(false)
    const [results, setResults] = useState<MatchedUnit[]>([])

    // Per-unit AI description state.
    const [descById, setDescById] = useState<Record<number, { text: string; source: string }>>({})
    const [genId, setGenId] = useState<number | null>(null)
    const [copiedId, setCopiedId] = useState<number | null>(null)

    function toggleType(t: string) {
        setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
    }

    function buildPreferences(): Record<string, unknown> {
        const prefs: Record<string, unknown> = {}
        const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
        if (num(minBudget) !== undefined) prefs.minBudget = num(minBudget)
        if (num(maxBudget) !== undefined) prefs.maxBudget = num(maxBudget)
        if (types.length > 0) prefs.type = types
        if (facing) prefs.facing = facing
        if (location.trim()) prefs.location = location.trim()
        if (num(minFloor) !== undefined) prefs.minFloor = num(minFloor)
        if (num(maxFloor) !== undefined) prefs.maxFloor = num(maxFloor)
        if (num(minNetArea) !== undefined) prefs.minNetArea = num(minNetArea)
        if (num(maxNetArea) !== undefined) prefs.maxNetArea = num(maxNetArea)
        return prefs
    }

    async function handleMatch() {
        setLoading(true)
        try {
            const res = await matchUnits(buildPreferences())
            if (!res.success) {
                toast.error(res.error || 'Failed to match units')
                return
            }
            setResults(res.data)
            setSearched(true)
            setDescById({})
            if (res.data.length === 0) toast.info('No available units matched these preferences.')
        } catch {
            toast.error('Something went wrong while matching units.')
        } finally {
            setLoading(false)
        }
    }

    async function handleGenerate(unitId: number) {
        setGenId(unitId)
        try {
            const res = await generateUnitDescription(unitId)
            if (!res.success) {
                toast.error(res.error || 'Failed to generate description')
                return
            }
            setDescById((prev) => ({ ...prev, [unitId]: { text: res.data.description, source: res.data.source } }))
            if (res.data.source === 'template') {
                toast.info('Generated from a template (AI model not configured).')
            } else {
                toast.success('Listing copy generated.')
            }
        } catch {
            toast.error('Something went wrong while generating the description.')
        } finally {
            setGenId(null)
        }
    }

    async function handleCopy(unitId: number, text: string) {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedId(unitId)
            setTimeout(() => setCopiedId((c) => (c === unitId ? null : c)), 1500)
        } catch {
            toast.error('Could not copy to clipboard.')
        }
    }

    return (
        <div className="space-y-5 max-w-5xl">
            <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10">
                    <Sparkles className="size-5 text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-foreground">AI Property Match</h1>
                    <p className="text-sm text-muted">
                        Rank available inventory against a buyer&apos;s preferences and generate listing copy in one click.
                    </p>
                </div>
            </div>

            {/* Preferences form */}
            <div className="glass-card p-4 sm:p-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Min Budget (AED )</Label>
                        <Input type="number" min="0" placeholder="e.g. 5000000" value={minBudget} onChange={(e) => setMinBudget(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Max Budget (AED )</Label>
                        <Input type="number" min="0" placeholder="e.g. 9000000" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Preferred Location</Label>
                        <Input placeholder="e.g. Dubai Marina" value={location} onChange={(e) => setLocation(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Facing</Label>
                        <select
                            value={facing}
                            onChange={(e) => setFacing(e.target.value)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        >
                            {FACINGS.map((f) => (
                                <option key={f || 'any'} value={f}>{f === '' ? 'Any' : f}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Min Floor</Label>
                        <Input type="number" placeholder="e.g. 3" value={minFloor} onChange={(e) => setMinFloor(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Max Floor</Label>
                        <Input type="number" placeholder="e.g. 15" value={maxFloor} onChange={(e) => setMaxFloor(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Min Net / Suite Area (sq.ft.)</Label>
                        <Input type="number" min="0" placeholder="e.g. 600" value={minNetArea} onChange={(e) => setMinNetArea(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Max Net / Suite Area (sq.ft.)</Label>
                        <Input type="number" min="0" placeholder="e.g. 1200" value={maxNetArea} onChange={(e) => setMaxNetArea(e.target.value)} />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">Unit Type</Label>
                    <div className="flex flex-wrap gap-2">
                        {UNIT_TYPES.map((t) => {
                            const active = types.includes(t)
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => toggleType(t)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${active
                                        ? 'bg-accent text-white border-accent'
                                        : 'bg-surface text-muted border-border hover:text-foreground'
                                        }`}
                                >
                                    {TYPE_LABELS[t]}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button onClick={handleMatch} disabled={loading} className="bg-accent hover:bg-accent/90 text-white">
                        {loading ? <><Loader2 className="size-4 animate-spin" /> Matching…</> : <><Sparkles className="size-4" /> Find Matches</>}
                    </Button>
                </div>
            </div>

            {/* Results */}
            {searched && (
                <div className="space-y-3">
                    <p className="text-sm text-muted">
                        {results.length > 0
                            ? `${results.length} available unit${results.length === 1 ? '' : 's'} ranked by match`
                            : 'No available units matched these preferences.'}
                    </p>

                    {results.map((u) => {
                        const desc = descById[u.id]
                        return (
                            <div key={u.id} className="glass-card p-4 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                                    <div className="flex items-start gap-3 min-w-0">
                                        <div className="flex size-9 items-center justify-center rounded-lg bg-surface-light shrink-0">
                                            <Building2 className="size-4 text-accent" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground truncate">
                                                {u.projectName} — Unit {u.unitNumber}
                                            </p>
                                            <p className="text-xs text-muted">
                                                {TYPE_LABELS[u.type] ?? u.type} · Floor {u.floorNumber} · {u.facing}-facing ·{' '}
                                                {u.builtUpArea} sq.ft. · {formatPropertyPrice(u.totalPrice)}
                                                {u.location ? ` · ${u.location}` : ''}
                                            </p>
                                            {isGoldenVisaEligible(u.totalPrice) && (
                                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                                    <BadgeCheck className="size-3.5" /> Golden Visa eligibility indicator
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0">
                                        <div className="w-28">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] uppercase tracking-wide text-muted">Match</span>
                                                <span className="text-xs font-semibold text-foreground">{u.matchPercentage}%</span>
                                            </div>
                                            <div className="h-1.5 w-full rounded-full bg-surface-light overflow-hidden">
                                                <div className={`h-full ${matchColor(u.matchPercentage)}`} style={{ width: `${u.matchPercentage}%` }} />
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleGenerate(u.id)}
                                            disabled={genId === u.id}
                                            className="border-border"
                                        >
                                            {genId === u.id
                                                ? <><Loader2 className="size-4 animate-spin" /> Writing…</>
                                                : <><Wand2 className="size-4" /> Listing copy</>}
                                        </Button>
                                    </div>
                                </div>

                                {desc && (
                                    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                                        <p className="text-sm text-foreground whitespace-pre-wrap">{desc.text}</p>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase tracking-wide text-muted">
                                                {desc.source === 'ai' ? 'AI-generated' : 'Template'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(u.id, desc.text)}
                                                className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80"
                                            >
                                                {copiedId === u.id ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
