'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import { workOrderSchema, workOrderStatusSchema } from '@/lib/validations/work-orders'
import { workOrderDueAt } from '@/lib/work-order-sla'
import { notifyManagers } from '@/lib/notify'
import { randomBytes } from 'node:crypto'

function dateOrNull(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function displayId() {
  return `WO-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

function mapWorkOrder(order: any) {
  return {
    id: order.id, displayId: order.displayId, title: order.title, description: order.description,
    category: order.category, priority: order.priority, status: order.status, vendorName: order.vendorName,
    vendorPhone: order.vendorPhone, assignedToId: order.assignedToId, assignedToName: order.assignedTo?.name ?? null,
    vendorId: order.vendorId ?? null, vendor: order.vendor ? { id: order.vendor.id, name: order.vendor.name, phone: order.vendor.phone } : null,
    leaseId: order.leaseId, leaseNumber: order.lease?.contractNumber ?? null, bookingId: order.bookingId,
    contactId: order.contactId, contactName: order.contact?.name ?? null,
    scheduledAt: order.scheduledAt?.toISOString() ?? null, dueAt: order.dueAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null, estimatedCost: order.estimatedCost, actualCost: order.actualCost,
    resolutionNotes: order.resolutionNotes, attachments: [...(order.attachments ?? [])], expenses: (order.expenses ?? []).map((expense: any) => ({ id: expense.id, amount: expense.amount, description: expense.description, date: expense.date.toISOString() })),
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
  }
}

const orderInclude = {
  assignedTo: { select: { id: true, name: true } },
  lease: { select: { contractNumber: true } },
  contact: { select: { name: true } },
  vendor: { select: { id: true, name: true, phone: true } },
  expenses: { select: { id: true, amount: true, description: true, date: true }, orderBy: { date: 'desc' as const } },
}

async function validateRefs(input: { leaseId?: number | null; bookingId?: number | null; contactId?: number | null; assignedToId?: number | null; vendorId?: number | null }) {
  if (input.leaseId != null && !(await prisma.lease.findUnique({ where: { id: input.leaseId }, select: { id: true } }))) return 'Lease not found'
  if (input.bookingId != null && !(await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { id: true } }))) return 'Booking not found'
  if (input.contactId != null && !(await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) return 'Contact not found'
  if (input.assignedToId != null && !(await prisma.staff.findFirst({ where: { id: input.assignedToId, status: { not: 'Inactive' } }, select: { id: true } }))) return 'Assigned staff member is not active or does not exist'
  if (input.vendorId != null && !(await prisma.maintenanceVendor.findFirst({ where: { id: input.vendorId, active: true }, select: { id: true } }))) return 'Maintenance vendor is not active or does not exist'
  return null
}

export async function getWorkOrderWorkspace(filters: { status?: string; assignedToId?: number } = {}) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
    const where: Record<string, unknown> = {}
    if (filters.status && allowed.includes(filters.status)) where.status = filters.status
    if (filters.assignedToId) where.assignedToId = filters.assignedToId
    const [orders, staff, leases, vendors, schedules] = await Promise.all([
      prisma.workOrder.findMany({ where, include: orderInclude, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], take: 500 }),
      prisma.staff.findMany({ where: { status: { not: 'Inactive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.lease.findMany({ where: { status: 'ACTIVE' }, select: { id: true, contractNumber: true, contact: { select: { name: true } } }, orderBy: { endDate: 'asc' } }),
      prisma.maintenanceVendor.findMany({ where: { active: true }, select: { id: true, name: true, phone: true, categories: true }, orderBy: { name: 'asc' } }),
      prisma.maintenanceSchedule.findMany({ where: { active: true }, select: { id: true, title: true, frequency: true, nextDueAt: true, priority: true }, orderBy: { nextDueAt: 'asc' } }),
    ])
    return { success: true, data: { orders: orders.map(mapWorkOrder), staff, leases, vendors, schedules: schedules.map(schedule => ({ ...schedule, nextDueAt: schedule.nextDueAt.toISOString() })) } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function createWorkOrder(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = workOrderSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid work order' }
    const input = parsed.data
    const scheduledAt = dateOrNull(input.scheduledAt); const suppliedDueAt = dateOrNull(input.dueAt)
    const dueAt = suppliedDueAt ?? workOrderDueAt(input.priority)
    if ((input.scheduledAt && !scheduledAt) || (input.dueAt && !suppliedDueAt)) return { success: false, error: 'Work-order dates are invalid' }
    if (scheduledAt && dueAt < scheduledAt) return { success: false, error: 'Due date cannot be before scheduled date' }
    const refError = await validateRefs(input); if (refError) return { success: false, error: refError }
    const order = await prisma.workOrder.create({ data: {
      displayId: displayId(), leaseId: input.leaseId ?? null, bookingId: input.bookingId ?? null, contactId: input.contactId ?? null,
      assignedToId: input.assignedToId ?? null, title: input.title, description: input.description || null, category: input.category,
      priority: input.priority, status: input.status, vendorName: input.vendorName || null, vendorPhone: input.vendorPhone || null, vendorId: input.vendorId ?? null,
      scheduledAt, dueAt, completedAt: input.status === 'COMPLETED' ? new Date() : null, estimatedCost: input.estimatedCost,
      actualCost: 0, resolutionNotes: input.resolutionNotes || null, attachments: input.attachments,
    }, include: orderInclude })
    revalidatePath('/maintenance'); return { success: true, data: mapWorkOrder(order) }
  } catch (error) { console.error('[work-orders] create failed', error); return { success: false, error: 'Could not create work order' } }
}

export async function updateWorkOrderStatus(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = workOrderStatusSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid status update' }
    const input = parsed.data
    const order = await prisma.workOrder.update({ where: { id: input.id }, data: {
      status: input.status, actualCost: input.actualCost, resolutionNotes: input.resolutionNotes, attachments: input.attachments,
      completedAt: input.status === 'COMPLETED' ? new Date() : input.status === 'CANCELLED' ? null : undefined,
    }, include: orderInclude })
    revalidatePath('/maintenance'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not update work order' } }
}

export async function updateWorkOrderAttachments(id: number, attachments: string[]) {
  try {
    await requireRole('ADMIN', 'MANAGER', 'STAFF')
    if (!Number.isInteger(id) || id <= 0 || !Array.isArray(attachments) || attachments.length > 20 || attachments.some(url => typeof url !== 'string' || !/^https?:\/\//.test(url))) return { success: false, error: 'Invalid attachment list' }
    const session = await requireAuth()
    if (session.user.role === 'STAFF') {
      const assigned = await prisma.workOrder.findFirst({ where: { id, assignedToId: session.user.staffId }, select: { id: true } })
      if (!assigned) return { success: false, error: 'This work order is not assigned to you' }
    }
    const order = await prisma.workOrder.update({ where: { id }, data: { attachments: [...new Set(attachments)] }, include: orderInclude })
    revalidatePath('/maintenance'); revalidatePath('/staff-portal'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not save work-order attachments' } }
}

export async function createMaintenanceVendor(data: { name?: string; phone?: string; email?: string; categories?: string[]; notes?: string }) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const name = data?.name?.trim()
    if (!name || name.length < 2 || name.length > 160) return { success: false, error: 'Vendor name is required' }
    const vendor = await prisma.maintenanceVendor.create({ data: { name, phone: data.phone?.trim() || null, email: data.email?.trim() || null, categories: [...new Set((data.categories ?? []).map(value => value.trim()).filter(Boolean))], notes: data.notes?.trim() || null } })
    revalidatePath('/maintenance'); return { success: true, data: vendor }
  } catch { return { success: false, error: 'Could not create maintenance vendor' } }
}

export async function issueTenantMaintenanceLink(leaseId: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(leaseId) || leaseId <= 0) return { success: false, error: 'Invalid lease id' }
    const token = randomBytes(32).toString('hex')
    const activeLease = await prisma.lease.findFirst({ where: { id: leaseId, status: 'ACTIVE' }, select: { id: true, contractNumber: true } })
    if (!activeLease) return { success: false, error: 'Active lease not found' }
    const lease = await prisma.lease.update({ where: { id: activeLease.id }, data: { maintenanceAccessToken: token }, select: { id: true, contractNumber: true } })
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return { success: true, data: { leaseId: lease.id, contractNumber: lease.contractNumber, token, endpoint: `${baseUrl}/api/tenant-maintenance` } }
  } catch { return { success: false, error: 'Could not issue tenant maintenance link' } }
}

const scheduleFrequencies: Record<string, (date: Date) => Date> = {
  WEEKLY: (date) => new Date(date.getTime() + 7 * 86_400_000),
  MONTHLY: (date) => { const next = new Date(date); next.setMonth(next.getMonth() + 1); return next },
  QUARTERLY: (date) => { const next = new Date(date); next.setMonth(next.getMonth() + 3); return next },
  SEMI_ANNUAL: (date) => { const next = new Date(date); next.setMonth(next.getMonth() + 6); return next },
  ANNUAL: (date) => { const next = new Date(date); next.setFullYear(next.getFullYear() + 1); return next },
}

export async function createMaintenanceSchedule(data: { title?: string; description?: string; category?: string; priority?: string; leaseId?: number | null; vendorId?: number | null; assignedToId?: number | null; frequency?: string; nextDueAt?: string; estimatedCost?: number }) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const title = data?.title?.trim()
    const frequency = data.frequency ?? 'MONTHLY'
    const nextDueAt = dateOrNull(data.nextDueAt)
    if (!title || title.length < 2 || !nextDueAt || !scheduleFrequencies[frequency]) return { success: false, error: 'Title, valid frequency and next due date are required' }
    const refError = await validateRefs({ leaseId: data.leaseId, vendorId: data.vendorId, assignedToId: data.assignedToId })
    if (refError) return { success: false, error: refError }
    const schedule = await prisma.maintenanceSchedule.create({ data: { title, description: data.description?.trim() || null, category: data.category || 'GENERAL', priority: data.priority || 'MEDIUM', leaseId: data.leaseId ?? null, vendorId: data.vendorId ?? null, assignedToId: data.assignedToId ?? null, frequency, nextDueAt, estimatedCost: Math.max(0, Math.round(data.estimatedCost ?? 0)) } })
    revalidatePath('/maintenance'); return { success: true, data: schedule }
  } catch { return { success: false, error: 'Could not create maintenance schedule' } }
}

export async function processMaintenanceSchedules() {
  const now = new Date()
  const schedules = await prisma.maintenanceSchedule.findMany({ where: { active: true, nextDueAt: { lte: now } }, take: 200 })
  let created = 0
  for (const schedule of schedules) {
    const didCreate = await prisma.$transaction(async tx => {
      const claimed = await tx.maintenanceSchedule.updateMany({ where: { id: schedule.id, active: true, nextDueAt: { lte: now }, lastSpawnedAt: schedule.lastSpawnedAt }, data: { lastSpawnedAt: now } })
      if (claimed.count === 0) return false
      const lease = schedule.leaseId ? await tx.lease.findUnique({ where: { id: schedule.leaseId }, select: { contactId: true } }) : null
      await tx.workOrder.create({ data: { displayId: displayId(), title: schedule.title, description: schedule.description, category: schedule.category, priority: schedule.priority, status: 'SCHEDULED', leaseId: schedule.leaseId, contactId: lease?.contactId ?? null, vendorId: schedule.vendorId, assignedToId: schedule.assignedToId, scheduledAt: now, dueAt: workOrderDueAt(schedule.priority, now), estimatedCost: schedule.estimatedCost, maintenanceScheduleId: schedule.id } })
      let nextDueAt = scheduleFrequencies[schedule.frequency](schedule.nextDueAt)
      while (nextDueAt <= now) nextDueAt = scheduleFrequencies[schedule.frequency](nextDueAt)
      await tx.maintenanceSchedule.update({ where: { id: schedule.id }, data: { nextDueAt } })
      return true
    })
    if (didCreate) created += 1
  }
  revalidatePath('/maintenance')
  return { created }
}

export async function processWorkOrderSlaBreaches() {
  const now = new Date()
  const orders = await prisma.workOrder.findMany({ where: { status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] }, dueAt: { lt: now }, breachAlertedAt: null }, select: { id: true, displayId: true, title: true, priority: true, assignedTo: { select: { name: true } } }, take: 250 })
  let alerted = 0
  for (const order of orders) {
    const claim = await prisma.workOrder.updateMany({ where: { id: order.id, breachAlertedAt: null }, data: { breachAlertedAt: now } })
    if (claim.count === 0) continue
    alerted += 1
    await notifyManagers({ type: 'maintenance_alert', title: 'Maintenance SLA breached', subtitle: `${order.displayId} · ${order.title} is overdue.`, href: '/maintenance', metadata: { workOrderId: order.id, priority: order.priority }, emailSubject: `Maintenance SLA breached: ${order.displayId}`, emailHtml: `<p>Work order <strong>${order.displayId}</strong> is overdue.</p>`, whatsappText: `Maintenance SLA breached: ${order.displayId} is overdue.` })
  }
  revalidatePath('/maintenance')
  return { alerted }
}

export async function assignWorkOrder(id: number, assignedToId: number | null) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Invalid work-order id' }
    if (assignedToId != null && !(await prisma.staff.findFirst({ where: { id: assignedToId, status: { not: 'Inactive' } }, select: { id: true } }))) return { success: false, error: 'Assigned staff member is not active or does not exist' }
    const order = await prisma.workOrder.update({ where: { id }, data: { assignedToId }, include: orderInclude })
    revalidatePath('/maintenance'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not assign work order' } }
}

export async function linkExpenseToWorkOrder(expenseId: number, workOrderId: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(expenseId) || !Number.isInteger(workOrderId) || expenseId <= 0 || workOrderId <= 0) return { success: false, error: 'Invalid expense or work-order id' }
    const [expense, order] = await Promise.all([
      prisma.expense.findUnique({ where: { id: expenseId }, select: { id: true, amount: true } }),
      prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } }),
    ])
    if (!expense) return { success: false, error: 'Expense not found' }
    if (!order) return { success: false, error: 'Work order not found' }
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.expense.update({ where: { id: expenseId }, data: { workOrderId } })
      const aggregate = await tx.expense.aggregate({ where: { workOrderId }, _sum: { amount: true } })
      const updatedOrder = await tx.workOrder.update({ where: { id: workOrderId }, data: { actualCost: aggregate._sum.amount ?? 0 }, include: orderInclude })
      return { updated, updatedOrder }
    })
    revalidatePath('/maintenance'); revalidatePath('/expenses'); return { success: true, data: mapWorkOrder(result.updatedOrder) }
  } catch { return { success: false, error: 'Could not link expense to work order' } }
}

/** Staff-side queue: only the authenticated user's assigned work orders. */
export async function getStaffWorkOrders() {
  try {
    const session = await requireAuth()
    const staffId = session.user.staffId
    if (!staffId) return { success: false, error: 'Your account is not linked to a staff profile' }
    const orders = await prisma.workOrder.findMany({ where: { assignedToId: staffId }, include: orderInclude, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], take: 200 })
    return { success: true, data: orders.map(mapWorkOrder) }
  } catch { return { success: false, error: 'Could not load assigned work orders' } }
}

/** Staff may update progress and resolution notes, but cannot reassign or edit costs. */
export async function updateStaffWorkOrder(data: unknown) {
  try {
    const session = await requireAuth()
    const parsed = workOrderStatusSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid work-order update' }
    if (!session.user.staffId) return { success: false, error: 'Your account is not linked to a staff profile' }
    const existing = await prisma.workOrder.findFirst({ where: { id: parsed.data.id, assignedToId: session.user.staffId }, select: { id: true } })
    if (!existing) return { success: false, error: 'This work order is not assigned to you' }
    const order = await prisma.workOrder.update({ where: { id: existing.id }, data: { status: parsed.data.status, resolutionNotes: parsed.data.resolutionNotes, attachments: parsed.data.attachments, completedAt: parsed.data.status === 'COMPLETED' ? new Date() : parsed.data.status === 'CANCELLED' ? null : undefined }, include: orderInclude })
    revalidatePath('/maintenance'); revalidatePath('/staff-portal'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not update assigned work order' } }
}
