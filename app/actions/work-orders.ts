'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import { workOrderSchema, workOrderStatusSchema } from '@/lib/validations/work-orders'

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
    leaseId: order.leaseId, leaseNumber: order.lease?.contractNumber ?? null, bookingId: order.bookingId,
    contactId: order.contactId, contactName: order.contact?.name ?? null,
    scheduledAt: order.scheduledAt?.toISOString() ?? null, dueAt: order.dueAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null, estimatedCost: order.estimatedCost, actualCost: order.actualCost,
    resolutionNotes: order.resolutionNotes, expenses: (order.expenses ?? []).map((expense: any) => ({ id: expense.id, amount: expense.amount, description: expense.description, date: expense.date.toISOString() })),
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
  }
}

const orderInclude = {
  assignedTo: { select: { id: true, name: true } },
  lease: { select: { contractNumber: true } },
  contact: { select: { name: true } },
  expenses: { select: { id: true, amount: true, description: true, date: true }, orderBy: { date: 'desc' as const } },
}

async function validateRefs(input: { leaseId?: number | null; bookingId?: number | null; contactId?: number | null; assignedToId?: number | null }) {
  if (input.leaseId != null && !(await prisma.lease.findUnique({ where: { id: input.leaseId }, select: { id: true } }))) return 'Lease not found'
  if (input.bookingId != null && !(await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { id: true } }))) return 'Booking not found'
  if (input.contactId != null && !(await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) return 'Contact not found'
  if (input.assignedToId != null && !(await prisma.staff.findFirst({ where: { id: input.assignedToId, status: { not: 'Inactive' } }, select: { id: true } }))) return 'Assigned staff member is not active or does not exist'
  return null
}

export async function getWorkOrderWorkspace(filters: { status?: string; assignedToId?: number } = {}) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
    const where: Record<string, unknown> = {}
    if (filters.status && allowed.includes(filters.status)) where.status = filters.status
    if (filters.assignedToId) where.assignedToId = filters.assignedToId
    const [orders, staff, leases] = await Promise.all([
      prisma.workOrder.findMany({ where, include: orderInclude, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], take: 500 }),
      prisma.staff.findMany({ where: { status: { not: 'Inactive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.lease.findMany({ where: { status: 'ACTIVE' }, select: { id: true, contractNumber: true, contact: { select: { name: true } } }, orderBy: { endDate: 'asc' } }),
    ])
    return { success: true, data: { orders: orders.map(mapWorkOrder), staff, leases } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function createWorkOrder(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = workOrderSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid work order' }
    const input = parsed.data
    const scheduledAt = dateOrNull(input.scheduledAt); const dueAt = dateOrNull(input.dueAt)
    if ((input.scheduledAt && !scheduledAt) || (input.dueAt && !dueAt)) return { success: false, error: 'Work-order dates are invalid' }
    if (scheduledAt && dueAt && dueAt < scheduledAt) return { success: false, error: 'Due date cannot be before scheduled date' }
    const refError = await validateRefs(input); if (refError) return { success: false, error: refError }
    const order = await prisma.workOrder.create({ data: {
      displayId: displayId(), leaseId: input.leaseId ?? null, bookingId: input.bookingId ?? null, contactId: input.contactId ?? null,
      assignedToId: input.assignedToId ?? null, title: input.title, description: input.description || null, category: input.category,
      priority: input.priority, status: input.status, vendorName: input.vendorName || null, vendorPhone: input.vendorPhone || null,
      scheduledAt, dueAt, completedAt: input.status === 'COMPLETED' ? new Date() : null, estimatedCost: input.estimatedCost,
      actualCost: 0, resolutionNotes: input.resolutionNotes || null,
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
      status: input.status, actualCost: input.actualCost, resolutionNotes: input.resolutionNotes,
      completedAt: input.status === 'COMPLETED' ? new Date() : input.status === 'CANCELLED' ? null : undefined,
    }, include: orderInclude })
    revalidatePath('/maintenance'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not update work order' } }
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
    const order = await prisma.workOrder.update({ where: { id: existing.id }, data: { status: parsed.data.status, resolutionNotes: parsed.data.resolutionNotes, completedAt: parsed.data.status === 'COMPLETED' ? new Date() : parsed.data.status === 'CANCELLED' ? null : undefined }, include: orderInclude })
    revalidatePath('/maintenance'); revalidatePath('/staff-portal'); return { success: true, data: mapWorkOrder(order) }
  } catch { return { success: false, error: 'Could not update assigned work order' } }
}
