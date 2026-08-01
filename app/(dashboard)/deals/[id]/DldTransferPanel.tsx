'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, FileCheck2, Landmark, Loader2, Save } from 'lucide-react'
import {
    scheduleDldTrusteeAppointment,
    updateDldTransferWorkflow,
} from '@/app/actions/deals'

const NOC_STATUSES = ['NotRequested', 'Requested', 'Received', 'Rejected'] as const
const TRANSFER_STATUSES = [
    'NotStarted',
    'TrusteeAppointmentScheduled',
    'TransferCompleted',
    'Cancelled',
] as const

function readableStatus(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').trim()
}

function dateInput(value: string | null): string {
    return value ? value.slice(0, 10) : ''
}

export interface DldWorkflowView {
    developerNocStatus: string
    dldTransferStatus: string
    dldTrusteeOffice: string | null
    dldTransferNotes: string | null
}

export interface DldAppointmentView {
    date: string
    time: string
    status: string
}

interface Props {
    dealId: number
    workflow: DldWorkflowView
    appointment: DldAppointmentView | null
    nocDocument: { fileName: string; status: string; fileUrl: string } | null
}

export default function DldTransferPanel({ dealId, workflow, appointment, nocDocument }: Props) {
    const router = useRouter()
    const [developerNocStatus, setDeveloperNocStatus] = useState(workflow.developerNocStatus)
    const [dldTransferStatus, setDldTransferStatus] = useState(workflow.dldTransferStatus)
    const [office, setOffice] = useState(workflow.dldTrusteeOffice ?? '')
    const [notes, setNotes] = useState(workflow.dldTransferNotes ?? '')
    const [date, setDate] = useState(dateInput(appointment?.date ?? null))
    const [time, setTime] = useState(appointment?.time ?? '')
    const [saving, setSaving] = useState(false)
    const [scheduling, setScheduling] = useState(false)

    async function saveWorkflow() {
        setSaving(true)
        try {
            const res = await updateDldTransferWorkflow(dealId, {
                developerNocStatus,
                dldTransferStatus,
                dldTrusteeOffice: office.trim() || null,
                dldTransferNotes: notes.trim() || null,
            })
            if (!res.success) {
                toast.error(res.error)
                return
            }
            toast.success('DLD transfer workflow updated')
            router.refresh()
        } finally {
            setSaving(false)
        }
    }

    async function scheduleAppointment() {
        if (!date || !time.trim() || !office.trim()) {
            toast.error('Choose a date, time, and DLD Trustee office first')
            return
        }
        setScheduling(true)
        try {
            const res = await scheduleDldTrusteeAppointment(dealId, {
                date,
                time: time.trim(),
                dldTrusteeOffice: office.trim(),
                notes: notes.trim() || null,
            })
            if (!res.success) {
                toast.error(res.error)
                return
            }
            setDldTransferStatus('TrusteeAppointmentScheduled')
            toast.success('DLD Trustee appointment scheduled')
            router.refresh()
        } finally {
            setScheduling(false)
        }
    }

    return (
        <section className="glass-card p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <Landmark className="mt-0.5 h-4 w-4 text-accent" />
                    <div>
                        <h2 className="text-base font-semibold text-foreground">DLD Trustee Transfer &amp; Developer NOC</h2>
                        <p className="mt-0.5 text-xs text-muted">
                            Track the developer NOC and Trustee appointment required for this Dubai deal.
                        </p>
                    </div>
                </div>
                {appointment && (
                    <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                        Appointment {appointment.status}
                    </span>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                    Developer NOC
                    <select
                        value={developerNocStatus}
                        onChange={(event) => setDeveloperNocStatus(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    >
                        {NOC_STATUSES.map((status) => <option key={status} value={status}>{readableStatus(status)}</option>)}
                    </select>
                </label>
                <label className="text-xs text-muted">
                    DLD transfer
                    <select
                        value={dldTransferStatus}
                        onChange={(event) => setDldTransferStatus(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    >
                        {TRANSFER_STATUSES.map((status) => <option key={status} value={status}>{readableStatus(status)}</option>)}
                    </select>
                </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted">
                    Registered DLD Trustee office
                    <input
                        value={office}
                        onChange={(event) => setOffice(event.target.value)}
                        placeholder="e.g. DLD Trustee office, Business Bay"
                        className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    />
                </label>
                <div className="text-xs text-muted">
                    Developer NOC document
                    <div className="mt-1.5 flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground">
                        <FileCheck2 className="h-4 w-4 text-accent" />
                        {nocDocument ? (
                            <a href={nocDocument.fileUrl} target="_blank" rel="noreferrer" className="truncate hover:text-accent">
                                {nocDocument.fileName} · {nocDocument.status}
                            </a>
                        ) : (
                            <span className="text-muted">Attach a “Developer NOC” document to this deal</span>
                        )}
                    </div>
                </div>
            </div>

            <label className="block text-xs text-muted">
                Transfer notes
                <textarea
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Attendees, developer requirements, or transfer notes"
                    className="mt-1.5 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
            </label>

            <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
                <div className="flex flex-wrap gap-2">
                    <label className="text-xs text-muted">
                        Appointment date
                        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 block rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" />
                    </label>
                    <label className="text-xs text-muted">
                        Time
                        <input value={time} onChange={(event) => setTime(event.target.value)} placeholder="e.g. 11:00 AM" className="mt-1.5 block rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" />
                    </label>
                </div>
                <div className="flex items-end gap-2">
                    <button onClick={saveWorkflow} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-50">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save workflow
                    </button>
                    <button onClick={scheduleAppointment} disabled={scheduling} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                        {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />} Schedule Trustee appointment
                    </button>
                </div>
            </div>
        </section>
    )
}
