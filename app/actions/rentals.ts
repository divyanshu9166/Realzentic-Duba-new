'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { leaseRenewalSchema, leaseSchema, rentalDealSchema } from '@/lib/validations/rental'

function parsedDate(value: string | undefined | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function displayId(prefix: string) {
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

function mapLease(lease: any) {
  return {
    id: lease.id, contractNumber: lease.contractNumber, rentalDealId: lease.rentalDealId,
    contactId: lease.contactId, contactName: lease.contact?.name ?? null,
    assignedAgentId: lease.assignedAgentId, assignedAgentName: lease.assignedAgent?.name ?? null,
    unitId: lease.unitId, unitNumber: lease.unit?.unitNumber ?? null,
    ejariNumber: lease.ejariNumber, ejariStatus: lease.ejariStatus, status: lease.status,
    startDate: lease.startDate.toISOString(), endDate: lease.endDate.toISOString(),
    renewalNoticeDate: lease.renewalNoticeDate.toISOString(), annualRent: lease.annualRent,
    securityDeposit: lease.securityDeposit, noticeDays: lease.noticeDays, autoRenew: lease.autoRenew,
    renewalReminderSentAt: lease.renewalReminderSentAt?.toISOString() ?? null,
    landlordName: lease.landlordName, landlordPhone: lease.landlordPhone, notes: lease.notes,
    renewals: (lease.renewals ?? []).map((renewal: any) => ({
      id: renewal.id, proposedStart: renewal.proposedStart.toISOString(), proposedEnd: renewal.proposedEnd.toISOString(),
      proposedRent: renewal.proposedRent, status: renewal.status, reminderSentAt: renewal.reminderSentAt?.toISOString() ?? null, notes: renewal.notes,
    })),
  }
}

function mapRentalDeal(deal: any) {
  return {
    id: deal.id, displayId: deal.displayId, contactId: deal.contactId, contactName: deal.contact?.name ?? null,
    assignedAgentId: deal.assignedAgentId, assignedAgentName: deal.assignedAgent?.name ?? null,
    projectId: deal.projectId, projectName: deal.project?.name ?? null, unitId: deal.unitId,
    unitNumber: deal.unit?.unitNumber ?? null, dealType: deal.dealType, status: deal.status,
    annualRent: deal.annualRent, monthlyRent: deal.monthlyRent, securityDeposit: deal.securityDeposit,
    agencyFee: deal.agencyFee, startDate: deal.startDate?.toISOString() ?? null, endDate: deal.endDate?.toISOString() ?? null,
    source: deal.source, notes: deal.notes, createdAt: deal.createdAt.toISOString(),
    lease: deal.lease ? mapLease(deal.lease) : null,
  }
}

async function validateReferences(input: { contactId: number; assignedAgentId?: number | null; projectId?: number | null; unitId?: number | null }) {
  const contact = await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } })
  if (!contact) return 'Contact not found'
  if (input.assignedAgentId != null) {
    const staff = await prisma.staff.findFirst({ where: { id: input.assignedAgentId, status: { not: 'Inactive' } }, select: { id: true } })
    if (!staff) return 'Assigned agent is not active or does not exist'
  }
  if (input.projectId != null) {
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } })
    if (!project) return 'Project not found'
  }
  if (input.unitId != null) {
    const unit = await prisma.unit.findUnique({ where: { id: input.unitId }, select: { id: true, tower: { select: { projectId: true } } } })
    if (!unit) return 'Unit not found'
    if (input.projectId != null && unit.tower.projectId !== input.projectId) return 'Selected unit does not belong to the selected project'
  }
  return null
}

export async function getRentalReferenceData() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const [contacts, staff, projects, units] = await Promise.all([
      prisma.contact.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' }, take: 1000 }),
      prisma.staff.findMany({ where: { status: { not: 'Inactive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.project.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } }),
      prisma.unit.findMany({ where: { status: { in: ['Available', 'Booked'] } }, select: { id: true, unitNumber: true, tower: { select: { projectId: true, project: { select: { name: true } } } } }, orderBy: { unitNumber: 'asc' }, take: 2000 }),
    ])
    return { success: true, data: { contacts, staff, projects, units: units.map(unit => ({ id: unit.id, unitNumber: unit.unitNumber, projectId: unit.tower.projectId, projectName: unit.tower.project.name })) } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function getRentalWorkspace() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const [deals, leases] = await Promise.all([
      prisma.rentalDeal.findMany({ include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, project: { select: { name: true } }, unit: { select: { unitNumber: true } }, lease: { include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, unit: { select: { unitNumber: true } }, renewals: { orderBy: { proposedStart: 'desc' } } } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.lease.findMany({ where: { status: { in: ['ACTIVE', 'DRAFT'] } }, include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, unit: { select: { unitNumber: true } }, renewals: { orderBy: { proposedStart: 'desc' } } }, orderBy: { endDate: 'asc' }, take: 500 }),
    ])
    return { success: true, data: { deals: deals.map(mapRentalDeal), leases: leases.map(mapLease) } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function createRentalDeal(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = rentalDealSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid rental deal' }
    const input = parsed.data
    const startDate = parsedDate(input.startDate)
    const endDate = parsedDate(input.endDate)
    if ((input.startDate && !startDate) || (input.endDate && !endDate)) return { success: false, error: 'Lease dates are invalid' }
    if (startDate && endDate && endDate <= startDate) return { success: false, error: 'End date must be after start date' }
    if (input.status === 'ACTIVE' && (!startDate || !endDate)) return { success: false, error: 'Active rental deals require start and end dates' }
    const referenceError = await validateReferences(input)
    if (referenceError) return { success: false, error: referenceError }
    const deal = await prisma.rentalDeal.create({ data: {
      displayId: displayId('RD'), contactId: input.contactId, assignedAgentId: input.assignedAgentId ?? null,
      projectId: input.projectId ?? null, unitId: input.unitId ?? null, dealType: input.dealType, status: input.status,
      annualRent: input.annualRent, monthlyRent: Math.round(input.annualRent / 12), securityDeposit: input.securityDeposit,
      agencyFee: input.agencyFee, startDate, endDate, source: input.source || null, notes: input.notes || null,
    }, include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, project: { select: { name: true } }, unit: { select: { unitNumber: true } } } })
    revalidatePath('/rentals'); return { success: true, data: mapRentalDeal(deal) }
  } catch (error) { console.error('[rentals] create deal failed', error); return { success: false, error: 'Could not create rental deal' } }
}

export async function createLease(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = leaseSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid lease' }
    const input = parsed.data
    const startDate = parsedDate(input.startDate); const endDate = parsedDate(input.endDate); const renewalNoticeDate = parsedDate(input.renewalNoticeDate)
    if (!startDate || !endDate || !renewalNoticeDate) return { success: false, error: 'Lease dates are invalid' }
    if (endDate <= startDate) return { success: false, error: 'Lease end date must be after start date' }
    if (renewalNoticeDate > endDate) return { success: false, error: 'Renewal notice date cannot be after lease end date' }
    const deal = await prisma.rentalDeal.findUnique({ where: { id: input.rentalDealId }, select: { id: true, contactId: true, assignedAgentId: true, unitId: true, lease: { select: { id: true } } } })
    if (!deal) return { success: false, error: 'Rental deal not found' }
    if (deal.lease) return { success: false, error: 'This rental deal already has a lease' }
    if (input.contactId !== deal.contactId) return { success: false, error: 'Lease contact must match the rental deal contact' }
    const referenceError = await validateReferences(input)
    if (referenceError) return { success: false, error: referenceError }
    const lease = await prisma.$transaction(async tx => {
      const created = await tx.lease.create({ data: {
        contractNumber: input.contractNumber, rentalDealId: input.rentalDealId, contactId: input.contactId,
        assignedAgentId: input.assignedAgentId ?? deal.assignedAgentId ?? null, unitId: input.unitId ?? deal.unitId ?? null,
        ejariNumber: input.ejariNumber || null, ejariStatus: input.ejariStatus, status: input.status, startDate, endDate,
        renewalNoticeDate, annualRent: input.annualRent, securityDeposit: input.securityDeposit, noticeDays: input.noticeDays,
        autoRenew: input.autoRenew, landlordName: input.landlordName || null, landlordPhone: input.landlordPhone || null, notes: input.notes || null,
        contact: undefined,
      }, include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, unit: { select: { unitNumber: true } }, renewals: true } })
      await tx.rentalDeal.update({ where: { id: input.rentalDealId }, data: { status: 'ACTIVE', startDate, endDate, annualRent: input.annualRent, monthlyRent: Math.round(input.annualRent / 12) } })
      return created
    })
    revalidatePath('/rentals'); return { success: true, data: mapLease(lease) }
  } catch (error) { console.error('[rentals] create lease failed', error); return { success: false, error: 'Could not create lease' } }
}

export async function updateLease(id: number, data: Partial<{ ejariNumber: string | null; ejariStatus: string; status: string; autoRenew: boolean; notes: string | null }>) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Invalid lease id' }
    const allowedEjari = ['PENDING', 'SUBMITTED', 'ACTIVE', 'EXPIRED', 'NOT_REQUIRED']
    const allowedStatus = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']
    if (data.ejariStatus && !allowedEjari.includes(data.ejariStatus)) return { success: false, error: 'Invalid Ejari status' }
    if (data.status && !allowedStatus.includes(data.status)) return { success: false, error: 'Invalid lease status' }
    const lease = await prisma.lease.update({ where: { id }, data: { ejariNumber: data.ejariNumber === undefined ? undefined : data.ejariNumber || null, ejariStatus: data.ejariStatus, status: data.status, autoRenew: data.autoRenew, notes: data.notes }, include: { contact: { select: { name: true } }, assignedAgent: { select: { name: true } }, unit: { select: { unitNumber: true } }, renewals: true } })
    revalidatePath('/rentals'); return { success: true, data: mapLease(lease) }
  } catch { return { success: false, error: 'Could not update lease' } }
}

export async function createLeaseRenewal(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = leaseRenewalSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid renewal' }
    const input = parsed.data; const start = parsedDate(input.proposedStart); const end = parsedDate(input.proposedEnd)
    if (!start || !end || end <= start) return { success: false, error: 'Renewal dates are invalid' }
    const lease = await prisma.lease.findUnique({ where: { id: input.leaseId }, select: { id: true, endDate: true } })
    if (!lease) return { success: false, error: 'Lease not found' }
    const renewal = await prisma.leaseRenewal.create({ data: { leaseId: input.leaseId, proposedStart: start, proposedEnd: end, proposedRent: input.proposedRent, status: input.status, notes: input.notes || null } })
    revalidatePath('/rentals'); return { success: true, data: { ...renewal, proposedStart: renewal.proposedStart.toISOString(), proposedEnd: renewal.proposedEnd.toISOString() } }
  } catch { return { success: false, error: 'Could not create lease renewal' } }
}

export async function updateRenewalStatus(id: number, status: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['DRAFT', 'OFFERED', 'ACCEPTED', 'DECLINED', 'COMPLETED']
    if (!Number.isInteger(id) || !allowed.includes(status)) return { success: false, error: 'Invalid renewal status' }
    const renewal = await prisma.leaseRenewal.update({ where: { id }, data: { status } })
    revalidatePath('/rentals'); return { success: true, data: renewal }
  } catch { return { success: false, error: 'Could not update renewal' } }
}

async function processLeaseRenewalReminders() {
    const now = new Date()
    const leases = await prisma.lease.findMany({ where: { status: 'ACTIVE', endDate: { gt: now }, renewalNoticeDate: { lte: now }, renewalReminderSentAt: null }, include: { contact: { select: { id: true, name: true } }, assignedAgent: { select: { id: true } } }, take: 200 })
    let created = 0
    for (const lease of leases) {
      const proposedStart = new Date(lease.endDate)
      const proposedEnd = new Date(proposedStart)
      proposedEnd.setFullYear(proposedEnd.getFullYear() + 1)
      const createdForLease = await prisma.$transaction(async tx => {
        const claimed = await tx.lease.updateMany({ where: { id: lease.id, renewalReminderSentAt: null }, data: { renewalReminderSentAt: now } })
        if (claimed.count === 0) return false
        const existingRenewal = await tx.leaseRenewal.findFirst({ where: { leaseId: lease.id, status: { in: ['OFFERED', 'ACCEPTED', 'COMPLETED'] } }, select: { id: true } })
        if (existingRenewal) return false
        await tx.leaseRenewal.create({ data: { leaseId: lease.id, proposedStart, proposedEnd, proposedRent: lease.annualRent, status: 'OFFERED', reminderSentAt: now, notes: 'Automatically opened from the lease renewal notice schedule.' } })
        const existingTask = await tx.task.findFirst({ where: { title: { contains: lease.contractNumber }, type: 'Lease Renewal', status: 'Open' }, select: { id: true } })
        if (!existingTask) await tx.task.create({ data: { title: `Lease renewal: ${lease.contractNumber}`, description: `Renewal discussion required for ${lease.contact.name}.`, type: 'Lease Renewal', priority: 'High', status: 'Open', dueDate: lease.endDate, assignedToId: lease.assignedAgent?.id ?? null, contactId: lease.contact.id } })
        return true
      })
      if (createdForLease) created++
    }
    revalidatePath('/rentals'); revalidatePath('/tasks'); return { success: true, data: { remindersCreated: created } }
}

/** Manager-facing manual trigger. The cron uses the same idempotent processor. */
export async function runLeaseRenewalReminders() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    return await processLeaseRenewalReminders()
  } catch { return { success: false, error: 'Could not run lease renewal reminders' } }
}

/** Secret-protected cron entry point; no browser session is expected here. */
export async function processDueLeaseRenewalReminders() {
  return processLeaseRenewalReminders()
}
