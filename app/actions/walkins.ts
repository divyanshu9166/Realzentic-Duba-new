'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createWalkinSchema } from '@/lib/validations/walkin'
import type { WalkinStatus } from '@prisma/client'

const statusMap: Record<string, WalkinStatus> = {
  'Browsing': 'BROWSING', 'Interested': 'INTERESTED',
  'Follow-up': 'FOLLOW_UP', 'Converted': 'CONVERTED', 'Left': 'LEFT',
}
const statusDisplay: Record<WalkinStatus, string> = {
  BROWSING: 'Browsing', INTERESTED: 'Interested',
  FOLLOW_UP: 'Follow-up', CONVERTED: 'Converted', LEFT: 'Left',
}

export async function getWalkins() {
  const walkins = await prisma.walkin.findMany({
    include: { contact: true, assignedTo: true },
    orderBy: { date: 'desc' },
  })

  return {
    success: true,
    data: walkins.map(w => ({
      id: w.id,
      name: w.contact.name,
      phone: w.contact.phone,
      email: w.contact.email,
      requirement: w.requirement,
      assignedTo: w.assignedTo?.name || null,
      date: w.date.toISOString().split('T')[0],
      time: w.time,
      status: statusDisplay[w.status],
      budget: w.budget,
      notes: w.notes,
      source: w.source,
      visitDuration: w.visitDuration,
    })),
  }
}

export async function createWalkin(data: unknown) {
  const parsed = createWalkinSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { name, phone, email, requirement, assignedToId, budget, notes } = parsed.data

  let contact = await prisma.contact.findFirst({ where: { phone } })
  if (!contact) {
    contact = await prisma.contact.create({
      data: { name, phone, email: email || null, source: 'Walk-in' },
    })
  }

  const now = new Date()
  const walkin = await prisma.walkin.create({
    data: {
      contactId: contact.id,
      requirement,
      assignedToId,
      date: now,
      time: now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true }),
      budget,
      notes,
    },
  })

  revalidatePath('/walkins')
  return { success: true, data: walkin }
}

export async function updateWalkinStatus(id: number, status: string) {
  const dbStatus = statusMap[status]
  if (!dbStatus) return { success: false, error: 'Invalid status' }

  const walkin = await prisma.walkin.update({
    where: { id },
    data: { status: dbStatus },
  })

  revalidatePath('/walkins')
  return { success: true, data: walkin }
}
