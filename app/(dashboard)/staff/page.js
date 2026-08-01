'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Landmark, Search, ShieldCheck, Users } from 'lucide-react'
import { getStaff } from '@/app/actions/staff'

function formatAed(value) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED', maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

export default function StaffPage() {
  const [staff, setStaff] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getStaff()
      .then((result) => { if (result.success) setStaff(result.data) })
      .finally(() => setLoading(false))
  }, [])

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return staff
    return staff.filter((member) => [member.name, member.role, member.email, member.emiratesId]
      .some((value) => String(value || '').toLowerCase().includes(term)))
  }, [search, staff])

  const activeCount = staff.filter((member) => member.status === 'Active').length
  const wpsCount = staff.filter((member) => member.wpsRegistered).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">UAE Staff Directory</h1>
          <p className="mt-1 text-sm text-muted">Employment, WPS, visa and Emirates ID information for your Dubai team.</p>
        </div>
        <label className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 sm:w-72">
          <Search className="size-4 text-muted" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team members" className="w-full bg-transparent text-sm outline-none" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard Icon={Users} label="Team members" value={staff.length} />
        <SummaryCard Icon={CheckCircle2} label="Active staff" value={activeCount} />
        <SummaryCard Icon={Landmark} label="WPS registered" value={wpsCount} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted">Loading staff records…</div>
        ) : filteredStaff.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted">No matching staff records found.</div>
        ) : (
          <div className="divide-y divide-border">
            {filteredStaff.map((member) => (
              <article key={member.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(200px,1.3fr)_repeat(4,minmax(130px,1fr))]">
                <div>
                  <p className="font-semibold text-foreground">{member.name}</p>
                  <p className="mt-0.5 text-sm text-muted">{member.role || 'Property Consultant'}</p>
                  <p className="mt-1 text-xs text-muted">{member.email} · {member.phone}</p>
                </div>
                <DataPoint Icon={ShieldCheck} label="Emirates ID" value={member.emiratesId || 'Not recorded'} />
                <DataPoint Icon={Building2} label="MOHRE / labour card" value={member.mohreNo || member.laborCardNo || 'Not recorded'} />
                <DataPoint Icon={Landmark} label="WPS / IBAN" value={member.wpsRegistered ? (member.iban || 'WPS registered') : 'Not registered'} />
                <DataPoint Icon={CheckCircle2} label="Visa / EOSB" value={`${member.visaStatus || 'Not recorded'} · ${formatAed(member.eosbAccrued)}`} />
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <Icon className="size-5 text-accent" />
      <div><p className="text-xs text-muted">{label}</p><p className="text-xl font-bold text-foreground">{value}</p></div>
    </div>
  )
}

function DataPoint({ Icon, label, value }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-muted"><Icon className="size-3.5" />{label}</p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
    </div>
  )
}
