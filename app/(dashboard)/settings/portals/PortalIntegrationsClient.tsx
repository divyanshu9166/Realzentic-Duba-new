'use client'

/**
 * Property Portal Integration admin UI (Module 12 / Req 15.1).
 *
 * One configuration card per supported portal (Bayut, Property Finder,
 * Dubizzle): enable/disable, set the inbound API key (masked once saved),
 * choose the auto-assign agent, and copy the portal-specific webhook URL to
 * paste into the portal's dashboard. Backed by `listPortalConfigs` /
 * `upsertPortalConfig`.
 */

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Copy, Check, Plug, Webhook } from 'lucide-react'
import { PORTAL_SOURCES } from '@/lib/portal'
import { listPortalConfigs, upsertPortalConfig } from '@/app/actions/portal-integration'
import { getStaff } from '@/app/actions/staff'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MASKED = '••••••••••••'

type StaffOption = { id: number; name: string }

type PortalConfigView = {
    portalName: string
    enabled: boolean
    hasApiKey: boolean
    hasListingApiKey: boolean
    listingApiUrl: string | null
    webhookUrl: string | null
    lastSyncAt: string | null
    autoAssignStaffId: number | null
}

type PortalState = {
    enabled: boolean
    hasApiKey: boolean
    hasListingApiKey: boolean
    apiKey: string
    apiKeyEdited: boolean
    listingApiKey: string
    listingApiKeyEdited: boolean
    listingApiUrl: string
    webhookUrl: string
    autoAssignStaffId: number | null
    lastSyncAt: string | null
    saving: boolean
}

function emptyState(): PortalState {
    return {
        enabled: false,
        hasApiKey: false,
        hasListingApiKey: false,
        apiKey: '',
        apiKeyEdited: false,
        listingApiKey: '',
        listingApiKeyEdited: false,
        listingApiUrl: '',
        webhookUrl: '',
        autoAssignStaffId: null,
        lastSyncAt: null,
        saving: false,
    }
}

function statesFromConfigs(configs: PortalConfigView[]): Record<string, PortalState> {
    const next: Record<string, PortalState> = Object.fromEntries(
        PORTAL_SOURCES.map((p) => [p, emptyState()]),
    )
    for (const c of configs) {
        if (!(c.portalName in next)) continue
        next[c.portalName] = {
            enabled: c.enabled,
            hasApiKey: c.hasApiKey,
            hasListingApiKey: c.hasListingApiKey,
            apiKey: c.hasApiKey ? MASKED : '',
            apiKeyEdited: false,
            listingApiKey: c.hasListingApiKey ? MASKED : '',
            listingApiKeyEdited: false,
            listingApiUrl: c.listingApiUrl ?? '',
            webhookUrl: c.webhookUrl ?? '',
            autoAssignStaffId: c.autoAssignStaffId,
            lastSyncAt: c.lastSyncAt,
            saving: false,
        }
    }
    return next
}

/** The webhook path slug for a canonical portal source. */
function slugFor(source: string): string {
    return source.toLowerCase()
}

export default function PortalIntegrationsClient({
    initialConfigs,
    initialStaff,
    initialLoadError,
}: {
    initialConfigs: PortalConfigView[]
    initialStaff: StaffOption[]
    initialLoadError?: string | null
}) {
    const [staff, setStaff] = useState<StaffOption[]>(initialStaff)
    const [byPortal, setByPortal] = useState<Record<string, PortalState>>(
        () => statesFromConfigs(initialConfigs),
    )
    const [copied, setCopied] = useState<string | null>(null)

    const origin = typeof window !== 'undefined' ? window.location.origin : ''

    const load = useCallback(async () => {
        try {
            const [cfgRes, staffRes] = await Promise.all([listPortalConfigs(), getStaff()])

            if (staffRes?.success) {
                setStaff(staffRes.data.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })))
            }

            const next: Record<string, PortalState> = Object.fromEntries(
                PORTAL_SOURCES.map((p) => [p, emptyState()]),
            )
            if (cfgRes.success) {
                for (const c of cfgRes.data) {
                    if (!(c.portalName in next)) continue
                    next[c.portalName] = {
                        enabled: c.enabled,
                        hasApiKey: c.hasApiKey,
                        hasListingApiKey: c.hasListingApiKey,
                        apiKey: c.hasApiKey ? MASKED : '',
                        apiKeyEdited: false,
                        listingApiKey: c.hasListingApiKey ? MASKED : '',
                        listingApiKeyEdited: false,
                        listingApiUrl: c.listingApiUrl ?? '',
                        webhookUrl: c.webhookUrl ?? '',
                        autoAssignStaffId: c.autoAssignStaffId,
                        lastSyncAt: c.lastSyncAt,
                        saving: false,
                    }
                }
            } else {
                toast.error(cfgRes.error || 'Failed to load portal configurations')
            }
            setByPortal(next)
        } catch {
            toast.error('Failed to load portal integrations')
        }
    }, [])

    function patch(portal: string, partial: Partial<PortalState>) {
        setByPortal((prev) => ({ ...prev, [portal]: { ...prev[portal], ...partial } }))
    }

    async function handleSave(portal: string) {
        const s = byPortal[portal]
        patch(portal, { saving: true })
        try {
            const payload: Record<string, unknown> = {
                portalName: portal,
                enabled: s.enabled,
                autoAssignStaffId: s.autoAssignStaffId,
            }
            // Only send the API key when the admin actually typed a new one;
            // omitting it preserves the stored secret.
            if (s.apiKeyEdited && s.apiKey !== MASKED && s.apiKey.trim()) {
                payload.apiKey = s.apiKey.trim()
            }
            // Always record the canonical webhook URL for reference.
            payload.webhookUrl = `${origin}/api/webhooks/portals/${slugFor(portal)}`
            payload.listingApiUrl = s.listingApiUrl.trim()
            if (s.listingApiKeyEdited && s.listingApiKey !== MASKED && s.listingApiKey.trim()) payload.listingApiKey = s.listingApiKey.trim()

            const res = await upsertPortalConfig(payload)
            if (!res.success) {
                toast.error(res.error || 'Failed to save configuration')
                return
            }
            toast.success(`${portal} settings saved`)
            await load()
        } catch {
            toast.error('Failed to save configuration')
        } finally {
            patch(portal, { saving: false })
        }
    }

    async function handleCopy(portal: string) {
        const url = `${origin}/api/webhooks/portals/${slugFor(portal)}`
        try {
            await navigator.clipboard.writeText(url)
            setCopied(portal)
            setTimeout(() => setCopied((c) => (c === portal ? null : c)), 1500)
            toast.success('Webhook URL copied')
        } catch {
            toast.error('Could not copy URL')
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10 shrink-0">
                    <Plug className="size-5 text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-foreground">Property Portal Integrations</h1>
                    <p className="text-sm text-muted">
                        Auto-capture leads from listing portals. Enable a portal, set its API key, choose who new
                        leads are assigned to, and paste the webhook URL into the portal&apos;s dashboard.
                    </p>
                </div>
            </div>

            {initialLoadError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
                    {initialLoadError} Some configuration values may be unavailable until you save them again.
                </div>
            )}

            {PORTAL_SOURCES.map((portal) => {
                const s = byPortal[portal]
                const webhookUrl = `${origin}/api/webhooks/portals/${slugFor(portal)}`
                return (
                    <div key={portal} className="glass-card p-4 sm:p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="text-sm font-semibold text-foreground">{portal}</span>
                                {s.enabled ? (
                                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">Enabled</span>
                                ) : (
                                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-light text-muted border border-border">Disabled</span>
                                )}
                            </div>
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                                <span className="text-xs text-muted">{s.enabled ? 'On' : 'Off'}</span>
                                <input
                                    type="checkbox"
                                    checked={s.enabled}
                                    onChange={(e) => patch(portal, { enabled: e.target.checked })}
                                    className="size-4 accent-[var(--accent,#3366ff)]"
                                />
                            </label>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">API Key {s.hasApiKey && <span className="text-muted">(saved)</span>}</Label>
                                <Input
                                    type="password"
                                    placeholder={s.hasApiKey ? 'Re-enter to change' : 'Portal API key / token'}
                                    value={s.apiKey}
                                    onChange={(e) => patch(portal, { apiKey: e.target.value, apiKeyEdited: true })}
                                    onFocus={() => { if (s.apiKey === MASKED) patch(portal, { apiKey: '', apiKeyEdited: true }) }}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Auto-assign new leads to</Label>
                                <select
                                    value={s.autoAssignStaffId ?? ''}
                                    onChange={(e) => patch(portal, { autoAssignStaffId: e.target.value ? Number(e.target.value) : null })}
                                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                >
                                    <option value="">Unassigned</option>
                                    {staff.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-border bg-surface/40 p-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Outbound listing API URL</Label>
                                <Input type="url" placeholder="https://your-adapter.example.com/listings" value={s.listingApiUrl} onChange={(e) => patch(portal, { listingApiUrl: e.target.value })} />
                                <p className="text-[11px] text-muted">Use the provider-approved adapter endpoint for publishing listings.</p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Outbound listing API key {s.hasListingApiKey && <span className="text-muted">(saved)</span>}</Label>
                                <Input type="password" placeholder={s.hasListingApiKey ? 'Re-enter to change' : 'Adapter token'} value={s.listingApiKey} onChange={(e) => patch(portal, { listingApiKey: e.target.value, listingApiKeyEdited: true })} onFocus={() => { if (s.listingApiKey === MASKED) patch(portal, { listingApiKey: '', listingApiKeyEdited: true }) }} />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1.5"><Webhook className="size-3.5" /> Webhook URL</Label>
                            <div className="flex gap-2">
                                <Input readOnly value={webhookUrl} className="font-mono text-xs flex-1 min-w-0" />
                                <Button variant="outline" size="icon" onClick={() => handleCopy(portal)} className="shrink-0 border-border">
                                    {copied === portal ? <Check className="size-4" /> : <Copy className="size-4" />}
                                </Button>
                            </div>
                            <p className="text-[11px] text-muted">
                                Paste this into {portal}&apos;s lead-webhook settings.
                                {s.lastSyncAt && ` Last lead received: ${new Date(s.lastSyncAt).toLocaleString()}.`}
                            </p>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={() => handleSave(portal)} disabled={s.saving} className="bg-accent hover:bg-accent/90 text-white">
                                {s.saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save'}
                            </Button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
