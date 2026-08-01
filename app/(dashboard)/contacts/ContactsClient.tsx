'use client'

/**
 * Contacts directory — the central customer database.
 *
 * Lists every Contact with quick-glance linked-record counts and links through
 * to the per-contact detail / unified timeline pages. Free-text search across
 * name / phone / email.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Search, Users, Phone, Mail, ChevronRight, Loader2, Upload, Download, Globe, Plus, X } from 'lucide-react'
import { getContactsDirectory, bulkImportContacts, createContact, type ContactDirectoryRow } from '@/app/actions/contacts'

export default function ContactsClient() {
    const [rows, setRows] = useState<ContactDirectoryRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [importing, setImporting] = useState(false)
    const [showAdd, setShowAdd] = useState(false)
    const [saving, setSaving] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const load = useCallback(async (term: string) => {
        setLoading(true)
        try {
            const res = await getContactsDirectory({ search: term })
            if (res.success) setRows(res.data)
        } finally {
            setLoading(false)
        }
    }, [])

    // ── CSV export (respects the current search filter) ──────────────────────
    function csvEscape(v: unknown): string {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    function handleExport() {
        if (rows.length === 0) {
            toast.error('No contacts to export')
            return
        }
        const headers = ['Name', 'Phone', 'Email', 'Source', 'State', 'Leads', 'Deals', 'Bookings']
        const lines = [headers.join(',')]
        for (const r of rows) {
            lines.push(
                [r.name, r.phone, r.email, r.source, r.emirate, r.leadCount, r.dealCount, r.bookingCount]
                    .map(csvEscape)
                    .join(','),
            )
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${rows.length} contact${rows.length === 1 ? '' : 's'}`)
    }

    // ── CSV import ───────────────────────────────────────────────────────────
    function parseCsvLine(line: string): string[] {
        const out: string[] = []
        let cur = ''
        let inQ = false
        for (let i = 0; i < line.length; i++) {
            const c = line[i]
            if (inQ) {
                if (c === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
                } else cur += c
            } else if (c === '"') inQ = true
            else if (c === ',') { out.push(cur); cur = '' }
            else cur += c
        }
        out.push(cur)
        return out
    }

    async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) e.target.value = '' // allow re-importing the same file
        if (!file) return
        setImporting(true)
        try {
            const text = await file.text()
            const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
            if (lines.length < 2) {
                toast.error('CSV needs a header row and at least one contact')
                return
            }
            const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
            const idx = (name: string) => headers.indexOf(name)
            const iName = idx('name'), iPhone = idx('phone'), iEmail = idx('email')
            const iSource = idx('source'), iAddress = idx('address'), iCity = idx('city'), iNotes = idx('notes')
            if (iName === -1 || iPhone === -1) {
                toast.error('CSV must include at least "name" and "phone" columns')
                return
            }
            const importRows = lines.slice(1).map((line) => {
                const c = parseCsvLine(line)
                return {
                    name: (c[iName] ?? '').trim(),
                    phone: (c[iPhone] ?? '').trim(),
                    email: iEmail >= 0 ? (c[iEmail] ?? '').trim() : undefined,
                    source: iSource >= 0 ? (c[iSource] ?? '').trim() || undefined : undefined,
                    address: iAddress >= 0 ? (c[iAddress] ?? '').trim() || undefined : undefined,
                    city: iCity >= 0 ? (c[iCity] ?? '').trim() || undefined : undefined,
                    notes: iNotes >= 0 ? (c[iNotes] ?? '').trim() || undefined : undefined,
                }
            })
            const res = await bulkImportContacts(importRows)
            if (!res.success) {
                toast.error(res.error || 'Import failed')
                return
            }
            toast.success(`Imported ${res.data?.created ?? 0} new · ${res.data?.skipped ?? 0} skipped (duplicates/invalid)`)
            await load(search)
        } catch {
            toast.error('Could not read the CSV file')
        } finally {
            setImporting(false)
        }
    }

    // Initial load.
    useEffect(() => {
        load('')
    }, [load])

    // Debounced search.
    useEffect(() => {
        const t = setTimeout(() => load(search), 300)
        return () => clearTimeout(t)
    }, [search, load])

    async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = e.currentTarget
        const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''
        setSaving(true)
        try {
            const res = await createContact({
                name: get('name'),
                phone: get('phone'),
                email: get('email') || undefined,
                source: get('source') || undefined,
                emirate: get('emirate') || undefined,
                address: get('address') || undefined,
                notes: get('notes') || undefined,
                nationality: get('nationality') || undefined,
            })
            if (res.success) {
                toast.success('Contact added')
                setShowAdd(false)
                await load(search)
            } else {
                toast.error(res.error || 'Failed to add contact')
            }
        } finally {
            setSaving(false)
        }
    }

    const withDeals = rows.filter((r) => r.dealCount > 0).length
    const withBookings = rows.filter((r) => r.bookingCount > 0).length

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10">
                        <Users className="size-5 text-accent" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Contacts</h1>
                        <p className="text-sm text-muted">Your central customer database — leads, buyers and partners.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleImportFile}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                        className="flex items-center gap-2 px-3 py-2 border border-border text-foreground hover:bg-surface-hover rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                        {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        Import
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-2 border border-border text-foreground hover:bg-surface-hover rounded-xl text-sm font-medium"
                    >
                        <Download className="size-4" /> Export
                    </button>
                    <button
                        onClick={() => setShowAdd(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold"
                    >
                        <Plus className="size-4" /> Add Contact
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="glass-card p-4">
                    <p className="text-xs text-muted">Total Contacts</p>
                    <p className="text-lg font-bold text-foreground">{rows.length}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-muted">With Deals</p>
                    <p className="text-lg font-bold text-accent">{withDeals}</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-xs text-muted">With Bookings</p>
                    <p className="text-lg font-bold text-emerald-600">{withBookings}</p>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
                <input
                    type="search"
                    placeholder="Search by name, phone, or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-border text-sm"
                />
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="size-6 animate-spin text-accent" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted">No contacts found</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="crm-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Contact</th>
                                    <th>Source</th>
                                    <th>Leads</th>
                                    <th>Deals</th>
                                    <th>Bookings</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((c) => (
                                    <tr key={c.id} className="cursor-pointer">
                                        <td>
                                            <Link href={`/contacts/${c.id}`} className="flex items-center gap-3">
                                                <div className="size-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-semibold text-accent">
                                                    {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-foreground flex items-center gap-1.5">
                                                        {c.name}
                                                        {c.nationality && (
                                                            <span
                                                                title={`Nationality — ${c.nationality}`}
                                                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700 border border-sky-200"
                                                            >
                                                                <Globe className="size-2.5" />
                                                                {c.nationality}
                                                            </span>
                                                        )}
                                                    </p>
                                                    {c.emirate && <p className="text-xs text-muted">{c.emirate}</p>}
                                                </div>
                                            </Link>
                                        </td>
                                        <td>
                                            <div className="text-xs text-muted space-y-0.5">
                                                <span className="flex items-center gap-1"><Phone className="size-3" />{c.phone}</span>
                                                {c.email && <span className="flex items-center gap-1"><Mail className="size-3" />{c.email}</span>}
                                            </div>
                                        </td>
                                        <td><span className="px-2 py-0.5 rounded-full text-xs bg-surface border border-border">{c.source || '—'}</span></td>
                                        <td className="text-foreground">{c.leadCount}</td>
                                        <td className="text-foreground">{c.dealCount}</td>
                                        <td className="text-foreground">{c.bookingCount}</td>
                                        <td className="text-right">
                                            <Link href={`/contacts/${c.id}`} className="inline-flex text-muted hover:text-foreground">
                                                <ChevronRight className="size-4" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Contact modal */}
            {showAdd && (
                <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center" role="dialog" aria-modal="true">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setShowAdd(false)} />
                    <div className="relative w-full md:max-w-lg bg-surface border border-border shadow-2xl flex flex-col max-h-[92dvh] md:max-h-[85vh] rounded-t-3xl md:rounded-2xl md:mx-4">
                        <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-border">
                            <h2 className="text-base md:text-lg font-semibold text-foreground">Add Contact</h2>
                            <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl hover:bg-surface-hover text-muted hover:text-foreground" aria-label="Close">
                                <X className="size-5" />
                            </button>
                        </div>
                        <form onSubmit={handleCreate} className="px-5 md:px-6 py-5 overflow-y-auto flex-1 space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Field label="Name *" name="name" required />
                                <Field label="Phone *" name="phone" type="tel" required placeholder="+971 98765 43210" />
                                <Field label="Email" name="email" type="email" />
                                <div>
                                    <label className="block text-xs font-medium text-muted mb-1.5">Source</label>
                                    <select name="source" defaultValue="Manual" className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm">
                                        {['Manual', 'WhatsApp', 'Walk-in', 'Website', 'Referral', 'Channel Partner', 'Instagram', 'Facebook', 'Bayut', 'Property Finder', 'Dubizzle'].map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                                <Field label="Emirate" name="emirate" placeholder="e.g. Dubai" />
                                <Field label="Nationality (if applicable)" name="nationality" placeholder="e.g. Emirati" />
                            </div>
                            <Field label="Address" name="address" />
                            <div>
                                <label className="block text-xs font-medium text-muted mb-1.5">Notes</label>
                                <textarea name="notes" rows={2} className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm" />
                            </div>
                            <div className="flex justify-end gap-3 pt-1">
                                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface-hover">Cancel</button>
                                <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50">
                                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add Contact
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

function Field({ label, name, type = 'text', required, placeholder }: {
    label: string; name: string; type?: string; required?: boolean; placeholder?: string
}) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
            <input
                name={name}
                type={type}
                required={required}
                placeholder={placeholder}
                className="w-full px-3 py-2.5 bg-surface rounded-xl border border-border text-sm"
            />
        </div>
    )
}
