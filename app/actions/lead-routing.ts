'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { leadAssignmentSchema, leadRoutingRuleSchema } from '@/lib/validations/lead-routing'
import { addBusinessMinutes, businessHoursFromRule, DEFAULT_BUSINESS_HOURS } from '@/lib/lead-sla'
import { notifyManagers } from '@/lib/notify'

const OPEN_STATUSES = ['NEW', 'CONTACTED', 'SHOWROOM_VISIT', 'QUOTATION'] as const

function clean(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase()
}

function dateOrNull(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function serializeRule(rule: {
  id: number; name: string; active: boolean; priority: number; source: string | null
  emirate: string | null; community: string | null; responseSlaMinutes: number
  businessHoursEnabled: boolean; businessHoursStartMinute: number; businessHoursEndMinute: number; businessDays: number[]
  escalationEnabled: boolean; escalationAfterMinutes: number
  mode: string; staffIds: number[]; fixedStaffId: number | null; roundRobinCursor: number
}) {
  return { ...rule, staffIds: [...rule.staffIds] }
}

function serializeAssignment(event: {
  id: number; leadId: number; reason: string; assignedAt: Date; responseDueAt: Date | null
  respondedAt: Date | null; fromStaff: { name: string } | null; toStaff: { name: string } | null
}) {
  return {
    id: event.id,
    leadId: event.leadId,
    reason: event.reason,
    assignedAt: event.assignedAt.toISOString(),
    responseDueAt: event.responseDueAt?.toISOString() ?? null,
    respondedAt: event.respondedAt?.toISOString() ?? null,
    fromStaffName: event.fromStaff?.name ?? null,
    toStaffName: event.toStaff?.name ?? null,
  }
}

async function assertStaffIds(ids: number[]) {
  const unique = [...new Set(ids)]
  const staff = await prisma.staff.findMany({
    where: { id: { in: unique }, status: { not: 'Inactive' } },
    select: { id: true, name: true },
  })
  if (staff.length !== unique.length) return { ok: false as const, error: 'Every selected staff member must be active and valid' }
  return { ok: true as const, staff }
}

function ruleMatches(rule: { source: string | null; emirate: string | null; community: string | null }, context: {
  source?: string | null; emirate?: string | null; community?: string | null
}) {
  if (rule.source && clean(rule.source) !== clean(context.source)) return false
  if (rule.emirate && clean(rule.emirate) !== clean(context.emirate)) return false
  if (rule.community && clean(rule.community) !== clean(context.community)) return false
  return true
}

type RoutingResult = {
  assigned: boolean
  leadId: number
  staffId: number | null
  staffName: string | null
  ruleId: number | null
  responseDueAt: string | null
}

/** Internal assignment path used by lead capture and portal webhooks. */
export async function autoAssignLeadForNewLead(leadId: number, context: {
  source?: string | null
  emirate?: string | null
  community?: string | null
} = {}): Promise<{ success: true; data: RoutingResult } | { success: false; error: string }> {
  try {
    const data = await prisma.$transaction(async tx => {
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: { contact: { select: { name: true, emirate: true, address: true } }, project: { select: { location: true, city: true } } },
      })
      if (!lead) throw new Error('Lead not found')
      if (lead.assignedToId) {
        return {
          assigned: true,
          leadId,
          staffId: lead.assignedToId,
          staffName: null,
          ruleId: null,
          responseDueAt: lead.responseDueAt?.toISOString() ?? null,
        }
      }

      const rules = await tx.leadRoutingRule.findMany({
        where: { active: true },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      })
      const rule = rules.find(candidate => ruleMatches(candidate, {
        source: context.source ?? lead.source,
        emirate: context.emirate ?? lead.contact.emirate,
        community: context.community ?? lead.community ?? lead.project?.location ?? lead.project?.city,
      }))
      if (!rule) return { assigned: false, leadId, staffId: null, staffName: null, ruleId: null, responseDueAt: null }

      // Lock the rule row before consuming its cursor. This prevents two
      // simultaneous webhook requests from assigning the same round-robin slot.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "LeadRoutingRule" WHERE "id" = ${rule.id} FOR UPDATE`)
      const lockedRule = await tx.leadRoutingRule.findUnique({ where: { id: rule.id } })
      if (!lockedRule) return { assigned: false, leadId, staffId: null, staffName: null, ruleId: null, responseDueAt: null }

      const eligible = await tx.staff.findMany({
        where: { id: { in: lockedRule.staffIds }, status: { not: 'Inactive' } },
        select: { id: true, name: true },
      })
      if (eligible.length === 0) return { assigned: false, leadId, staffId: null, staffName: null, ruleId: rule.id, responseDueAt: null }

      let selected = eligible[0]
      if (lockedRule.mode === 'FIXED') {
        selected = eligible.find(staff => staff.id === lockedRule.fixedStaffId) ?? eligible[0]
      } else if (lockedRule.mode === 'LEAST_LOADED') {
        const counts = await Promise.all(eligible.map(async staff => ({
          staff,
          count: await tx.lead.count({ where: { assignedToId: staff.id, status: { in: [...OPEN_STATUSES] } } }),
        })))
        counts.sort((a, b) => a.count - b.count || a.staff.id - b.staff.id)
        selected = counts[0].staff
      } else {
        selected = eligible[lockedRule.roundRobinCursor % eligible.length]
        await tx.leadRoutingRule.update({
          where: { id: lockedRule.id },
          data: { roundRobinCursor: (lockedRule.roundRobinCursor + 1) % eligible.length },
        })
      }

      const assignedAt = new Date()
      const responseDueAt = addBusinessMinutes(assignedAt, lockedRule.responseSlaMinutes, businessHoursFromRule({
        enabled: lockedRule.businessHoursEnabled,
        startMinute: lockedRule.businessHoursStartMinute,
        endMinute: lockedRule.businessHoursEndMinute,
        businessDays: lockedRule.businessDays,
      }))
      await tx.lead.update({
        where: { id: leadId },
        data: {
          assignedToId: selected.id,
          assignedAt,
          responseDueAt,
          assignmentReason: `Rule: ${lockedRule.name}`,
          slaAlertedAt: null,
          slaEscalatedAt: null,
        },
      })
      await tx.leadAssignmentEvent.create({
        data: {
          leadId,
          ruleId: lockedRule.id,
          toStaffId: selected.id,
          reason: `Rule: ${lockedRule.name}`,
          assignedAt,
          responseDueAt,
        },
      })
      return { assigned: true, leadId, staffId: selected.id, staffName: selected.name, ruleId: lockedRule.id, responseDueAt: responseDueAt.toISOString() }
    })
    revalidatePath('/leads')
    revalidatePath('/lead-routing')
    return { success: true, data }
  } catch (error) {
    console.error('[lead-routing] auto assignment failed', error)
    return { success: false, error: 'Lead could not be assigned automatically' }
  }
}

export async function listLeadRoutingRules() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const [rules, staff] = await Promise.all([
      prisma.leadRoutingRule.findMany({ orderBy: [{ priority: 'asc' }, { id: 'asc' }] }),
      prisma.staff.findMany({ where: { status: { not: 'Inactive' } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    ])
    return { success: true, data: { rules: rules.map(serializeRule), staff } }
  } catch {
    return { success: false, error: 'Administrator or manager access required' }
  }
}

export async function saveLeadRoutingRule(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = leadRoutingRuleSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid routing rule' }
    const input = parsed.data
    if (input.mode === 'FIXED' && !input.fixedStaffId) return { success: false, error: 'A fixed staff member is required for FIXED mode' }
    const validStaff = await assertStaffIds(input.staffIds)
    if (!validStaff.ok) return { success: false, error: validStaff.error }
    if (input.fixedStaffId && !input.staffIds.includes(input.fixedStaffId)) return { success: false, error: 'Fixed staff must be included in the selected staff list' }

    const rule = await prisma.leadRoutingRule.create({ data: {
      name: input.name, active: input.active, priority: input.priority,
      source: input.source || null, emirate: input.emirate || null, community: input.community || null,
      responseSlaMinutes: input.responseSlaMinutes,
      businessHoursEnabled: input.businessHoursEnabled,
      businessHoursStartMinute: input.businessHoursStartMinute,
      businessHoursEndMinute: input.businessHoursEndMinute,
      businessDays: [...new Set(input.businessDays)],
      escalationEnabled: input.escalationEnabled,
      escalationAfterMinutes: input.escalationAfterMinutes,
      mode: input.mode, staffIds: [...new Set(input.staffIds)], fixedStaffId: input.fixedStaffId ?? null,
    } })
    revalidatePath('/lead-routing')
    return { success: true, data: serializeRule(rule) }
  } catch {
    return { success: false, error: 'Could not save routing rule' }
  }
}

export async function updateLeadRoutingRule(id: number, data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Invalid rule id' }
    const parsed = leadRoutingRuleSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid routing rule' }
    const input = parsed.data
    if (input.mode === 'FIXED' && !input.fixedStaffId) return { success: false, error: 'A fixed staff member is required for FIXED mode' }
    const validStaff = await assertStaffIds(input.staffIds)
    if (!validStaff.ok) return { success: false, error: validStaff.error }
    if (input.fixedStaffId && !input.staffIds.includes(input.fixedStaffId)) return { success: false, error: 'Fixed staff must be included in the selected staff list' }
    const rule = await prisma.leadRoutingRule.update({ where: { id }, data: {
      name: input.name, active: input.active, priority: input.priority,
      source: input.source || null, emirate: input.emirate || null, community: input.community || null,
      responseSlaMinutes: input.responseSlaMinutes,
      businessHoursEnabled: input.businessHoursEnabled,
      businessHoursStartMinute: input.businessHoursStartMinute,
      businessHoursEndMinute: input.businessHoursEndMinute,
      businessDays: [...new Set(input.businessDays)],
      escalationEnabled: input.escalationEnabled,
      escalationAfterMinutes: input.escalationAfterMinutes,
      mode: input.mode, staffIds: [...new Set(input.staffIds)], fixedStaffId: input.fixedStaffId ?? null,
    } })
    revalidatePath('/lead-routing')
    return { success: true, data: serializeRule(rule) }
  } catch {
    return { success: false, error: 'Could not update routing rule' }
  }
}

export async function deleteLeadRoutingRule(id: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    await prisma.leadRoutingRule.delete({ where: { id } })
    revalidatePath('/lead-routing')
    return { success: true }
  } catch {
    return { success: false, error: 'Could not delete routing rule' }
  }
}

export async function getLeadAssignmentQueue() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const now = new Date()
    const leads = await prisma.lead.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      include: { contact: { select: { name: true, phone: true, emirate: true } }, assignedTo: { select: { name: true } } },
      orderBy: [{ responseDueAt: 'asc' }, { date: 'desc' }], take: 250,
    })
    const events = await prisma.leadAssignmentEvent.findMany({
      where: { leadId: { in: leads.map(lead => lead.id) } },
      orderBy: { assignedAt: 'desc' }, include: { fromStaff: { select: { name: true } }, toStaff: { select: { name: true } } },
    })
    const latest = new Map<number, typeof events[number]>()
    for (const event of events) if (!latest.has(event.leadId)) latest.set(event.leadId, event)
    return { success: true, data: leads.map(lead => ({
      id: lead.id, name: lead.contact.name, phone: lead.contact.phone, emirate: lead.contact.emirate,
      interest: lead.interest, source: lead.source, status: lead.status, assignedToId: lead.assignedToId,
      assignedToName: lead.assignedTo?.name ?? null, assignedAt: lead.assignedAt?.toISOString() ?? null,
      responseDueAt: lead.responseDueAt?.toISOString() ?? null, firstResponseAt: lead.firstResponseAt?.toISOString() ?? null,
      overdue: Boolean(lead.responseDueAt && !lead.firstResponseAt && lead.responseDueAt < now),
      lastAssignment: latest.get(lead.id) ? serializeAssignment(latest.get(lead.id)!) : null,
    })) }
  } catch {
    return { success: false, error: 'Administrator or manager access required' }
  }
}

export async function assignLeadManually(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = leadAssignmentSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid assignment' }
    const input = parsed.data
    const [lead, staff] = await Promise.all([
      prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true, assignedToId: true } }),
      prisma.staff.findFirst({ where: { id: input.staffId, status: { not: 'Inactive' } }, select: { id: true, name: true } }),
    ])
    if (!lead) return { success: false, error: 'Lead not found' }
    if (!staff) return { success: false, error: 'Active staff member not found' }
    const assignedAt = new Date()
    const responseDueAt = input.responseSlaMinutes ? addBusinessMinutes(assignedAt, input.responseSlaMinutes, DEFAULT_BUSINESS_HOURS) : null
    await prisma.$transaction([
      prisma.lead.update({ where: { id: input.leadId }, data: { assignedToId: input.staffId, assignedAt, responseDueAt, assignmentReason: input.reason, slaAlertedAt: null, slaEscalatedAt: null } }),
      prisma.leadAssignmentEvent.create({ data: { leadId: input.leadId, fromStaffId: lead.assignedToId, toStaffId: input.staffId, reason: input.reason, assignedAt, responseDueAt } }),
    ])
    revalidatePath('/leads'); revalidatePath('/lead-routing')
    return { success: true, data: { leadId: input.leadId, staffId: staff.id, staffName: staff.name } }
  } catch {
    return { success: false, error: 'Administrator or manager access required' }
  }
}

/**
 * Idempotent cron processor for unresponded leads. It alerts managers once at
 * breach, then reassigns to the next eligible routing-pool member after the
 * configured business-hours grace period.
 */
export async function processLeadSlaBreaches() {
  const now = new Date()
  const leads = await prisma.lead.findMany({
    where: { status: { in: [...OPEN_STATUSES] }, assignedToId: { not: null }, responseDueAt: { lte: now }, firstResponseAt: null },
    select: {
      id: true, contactId: true, assignedToId: true, assignedAt: true, responseDueAt: true, slaAlertedAt: true, slaEscalatedAt: true,
      contact: { select: { name: true, phone: true } },
      assignmentEvents: { orderBy: { assignedAt: 'desc' }, take: 1, include: { rule: true, toStaff: { select: { name: true } } } },
    },
    take: 250,
  })
  let alerted = 0
  let escalated = 0

  for (const lead of leads) {
    const event = lead.assignmentEvents[0]
    const rule = event?.rule
    if (!lead.slaAlertedAt) {
      const claimed = await prisma.lead.updateMany({ where: { id: lead.id, slaAlertedAt: null }, data: { slaAlertedAt: now } })
      if (claimed.count > 0) {
        alerted += 1
        await notifyManagers({
          type: 'lead_sla', title: 'Lead response SLA breached',
          subtitle: `${lead.contact.name} has not received a first response.`, href: '/lead-routing',
          metadata: { leadId: lead.id, assignedToId: lead.assignedToId, responseDueAt: lead.responseDueAt?.toISOString() },
          emailSubject: `Lead SLA breached: ${lead.contact.name}`,
          emailHtml: `<p>Lead <strong>${lead.contact.name}</strong> (${lead.contact.phone}) has missed its first-response SLA.</p>`,
          whatsappText: `Lead SLA breached: ${lead.contact.name} has not received a first response.`,
        })
      }
    }

    if (!rule?.escalationEnabled || !lead.responseDueAt || lead.slaEscalatedAt) continue
    const escalationAt = addBusinessMinutes(lead.responseDueAt, rule.escalationAfterMinutes, businessHoursFromRule({
      enabled: rule.businessHoursEnabled, startMinute: rule.businessHoursStartMinute,
      endMinute: rule.businessHoursEndMinute, businessDays: rule.businessDays,
    }))
    if (now < escalationAt) continue

    const didEscalate = await prisma.$transaction(async tx => {
      const claimed = await tx.lead.updateMany({ where: { id: lead.id, firstResponseAt: null, slaEscalatedAt: null }, data: { slaEscalatedAt: now } })
      if (claimed.count === 0) return false
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "LeadRoutingRule" WHERE "id" = ${rule.id} FOR UPDATE`)
      const lockedRule = await tx.leadRoutingRule.findUnique({ where: { id: rule.id } })
      if (!lockedRule) return false
      const eligible = await tx.staff.findMany({ where: { id: { in: lockedRule.staffIds }, status: { not: 'Inactive' } }, select: { id: true, name: true } })
      const alternates = eligible.filter(staff => staff.id !== lead.assignedToId)
      if (alternates.length === 0) return false
      let selected = alternates[0]
      if (lockedRule.mode === 'FIXED') selected = alternates.find(staff => staff.id === lockedRule.fixedStaffId) ?? alternates[0]
      else if (lockedRule.mode === 'LEAST_LOADED') {
        const counts = await Promise.all(alternates.map(async staff => ({ staff, count: await tx.lead.count({ where: { assignedToId: staff.id, status: { in: [...OPEN_STATUSES] } } }) })))
        counts.sort((a, b) => a.count - b.count || a.staff.id - b.staff.id)
        selected = counts[0].staff
      } else {
        selected = alternates[lockedRule.roundRobinCursor % alternates.length]
        await tx.leadRoutingRule.update({ where: { id: lockedRule.id }, data: { roundRobinCursor: (lockedRule.roundRobinCursor + 1) % alternates.length } })
      }
      const assignedAt = new Date()
      const responseDueAt = addBusinessMinutes(assignedAt, lockedRule.responseSlaMinutes, businessHoursFromRule({ enabled: lockedRule.businessHoursEnabled, startMinute: lockedRule.businessHoursStartMinute, endMinute: lockedRule.businessHoursEndMinute, businessDays: lockedRule.businessDays }))
      await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: selected.id, assignedAt, responseDueAt, assignmentReason: `SLA escalation: ${lockedRule.name}`, slaAlertedAt: null, slaEscalatedAt: null } })
      await tx.leadAssignmentEvent.create({ data: { leadId: lead.id, ruleId: lockedRule.id, fromStaffId: lead.assignedToId, toStaffId: selected.id, reason: `SLA escalation: ${lockedRule.name}`, assignedAt, responseDueAt } })
      return true
    })
    if (didEscalate) {
      escalated += 1
      await notifyManagers({ type: 'lead_sla', title: 'Lead escalated after SLA breach', subtitle: `${lead.contact.name} was reassigned to the next available agent.`, href: '/lead-routing', metadata: { leadId: lead.id }, emailSubject: `Lead escalated: ${lead.contact.name}`, emailHtml: `<p>Lead <strong>${lead.contact.name}</strong> was automatically reassigned after its response SLA breach.</p>`, whatsappText: `Lead escalated: ${lead.contact.name} was reassigned after its SLA breach.` })
    }
  }
  revalidatePath('/leads'); revalidatePath('/lead-routing')
  return { alerted, escalated }
}

export async function markLeadResponded(leadId: number) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER', 'STAFF')
    if (!Number.isInteger(leadId) || leadId <= 0) return { success: false, error: 'Invalid lead id' }
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true, firstResponseAt: true } })
    if (!lead) return { success: false, error: 'Lead not found' }
    if (session.user.role === 'STAFF' && lead.assignedToId !== session.user.staffId) return { success: false, error: 'This lead is not assigned to you' }
    if (lead.firstResponseAt) return { success: true, data: { alreadyResponded: true, firstResponseAt: lead.firstResponseAt.toISOString() } }
    const respondedAt = new Date()
    await prisma.$transaction(async tx => {
      await tx.lead.update({ where: { id: leadId }, data: { firstResponseAt: respondedAt } })
      const event = await tx.leadAssignmentEvent.findFirst({ where: { leadId, respondedAt: null }, orderBy: { assignedAt: 'desc' } })
      if (event) await tx.leadAssignmentEvent.update({ where: { id: event.id }, data: { respondedAt } })
    })
    revalidatePath('/leads'); revalidatePath('/lead-routing')
    return { success: true, data: { alreadyResponded: false, firstResponseAt: respondedAt.toISOString() } }
  } catch {
    return { success: false, error: 'Could not record the first response' }
  }
}
