'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, GitBranch, Plus, RefreshCw, Users } from 'lucide-react'
import { assignLeadManually, getLeadAssignmentQueue, listLeadRoutingRules, markLeadResponded, saveLeadRoutingRule } from '@/app/actions/lead-routing'

type Staff = { id: number; name: string; role?: string }
type Rule = { id: number; name: string; active: boolean; priority: number; source: string | null; emirate: string | null; community: string | null; responseSlaMinutes: number; businessHoursEnabled: boolean; businessHoursStartMinute: number; businessHoursEndMinute: number; escalationEnabled: boolean; escalationAfterMinutes: number; mode: string; staffIds: number[] }

export default function LeadRoutingClient() {
  const [rules, setRules] = useState<Rule[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', source: '', emirate: 'Dubai', community: '', priority: 100, responseSlaMinutes: 15, businessHoursEnabled: true, businessHoursStartMinute: 540, businessHoursEndMinute: 1260, escalationEnabled: true, escalationAfterMinutes: 15, mode: 'ROUND_ROBIN', staffIds: [] as number[] })

  const load = useCallback(async () => {
    setBusy(true)
    const [ruleResult, queueResult] = await Promise.all([listLeadRoutingRules(), getLeadAssignmentQueue()])
    if (ruleResult.success && ruleResult.data) { setRules(ruleResult.data.rules); setStaff(ruleResult.data.staff) }
    if (queueResult.success && queueResult.data) setQueue(queueResult.data)
    setBusy(false)
  }, [])

  // Initial data hydration is an intentional async server-action boundary.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  function toggleStaff(id: number) {
    setForm(current => ({ ...current, staffIds: current.staffIds.includes(id) ? current.staffIds.filter(item => item !== id) : [...current.staffIds, id] }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('')
    const result = await saveLeadRoutingRule(form)
    if (!result.success) { setMessage(result.error ?? 'Could not save the routing rule'); return }
    setMessage('Routing rule saved. New leads will use it immediately.')
    setForm({ name: '', source: '', emirate: 'Dubai', community: '', priority: 100, responseSlaMinutes: 15, businessHoursEnabled: true, businessHoursStartMinute: 540, businessHoursEndMinute: 1260, escalationEnabled: true, escalationAfterMinutes: 15, mode: 'ROUND_ROBIN', staffIds: [] })
    await load()
  }

  async function assign(leadId: number, staffId: number) {
    const result = await assignLeadManually({ leadId, staffId, reason: 'Manual manager assignment', responseSlaMinutes: form.responseSlaMinutes })
    setMessage(result.success ? 'Lead assigned and SLA timer started.' : result.error ?? 'Could not assign lead')
    await load()
  }

  async function responded(leadId: number) {
    const result = await markLeadResponded(leadId)
    setMessage(result.success ? 'First response recorded.' : result.error ?? 'Could not record response')
    await load()
  }

  return (
    <main className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[0.2em] text-indigo-500">Broker operations</p><h1 className="text-3xl font-semibold text-foreground mt-1">Lead Routing & SLA</h1><p className="text-sm text-muted mt-2">Distribute new enquiries fairly and measure first-response performance.</p></div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      {message && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">{message}</div>}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-500" /><h2 className="font-semibold">Create routing rule</h2></div>
          <input required placeholder="Rule name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="field" />
          <div className="grid grid-cols-2 gap-3"><input placeholder="Source (optional)" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="field" /><input placeholder="Community (optional)" value={form.community} onChange={e => setForm({ ...form, community: e.target.value })} className="field" /></div>
          <div className="grid grid-cols-3 gap-3"><input placeholder="Emirate" value={form.emirate} onChange={e => setForm({ ...form, emirate: e.target.value })} className="field" /><input type="number" min={0} value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} className="field" /><input type="number" min={1} value={form.responseSlaMinutes} onChange={e => setForm({ ...form, responseSlaMinutes: Number(e.target.value) })} className="field" /></div>
          <div className="grid grid-cols-2 gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.businessHoursEnabled} onChange={e => setForm({ ...form, businessHoursEnabled: e.target.checked })} /> Dubai business hours (09:00–21:00)</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.escalationEnabled} onChange={e => setForm({ ...form, escalationEnabled: e.target.checked })} /> Auto-escalate after grace</label><input type="number" min={1} value={form.escalationAfterMinutes} onChange={e => setForm({ ...form, escalationAfterMinutes: Number(e.target.value) })} className="field" placeholder="Grace minutes" /></div>
          <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className="field"><option value="ROUND_ROBIN">Round robin</option><option value="LEAST_LOADED">Least loaded</option><option value="FIXED">Fixed staff member</option></select>
          <div className="rounded-lg border border-border p-3"><p className="mb-2 text-sm font-medium">Eligible staff</p><div className="grid gap-2 sm:grid-cols-2">{staff.map(person => <label key={person.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.staffIds.includes(person.id)} onChange={() => toggleStaff(person.id)} />{person.name}</label>)}</div></div>
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">Save rule</button>
        </form>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-indigo-500" /><h2 className="font-semibold">Active rules</h2></div><span className="text-xs text-muted">Lower priority runs first</span></div>
          <div className="space-y-3">{rules.length === 0 && <p className="rounded-lg bg-muted/10 p-4 text-sm text-muted">No rules yet. Leads will remain in the unassigned queue until a rule is added.</p>}{rules.map(rule => <div key={rule.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between"><span className="font-medium">{rule.name}</span><span className={`rounded-full px-2 py-1 text-xs ${rule.active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted/20 text-muted'}`}>{rule.active ? 'Active' : 'Paused'}</span></div><p className="mt-1 text-xs text-muted">{rule.mode.replace('_', ' ')} · priority {rule.priority} · {rule.responseSlaMinutes} min SLA · {rule.staffIds.length} staff</p></div>)}</div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-indigo-500" /><h2 className="font-semibold">Response queue</h2><span className="rounded-full bg-muted/20 px-2 py-1 text-xs text-muted">{queue.length}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="border-b border-border text-xs uppercase text-muted"><tr><th className="py-3">Lead</th><th>Interest</th><th>Assignee</th><th>SLA</th><th className="text-right">Action</th></tr></thead><tbody>{queue.map(lead => <tr key={lead.id} className="border-b border-border last:border-0"><td className="py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted">{lead.phone}</div></td><td>{lead.interest}</td><td><select value={lead.assignedToId ?? ''} onChange={e => e.target.value && assign(lead.id, Number(e.target.value))} className="field min-w-[150px]"><option value="">Unassigned</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></td><td>{lead.firstResponseAt ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Responded</span> : lead.overdue ? <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle className="h-4 w-4" /> Overdue</span> : <span className="text-muted">Pending</span>}</td><td className="text-right">{!lead.firstResponseAt && lead.assignedToId && <button onClick={() => responded(lead.id)} className="rounded-md border border-border px-3 py-1.5 text-xs">Mark responded</button>}</td></tr>)}</tbody></table>{queue.length === 0 && <p className="py-8 text-center text-sm text-muted">No open leads in the response queue.</p>}</div></section>
    </main>
  )
}
