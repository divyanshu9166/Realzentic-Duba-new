'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import {
  LeadStatus,
  WalkinStatus,
} from '@prisma/client'

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000

const getDraftExpiry = (now: Date) => new Date(now.getTime() + DRAFT_TTL_MS)

const leadStatusValues = new Set(Object.values(LeadStatus))
const walkinStatusValues = new Set(Object.values(WalkinStatus))

function coerceEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  if (typeof value === 'string' && allowed.has(value)) return value as T
  return fallback
}

// ─── MOVE FIELD VISIT TO DRAFT ─────────────────────────

export async function moveSelfVisitToDraft(visitId: number) {
  const visit = await prisma.fieldVisit.findUnique({
    where: { id: visitId },
    include: { staff: { select: { name: true } } },
  })
  if (!visit) return { success: false, error: 'Visit not found' }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS)

  const snapshot = {
    displayId: visit.displayId,
    staffName: visit.staff.name,
    staffId: visit.staffId,
    customer: visit.customer,
    address: visit.address,
    date: visit.date.toISOString(),
    time: visit.time,
    status: visit.status,
    type: visit.type,
    notes: visit.notes,
    staffNotes: visit.staffNotes,
    measurements: visit.measurements,
    photos: visit.photos,
    photoUrls: visit.photoUrls,
    title: visit.customer,
    subtitle: `Field Visit · ${visit.type}`,
  }

  await prisma.$transaction([
    prisma.draft.create({
      data: {
        sourceType: 'FieldVisit',
        sourceId: visit.displayId,
        data: snapshot,
        deletedBy: visit.staff.name,
        deletedAt: now,
        expiresAt,
      },
    }),
    prisma.fieldVisit.delete({ where: { id: visitId } }),
  ])

  revalidatePath('/staff-portal')
  revalidatePath('/staff')
  revalidatePath('/drafts')
  return { success: true }
}

// ─── MOVE LEAD TO DRAFT ─────────────────────────────

export async function moveLeadToDraft(leadId: number) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      contact: true,
      followUps: true,
      assignedTo: { select: { name: true } },
    },
  })
  if (!lead) return { success: false, error: 'Lead not found' }

  const now = new Date()
  const expiresAt = getDraftExpiry(now)

  const snapshot = {
    displayId: `LEAD-${lead.id}`,
    customer: lead.contact.name,
    phone: lead.contact.phone,
    email: lead.contact.email,
    address: lead.contact.address,
    status: lead.status,
    interest: lead.interest,
    budget: lead.budget,
    source: lead.source,
    date: lead.date.toISOString(),
    notes: lead.notes,
    assignedToId: lead.assignedToId,
    assignedTo: lead.assignedTo?.name || null,
    followUps: lead.followUps.map(f => ({
      day: f.day,
      message: f.message,
      sent: f.sent,
      date: f.date.toISOString(),
    })),
    title: lead.contact.name,
    subtitle: lead.interest ? `Lead · ${lead.interest}` : 'Lead',
  }

  await prisma.$transaction([
    prisma.draft.create({
      data: {
        sourceType: 'Lead',
        sourceId: snapshot.displayId,
        data: snapshot,
        deletedBy: 'Manager',
        deletedAt: now,
        expiresAt,
      },
    }),
    prisma.lead.delete({ where: { id: leadId } }),
  ])

  revalidatePath('/leads')
  revalidatePath('/drafts')
  return { success: true }
}

// ─── MOVE WALK-IN TO DRAFT ─────────────────────────

export async function moveWalkinToDraft(walkinId: number) {
  const walkin = await prisma.walkin.findUnique({
    where: { id: walkinId },
    include: { contact: true, assignedTo: { select: { name: true } } },
  })
  if (!walkin) return { success: false, error: 'Walk-in not found' }

  const now = new Date()
  const expiresAt = getDraftExpiry(now)

  const snapshot = {
    displayId: `WALKIN-${walkin.id}`,
    customer: walkin.contact.name,
    phone: walkin.contact.phone,
    email: walkin.contact.email,
    address: walkin.contact.address,
    requirement: walkin.requirement,
    assignedToId: walkin.assignedToId,
    assignedTo: walkin.assignedTo?.name || null,
    date: walkin.date.toISOString(),
    time: walkin.time,
    status: walkin.status,
    budget: walkin.budget,
    notes: walkin.notes,
    source: walkin.source,
    visitDuration: walkin.visitDuration,
    title: walkin.contact.name,
    subtitle: walkin.requirement ? `Walk-in · ${walkin.requirement}` : 'Walk-in',
  }

  await prisma.$transaction([
    prisma.draft.create({
      data: {
        sourceType: 'Walkin',
        sourceId: snapshot.displayId,
        data: snapshot,
        deletedBy: 'Manager',
        deletedAt: now,
        expiresAt,
      },
    }),
    prisma.walkin.delete({ where: { id: walkinId } }),
  ])

  revalidatePath('/walkins')
  revalidatePath('/drafts')
  return { success: true }
}

// ─── MOVE APPOINTMENT TO DRAFT ──────────────────────

export async function moveAppointmentToDraft(appointmentId: number) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { contact: true },
  })
  if (!appointment) return { success: false, error: 'Appointment not found' }

  const now = new Date()
  const expiresAt = getDraftExpiry(now)

  const snapshot = {
    displayId: `APT-${appointment.id}`,
    customer: appointment.contact.name,
    phone: appointment.contact.phone,
    address: appointment.contact.address,
    date: appointment.date.toISOString(),
    time: appointment.time,
    purpose: appointment.purpose,
    status: appointment.status,
    notes: appointment.notes,
    title: appointment.contact.name,
    subtitle: appointment.purpose ? `Appointment · ${appointment.purpose}` : 'Appointment',
  }

  await prisma.$transaction([
    prisma.draft.create({
      data: {
        sourceType: 'Appointment',
        sourceId: snapshot.displayId,
        data: snapshot,
        deletedBy: 'Manager',
        deletedAt: now,
        expiresAt,
      },
    }),
    prisma.appointment.delete({ where: { id: appointmentId } }),
  ])

  revalidatePath('/appointments')
  revalidatePath('/drafts')
  return { success: true }
}

// ─── MOVE EXPENSE TO DRAFT ──────────────────────────

export async function moveExpenseToDraft(expenseId: number) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { category: true, staff: { select: { name: true } } },
  })
  if (!expense) return { success: false, error: 'Expense not found' }

  const now = new Date()
  const expiresAt = getDraftExpiry(now)

  const snapshot = {
    displayId: `EXP-${expense.id}`,
    date: expense.date.toISOString(),
    categoryId: expense.categoryId,
    categoryName: expense.category?.name,
    categoryColor: expense.category?.color,
    categoryIcon: expense.category?.icon,
    amount: expense.amount,
    description: expense.description,
    paymentMode: expense.paymentMode,
    reference: expense.reference,
    receipt: expense.receipt,
    vendor: expense.vendor,
    staffId: expense.staffId,
    staffName: expense.staff?.name || null,
    status: expense.status,
    approvedBy: expense.approvedBy,
    isRecurring: expense.isRecurring,
    notes: expense.notes,
    title: expense.vendor || expense.description,
    subtitle: `Expense · AED ${expense.amount}`,
  }

  await prisma.$transaction(async (tx) => {
    if (expense.paymentMode === 'Cash') {
      const dateOnly = new Date(expense.date.toISOString().split('T')[0] + 'T00:00:00')
      await tx.dailyCashRegister.updateMany({
        where: { date: dateOnly },
        data: { cashOut: { decrement: expense.amount } },
      })
    }

    await tx.draft.create({
      data: {
        sourceType: 'Expense',
        sourceId: snapshot.displayId,
        data: snapshot,
        deletedBy: 'Manager',
        deletedAt: now,
        expiresAt,
      },
    })

    await tx.expense.delete({ where: { id: expenseId } })
  })

  revalidatePath('/expenses')
  revalidatePath('/drafts')
  return { success: true }
}

// ─── GET ALL DRAFTS ────────────────────────────────────

export async function getDrafts() {
  // Auto-purge expired drafts first
  await prisma.draft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  const drafts = await prisma.draft.findMany({
    orderBy: { deletedAt: 'desc' },
  })

  return {
    success: true,
    data: drafts.map(d => ({
      id: d.id,
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      data: d.data as Record<string, unknown>,
      deletedBy: d.deletedBy,
      deletedAt: d.deletedAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      daysLeft: Math.max(0, Math.ceil((d.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    })),
  }
}

// ─── RESTORE FROM DRAFT ─────────────────────────────────

export async function restoreFromDraft(draftId: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const draft = await prisma.draft.findUnique({ where: { id: draftId } })
  if (!draft) return { success: false, error: 'Draft not found' }

  if (draft.sourceType === 'FieldVisit') {
    const data = draft.data as Record<string, unknown>

    const count = await prisma.fieldVisit.count({ where: { staffId: data.staffId as number } })
    const displayId = `SV-${data.staffId}-${count + 1}`

    await prisma.$transaction([
      prisma.fieldVisit.create({
        data: {
          displayId,
          staffId: data.staffId as number,
          customer: data.customer as string,
          address: data.address as string,
          date: new Date(data.date as string),
          time: data.time as string,
          status: (data.status as string) || 'Completed',
          type: data.type as string,
          notes: (data.notes as string) || null,
          staffNotes: (data.staffNotes as string) || null,
          measurements: data.measurements as object || undefined,
          photos: (data.photos as number) || 0,
          photoUrls: (data.photoUrls as string[]) || [],
        },
      }),
      prisma.draft.delete({ where: { id: draftId } }),
    ])

    revalidatePath('/staff-portal')
    revalidatePath('/staff')
    revalidatePath('/drafts')
    return { success: true, data: { displayId } }
  }

  if (draft.sourceType === 'Lead') {
    const data = draft.data as Record<string, any>

    let contact = await prisma.contact.findFirst({ where: { phone: data.phone as string } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: data.customer as string,
          phone: data.phone as string,
          email: (data.email as string) || null,
          address: (data.address as string) || null,
          source: 'Lead',
        },
      })
    } else if (
      (data.customer && contact.name !== data.customer) ||
      (data.email && contact.email !== data.email) ||
      (data.address && contact.address !== data.address)
    ) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          name: data.customer as string,
          email: (data.email as string) || contact.email,
          address: (data.address as string) || contact.address,
        },
      })
    }

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          contactId: contact.id,
          interest: data.interest as string,
          budget: (data.budget as string) || null,
          status: coerceEnum(data.status, leadStatusValues, LeadStatus.NEW),
          source: (data.source as string) || null,
          date: data.date ? new Date(data.date as string) : new Date(),
          notes: (data.notes as string) || null,
          assignedToId: (data.assignedToId as number) || null,
          followUps: {
            create: Array.isArray(data.followUps)
              ? data.followUps.map((f: any) => ({
                day: f.day,
                message: f.message,
                sent: !!f.sent,
                date: new Date(f.date),
              }))
              : [],
          },
        },
      })

      await tx.draft.delete({ where: { id: draftId } })
      return created
    })

    revalidatePath('/leads')
    revalidatePath('/drafts')
    return { success: true, data: { id: lead.id } }
  }

  if (draft.sourceType === 'Walkin') {
    const data = draft.data as Record<string, any>

    let contact = await prisma.contact.findFirst({ where: { phone: data.phone as string } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: data.customer as string,
          phone: data.phone as string,
          email: (data.email as string) || null,
          address: (data.address as string) || null,
          source: 'Walk-in',
        },
      })
    } else if (
      (data.customer && contact.name !== data.customer) ||
      (data.email && contact.email !== data.email) ||
      (data.address && contact.address !== data.address)
    ) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          name: data.customer as string,
          email: (data.email as string) || contact.email,
          address: (data.address as string) || contact.address,
        },
      })
    }

    const walkin = await prisma.$transaction(async (tx) => {
      const created = await tx.walkin.create({
        data: {
          contactId: contact.id,
          requirement: data.requirement as string,
          assignedToId: (data.assignedToId as number) || null,
          date: data.date ? new Date(data.date as string) : new Date(),
          time: data.time as string,
          status: coerceEnum(data.status, walkinStatusValues, WalkinStatus.BROWSING),
          budget: (data.budget as string) || null,
          notes: (data.notes as string) || null,
          source: (data.source as string) || 'Walk-in',
          visitDuration: (data.visitDuration as string) || null,
        },
      })

      await tx.draft.delete({ where: { id: draftId } })
      return created
    })

    revalidatePath('/walkins')
    revalidatePath('/drafts')
    return { success: true, data: { id: walkin.id } }
  }

  if (draft.sourceType === 'Appointment') {
    const data = draft.data as Record<string, any>

    let contact = await prisma.contact.findFirst({ where: { phone: data.phone as string } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: data.customer as string,
          phone: data.phone as string,
          address: (data.address as string) || null,
          source: 'Appointment',
        },
      })
    } else if (
      (data.customer && contact.name !== data.customer) ||
      (data.address && contact.address !== data.address)
    ) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          name: data.customer as string,
          address: (data.address as string) || contact.address,
        },
      })
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          contactId: contact.id,
          date: data.date ? new Date(data.date as string) : new Date(),
          time: data.time as string,
          purpose: data.purpose as string,
          status: (data.status as string) || 'Scheduled',
          notes: (data.notes as string) || null,
        },
      })

      await tx.draft.delete({ where: { id: draftId } })
      return created
    })

    revalidatePath('/appointments')
    revalidatePath('/drafts')
    return { success: true, data: { id: appointment.id } }
  }

  if (draft.sourceType === 'Expense') {
    const data = draft.data as Record<string, any>

    let categoryId = data.categoryId as number | undefined
    if (categoryId) {
      const existing = await prisma.expenseCategory.findUnique({ where: { id: categoryId } })
      if (!existing) categoryId = undefined
    }
    if (!categoryId && data.categoryName) {
      const existingByName = await prisma.expenseCategory.findFirst({ where: { name: data.categoryName as string } })
      if (existingByName) {
        categoryId = existingByName.id
      } else {
        const created = await prisma.expenseCategory.create({
          data: {
            name: data.categoryName as string,
            color: data.categoryColor || null,
            icon: data.categoryIcon || null,
          },
        })
        categoryId = created.id
      }
    }
    if (!categoryId) return { success: false, error: 'Expense category missing' }

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          date: data.date ? new Date(data.date as string) : new Date(),
          categoryId,
          amount: data.amount as number,
          description: data.description as string,
          paymentMode: (data.paymentMode as string) || 'Cash',
          reference: (data.reference as string) || null,
          receipt: (data.receipt as string) || null,
          vendor: (data.vendor as string) || null,
          staffId: (data.staffId as number) || null,
          status: (data.status as string) || 'Approved',
          approvedBy: (data.approvedBy as string) || null,
          isRecurring: !!data.isRecurring,
          notes: (data.notes as string) || null,
        },
      })

      if ((data.paymentMode as string) === 'Cash') {
        const dateOnly = new Date(created.date.toISOString().split('T')[0] + 'T00:00:00')
        await tx.dailyCashRegister.upsert({
          where: { date: dateOnly },
          create: { date: dateOnly, cashOut: created.amount },
          update: { cashOut: { increment: created.amount } },
        })
      }

      await tx.draft.delete({ where: { id: draftId } })
      return created
    })

    revalidatePath('/expenses')
    revalidatePath('/drafts')
    return { success: true, data: { id: expense.id } }
  }

  return { success: false, error: 'Unsupported draft type' }
}

// ─── PERMANENTLY DELETE A DRAFT ────────────────────────

export async function permanentlyDeleteDraft(draftId: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  await prisma.draft.delete({ where: { id: draftId } })
  revalidatePath('/drafts')
  return { success: true }
}
