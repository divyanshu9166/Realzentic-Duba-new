'use client'

/**
 * Tasks & Reminders — agent to-do management.
 * Create/assign tasks with due dates & priority, filter by status, and
 * complete/cancel them. Overdue open tasks are flagged.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
    CheckSquare, Plus, Loader2, Check, X, Clock, AlertTriangle, Calendar, Repeat,
} from 'lucide-react'
import {
    getTasks, createTask, setTaskStatus, deleteTask, type TaskRow,
} from '@/app/actions/tasks'
import { getStaff } from '@/app/actions/staff'
import { listContactsBrief } from '@/app/actions/contacts'

const TYPES = ['Follow-up', 'Call', 'Site Visit', 'Documentation', 'Payment', 'Meeting', 'Other']
const PRIORITIES = ['Low', 'Medium', 'High']
const STATUS_FILTERS = ['Open', 'Done', 'All']
const RECURRENCES = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
]

const priorityCls: Record<string, string> = {
    High: 'bg-red-500/10 text-red-700 border-red-500/20',
    Medium: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    Low: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
}

export default function TasksClient() {
    const [tasks, setTasks] = useState<TaskRow[]>([])
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState('Open')
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [staff, setStaff] = useState<Array<{ id: number; name: string }>>([])
    const [contacts, setContacts] = useState<Array<{ id: number; name: string }>>([])

    const [form, setForm] = useState({
        title: '', type: 'Follow-up', priority: 'Medium', dueDate: '',
        assignedToId: '', contactId: '', description: '', recurrence: 'none', dealId: '',
    })

    const load = useCallback(async () => {
        setLoading(true)
        const res = await getTasks(statusFilter === 'All' ? {} : { status: statusFilter })
        if (res.success) setTasks(res.data)
        setLoading(false)
    }, [statusFilter])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        getStaff().then((r) => { if (r.success) setStaff(r.data.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name }))) })
        listContactsBrief().then((r) => { if (r.success) setContacts(r.data.map((c) => ({ id: c.id, name: c.name }))) })
    }, [])

    async function handleCreate() {
        if (!form.title.trim()) { toast.error('A task title is required'); return }
        if (!form.dueDate) { toast.error('A due date is required'); return }
        setSaving(true)
        try {
            const res = await createTask({
                title: form.title.trim(),
                type: form.type,
                priority: form.priority,
                dueDate: new Date(form.dueDate).toISOString(),
                recurrence: form.recurrence,
                assignedToId: form.assignedToId ? Number(form.assignedToId) : undefined,
                contactId: form.contactId ? Number(form.contactId) : undefined,
                dealId: form.dealId ? Number(form.dealId) : undefined,
                description: form.description.trim() || undefined,
            })
            if (!res.success) { toast.error(res.error); return }
            toast.success('Task created')
            setShowModal(false)
            setForm({ title: '', type: 'Follow-up', priority: 'Medium', dueDate: '', assignedToId: '', contactId: '', description: '', recurrence: 'none', dealId: '' })
            await load()
        } finally {
            setSaving(false)
        }
    }

    async function handleStatus(id: number, status: string) {
        const res = await setTaskStatus({ id, status })
        if (!res.success) { toast.error(res.error); return }
        await load()
    }

    async function handleDelete(id: number) {
        const res = await deleteTask(id)
        if (!res.success) { toast.error(res.error); return }
        await load()
    }

    const openCount = tasks.filter((t) => t.status === 'Open').length
    const overdueCount = tasks.filter((t) => t.overdue).length

    // Agenda buckets (calendar-day granularity) for the Open view.
    function bucketOf(t: TaskRow): 'overdue' | 'today' | 'upcoming' {
        const due = new Date(t.dueDate)
        const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
        const startTomorrow = new Date(startToday.getTime() + 86_400_000)
        if (due < startToday) return 'overdue'
        if (due < startTomorrow) return 'today'
        return 'upcoming'
    }

    function renderTask(t: TaskRow) {
        return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <button
                    onClick={() => handleStatus(t.id, t.status === 'Done' ? 'Open' : 'Done')}
                    className={`flex size-5 shrink-0 items-center justify-center rounded border ${t.status === 'Done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border hover:border-accent'}`}
                    title={t.status === 'Done' ? 'Mark open' : 'Mark done'}
                >
                    {t.status === 'Done' && <Check className="size-3.5" />}
                </button>
                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${t.status === 'Done' ? 'text-muted line-through' : 'text-foreground'}`}>{t.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-surface border border-border">{t.type}</span>
                        {t.recurrence && t.recurrence !== 'none' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 border border-purple-500/20">
                                <Repeat className="size-3" /> {t.recurrence}
                            </span>
                        )}
                        {t.contactName && <span>· {t.contactName}</span>}
                        {t.dealId && <a href={`/deals/${t.dealId}`} className="text-accent hover:underline">· Deal #{t.dealId}</a>}
                        {t.assignedToName && <span>· {t.assignedToName}</span>}
                        <span className={`flex items-center gap-1 ${t.overdue ? 'text-red-600 font-medium' : ''}`}>
                            {t.overdue ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                            {new Date(t.dueDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                    </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] border ${priorityCls[t.priority] ?? ''}`}>{t.priority}</span>
                {t.status !== 'Cancelled' && t.status !== 'Done' && (
                    <button onClick={() => handleStatus(t.id, 'Cancelled')} className="p-1 text-muted hover:text-amber-600" title="Cancel"><X className="size-4" /></button>
                )}
                <button onClick={() => handleDelete(t.id)} className="p-1 text-muted hover:text-red-600" title="Delete"><X className="size-4 rotate-0" /></button>
            </div>
        )
    }

    const grouped = statusFilter === 'Open'
        ? {
            overdue: tasks.filter((t) => bucketOf(t) === 'overdue'),
            today: tasks.filter((t) => bucketOf(t) === 'today'),
            upcoming: tasks.filter((t) => bucketOf(t) === 'upcoming'),
        }
        : null

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10"><CheckSquare className="size-5 text-accent" /></div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Tasks & Reminders</h1>
                        <p className="text-sm text-muted">{openCount} open · {overdueCount} overdue</p>
                    </div>
                </div>
                <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold">
                    <Plus className="size-4" /> New Task
                </button>
            </div>

            <div className="flex gap-1">
                {STATUS_FILTERS.map((s) => (
                    <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-accent text-white' : 'text-muted hover:text-foreground hover:bg-surface-hover'}`}>{s}</button>
                ))}
            </div>

            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-accent" /></div>
                ) : tasks.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted">No tasks</div>
                ) : grouped ? (
                    <div>
                        {([
                            ['overdue', 'Overdue', 'text-red-600'],
                            ['today', 'Today', 'text-amber-600'],
                            ['upcoming', 'Upcoming', 'text-muted'],
                        ] as const).map(([key, label, cls]) => (
                            grouped[key].length > 0 && (
                                <div key={key}>
                                    <div className={`px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide bg-surface/60 border-b border-border ${cls}`}>
                                        {label} <span className="text-muted">· {grouped[key].length}</span>
                                    </div>
                                    <div className="divide-y divide-border">
                                        {grouped[key].map(renderTask)}
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {tasks.map(renderTask)}
                    </div>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
                    <div className="glass-card w-full max-w-lg p-5 space-y-4 bg-background" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-foreground">New Task</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-muted mb-1">Title *</label>
                                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g., Call back about a Dubai Marina viewing" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Type</label>
                                    <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Priority</label>
                                    <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Due date & time *</label>
                                <input type="datetime-local" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Repeat</label>
                                    <select value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Related deal ID</label>
                                    <input type="number" min="1" value={form.dealId} onChange={(e) => setForm((f) => ({ ...f, dealId: e.target.value }))} placeholder="optional" className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-muted mb-1">Assign to</label>
                                    <select value={form.assignedToId} onChange={(e) => setForm((f) => ({ ...f, assignedToId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        <option value="">Unassigned</option>
                                        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-muted mb-1">Related contact</label>
                                    <select value={form.contactId} onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                        <option value="">None</option>
                                        {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Notes</label>
                                <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm resize-none" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-muted hover:text-foreground">Cancel</button>
                            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50">
                                {saving ? <><Loader2 className="size-4 animate-spin inline" /> Saving…</> : 'Create Task'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
