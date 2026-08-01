'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createLeadSchema, updateLeadStatusSchema, addFollowUpSchema } from '@/lib/validations/lead'
import type { LeadStatus } from '@prisma/client'
import { moveLeadToDraft } from './drafts'
import {
  isDuplicate,
  duplicateConfidence,
  dedupGroups,
  normalizePhone,
  type DedupRecord,
} from '@/lib/dedup'

const statusMap: Record<string, LeadStatus> = {
  'New': 'NEW',
  'Contacted': 'CONTACTED',
  'Site Visit': 'SHOWROOM_VISIT',
  'Showroom Visit': 'SHOWROOM_VISIT',
  'Quotation': 'QUOTATION',
  'Won': 'WON',
  'Lost': 'LOST',
}

const statusDisplayMap: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  SHOWROOM_VISIT: 'Site Visit',
  QUOTATION: 'Quotation',
  WON: 'Won',
  LOST: 'Lost',
}

export async function getLeads(status?: string) {
  const where = status && statusMap[status] ? { status: statusMap[status] } : {}

  const leads = await prisma.lead.findMany({
    where,
    include: { contact: true, followUps: true, assignedTo: true },
    orderBy: { date: 'desc' },
  })

  return {
    success: true,
    data: leads.map(l => ({
      id: l.id,
      contactId: l.contactId,
      name: l.contact.name,
      phone: l.contact.phone,
      email: l.contact.email,
      source: l.source,
      interest: l.interest,
      budget: l.budget,
      status: statusDisplayMap[l.status],
      date: l.date.toISOString().split('T')[0],
      notes: l.notes,
      assignedTo: l.assignedTo?.name || null,
      followUps: l.followUps.map(f => ({
        day: f.day,
        message: f.message,
        sent: f.sent,
        date: f.date.toISOString().split('T')[0],
      })),
    })),
  }
}

export async function getLead(id: number) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { contact: true, followUps: true, assignedTo: true },
  })
  if (!lead) return { success: false, error: 'Lead not found' }
  return { success: true, data: lead }
}

export async function createLead(data: unknown) {
  const parsed = createLeadSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { name, phone, email, source, interest, budget, notes } = parsed.data

  // Find or create contact. Req 11.7: if the phone already exists on a Contact,
  // link the new lead to that existing Contact instead of creating a duplicate,
  // preserving the unique phone constraint. We match first on the exact stored
  // phone (fast, unique index) and then fall back to a normalized comparison so
  // differently-formatted variants of the same number still resolve to one
  // Contact.
  let contact = await prisma.contact.findFirst({ where: { phone } })
  if (!contact) {
    const normalizedTarget = normalizePhone(phone)
    if (normalizedTarget) {
      const candidates = await prisma.contact.findMany({
        select: { id: true, phone: true },
      })
      const match = candidates.find(c => normalizePhone(c.phone) === normalizedTarget)
      if (match) {
        contact = await prisma.contact.findUnique({ where: { id: match.id } })
      }
    }
  }
  if (!contact) {
    contact = await prisma.contact.create({
      data: { name, phone, email: email || null, source },
    })
  }

  const lead = await prisma.lead.create({
    data: {
      contactId: contact.id,
      interest,
      budget,
      status: 'NEW',
      source,
      notes,
    },
  })

  revalidatePath('/leads')
  return { success: true, data: lead }
}

export async function updateLeadStatus(data: unknown) {
  const parsed = updateLeadStatusSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const lead = await prisma.lead.update({
    where: { id: parsed.data.id },
    data: { status: parsed.data.status },
  })

  revalidatePath('/leads')
  return { success: true, data: lead }
}

export async function updateLead(id: number, data: Partial<{
  interest: string; budget: string; notes: string; source: string;
}>) {
  const lead = await prisma.lead.update({
    where: { id },
    data,
  })

  revalidatePath('/leads')
  return { success: true, data: lead }
}

export async function deleteLead(id: number) {
  return moveLeadToDraft(id)
}

export async function addFollowUp(data: unknown) {
  const parsed = addFollowUpSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const followUp = await prisma.followUp.create({
    data: {
      leadId: parsed.data.leadId,
      day: parsed.data.day,
      message: parsed.data.message,
      date: new Date(parsed.data.date),
      sent: false,
    },
  })

  revalidatePath('/leads')
  return { success: true, data: followUp }
}

export async function getLeadPipelineCounts() {
  const counts = await prisma.lead.groupBy({
    by: ['status'],
    _count: true,
  })

  const pipeline: Record<string, number> = {}
  for (const c of counts) {
    pipeline[statusDisplayMap[c.status]] = c._count
  }

  return { success: true, data: pipeline }
}

// ─── Duplicate Lead Detection (Module 8) ─────────────────────────────────────

/** A candidate lead/contact to check for duplicates. */
export interface DuplicateCandidate {
  name: string
  phone: string
  email?: string | null
}

/** A matched existing Contact with its duplicate-confidence score. */
export interface DuplicateMatch {
  id: number
  name: string
  phone: string
  email: string | null
  confidence: number
}

/**
 * Contact fields a user may resolve per-field when merging two records.
 * Each choice selects whether the surviving Contact keeps the `target`
 * (default) or adopts the `source` value for that field.
 */
const MERGEABLE_FIELDS = [
  'name',
  'phone',
  'email',
  'address',
  'state',
  'source',
  'notes',
  'emailSubscribed',
] as const

export type MergeableField = (typeof MERGEABLE_FIELDS)[number]
export type FieldChoices = Partial<Record<MergeableField, 'source' | 'target'>>

/**
 * Find existing Contacts that are potential duplicates of `candidate`.
 *
 * Req 11.1: matches by exact normalized phone, exact case-insensitive email,
 * or a full-name Levenshtein distance < 3. Each match is returned with an
 * integer confidence score in [0, 100] (Req 11.2 via `duplicateConfidence`),
 * sorted strongest-first.
 */
export async function findDuplicates(candidate: DuplicateCandidate) {
  if (!candidate || (!candidate.name && !candidate.phone && !candidate.email)) {
    return { success: false as const, error: 'A candidate name, phone, or email is required' }
  }

  const cand: DedupRecord = {
    name: candidate.name ?? '',
    phone: candidate.phone ?? '',
    email: candidate.email ?? null,
  }

  const contacts = await prisma.contact.findMany({
    select: { id: true, name: true, phone: true, email: true },
  })

  const matches: DuplicateMatch[] = []
  for (const c of contacts) {
    const existing: DedupRecord = { id: c.id, name: c.name, phone: c.phone, email: c.email }
    if (isDuplicate(cand, existing)) {
      matches.push({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        confidence: duplicateConfidence(cand, existing),
      })
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence)
  return { success: true as const, data: matches }
}

/**
 * Merge the `source` Contact into the `target` Contact.
 *
 * Runs inside a single transaction (Req 11.4 / 20.6): all linked records
 * (leads, appointments, walkins, call logs, conversations, reviews, payments,
 * cost sheets, bookings, deals, KYC records, buyer sessions, support tickets,
 * cost sheets, bookings, deals, KYC records, buyer sessions, and support tickets)
 * are reassigned from the source to the target, the per-field `fieldChoices`
 * are applied to the surviving target Contact, and the source Contact is deleted.
 * Any failure rolls the whole operation back so both Contacts remain in their
 * pre-merge state (Req 11.4).
 */
export async function mergeContacts(
  targetId: number,
  sourceId: number,
  fieldChoices: FieldChoices = {}
) {
  if (targetId === sourceId) {
    return { success: false as const, error: 'Cannot merge a contact into itself' }
  }

  try {
    const merged = await prisma.$transaction(async tx => {
      const target = await tx.contact.findUnique({ where: { id: targetId } })
      const source = await tx.contact.findUnique({ where: { id: sourceId } })
      if (!target) throw new Error('Target contact not found')
      if (!source) throw new Error('Source contact not found')

      // Reassign every record linked to the source onto the target so no
      // history is lost (Req 11.3). Done before deleting the source to satisfy
      // foreign-key constraints.
      const reassign = { where: { contactId: sourceId }, data: { contactId: targetId } }
      await tx.lead.updateMany(reassign)
      await tx.appointment.updateMany(reassign)
      await tx.walkin.updateMany(reassign)
      await tx.callLog.updateMany(reassign)
      await tx.conversation.updateMany(reassign)
      await tx.review.updateMany(reassign)
      await tx.dailyPayment.updateMany(reassign)
      await tx.costSheet.updateMany(reassign)
      await tx.booking.updateMany(reassign)
      await tx.deal.updateMany(reassign)
      await tx.kYCRecord.updateMany(reassign)
      await tx.buyerSession.updateMany(reassign)
      await tx.supportTicket.updateMany(reassign)

      // Apply per-field selections. Default to the target's existing value;
      // adopt the source value only where the user chose 'source'.
      const updateData: Record<string, unknown> = {}
      for (const field of MERGEABLE_FIELDS) {
        if (fieldChoices[field] === 'source') {
          updateData[field] = (source as Record<string, unknown>)[field]
        }
      }

      // Delete the source first so a chosen source phone/email frees the
      // unique constraint before the target adopts it.
      await tx.contact.delete({ where: { id: sourceId } })

      if (Object.keys(updateData).length > 0) {
        return tx.contact.update({ where: { id: targetId }, data: updateData })
      }
      return target
    })

    revalidatePath('/leads')
    return { success: true as const, data: merged }
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : 'Merge did not complete; no changes were made',
    }
  }
}

/**
 * Produce the deduplication report (Req 11.6): the set of duplicate groups
 * across all Contacts, where each group contains 2 or more Contacts matched by
 * the Req 11.1 criteria. Returns an empty array when no duplicates exist.
 */
export async function dedupReport() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, name: true, phone: true, email: true },
    orderBy: { id: 'asc' },
  })

  const records: (DedupRecord & { id: number })[] = contacts.map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
  }))

  const groups = dedupGroups(records)
  return { success: true as const, data: groups }
}
