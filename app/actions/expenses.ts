'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import {
  createExpenseSchema,
  createCategorySchema,
  createRecurringSchema,
  cashRegisterSchema,
} from '@/lib/validations/expenses'
import { moveExpenseToDraft } from './drafts'

// ─── DEFAULT CATEGORIES (Dubai real-estate agency) ────

const DEFAULT_CATEGORIES = [
  { name: 'Property Portal Listings', icon: 'Megaphone', color: '#F97316', sortOrder: 1 },
  { name: 'Agent Commissions', icon: 'HardHat', color: '#F59E0B', sortOrder: 2 },
  { name: 'Property Viewings', icon: 'Truck', color: '#6366F1', sortOrder: 3 },
  { name: 'Office & Admin', icon: 'Store', color: '#EC4899', sortOrder: 4 },
  { name: 'Marketing & Advertising', icon: 'Megaphone', color: '#F97316', sortOrder: 5 },
  { name: 'DLD / Compliance Fees', icon: 'FileText', color: '#64748B', sortOrder: 6 },
  { name: 'Visa & MOHRE', icon: 'FileText', color: '#14B8A6', sortOrder: 7 },
  { name: 'Fuel & Vehicle', icon: 'Fuel', color: '#EF4444', sortOrder: 8 },
  { name: 'Rent & Utilities', icon: 'Home', color: '#10B981', sortOrder: 9 },
  { name: 'Mortgage / Finance Fees', icon: 'Landmark', color: '#0EA5E9', sortOrder: 10 },
  { name: 'Professional Services', icon: 'Wrench', color: '#6B7280', sortOrder: 11 },
  { name: 'Miscellaneous', icon: 'MoreHorizontal', color: '#94A3B8', sortOrder: 12 },
]

// ─── SEED DEFAULT CATEGORIES ──────────────────────────

export async function seedExpenseCategories() {
  let created = 0
  for (const cat of DEFAULT_CATEGORIES) {
    const exists = await prisma.expenseCategory.findFirst({ where: { name: cat.name } })
    if (!exists) {
      await prisma.expenseCategory.create({ data: { ...cat, isDefault: true } })
      created++
    }
  }
  revalidatePath('/expenses')
  return { success: true, data: { created } }
}

// ─── CATEGORIES ───────────────────────────────────────

export async function getExpenseCategories() {
  const categories = await prisma.expenseCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: { select: { expenses: true } },
    },
  })
  return { success: true, data: categories }
}

export async function createExpenseCategory(data: unknown) {
  const parsed = createCategorySchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { name, icon, color, budget } = parsed.data
  const existing = await prisma.expenseCategory.findFirst({ where: { name } })
  if (existing) return { success: false, error: 'Category already exists' }

  const maxSort = await prisma.expenseCategory.aggregate({ _max: { sortOrder: true } })
  const category = await prisma.expenseCategory.create({
    data: { name, icon, color, budget, sortOrder: (maxSort._max.sortOrder || 0) + 1 },
  })
  revalidatePath('/expenses')
  return { success: true, data: category }
}

export async function updateCategoryBudget(id: number, budget: number) {
  await prisma.expenseCategory.update({ where: { id }, data: { budget } })
  revalidatePath('/expenses')
  return { success: true }
}

export async function deleteExpenseCategory(id: number) {
  const cat = await prisma.expenseCategory.findUnique({ where: { id }, include: { _count: { select: { expenses: true } } } })
  if (!cat) return { success: false, error: 'Category not found' }
  if (cat._count.expenses > 0) {
    // Soft-deactivate if has expenses
    await prisma.expenseCategory.update({ where: { id }, data: { isActive: false } })
  } else {
    await prisma.expenseCategory.delete({ where: { id } })
  }
  revalidatePath('/expenses')
  return { success: true }
}

// ─── EXPENSES ─────────────────────────────────────────

export async function getExpenses(fromDate?: string, toDate?: string) {
  const where: Record<string, unknown> = {}
  if (fromDate && toDate) {
    where.date = {
      gte: new Date(fromDate + 'T00:00:00'),
      lte: new Date(toDate + 'T23:59:59'),
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      category: true,
      staff: { select: { id: true, name: true } },
    },
    orderBy: { date: 'desc' },
  })

  return {
    success: true,
    data: expenses.map(e => ({
      id: e.id,
      date: e.date.toISOString().split('T')[0],
      categoryId: e.categoryId,
      categoryName: e.category.name,
      categoryColor: e.category.color,
      categoryIcon: e.category.icon,
      amount: e.amount,
      description: e.description,
      paymentMode: e.paymentMode,
      reference: e.reference,
      receipt: e.receipt,
      vendor: e.vendor,
      staffId: e.staffId,
      staffName: e.staff?.name || null,
      status: e.status,
      approvedBy: e.approvedBy,
      isRecurring: e.isRecurring,
      notes: e.notes,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

export async function createExpense(data: unknown) {
  const parsed = createExpenseSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { date, categoryId, amount, description, paymentMode, reference, receipt, vendor, staffId, notes } = parsed.data

  const expense = await prisma.expense.create({
    data: {
      date: new Date(date),
      categoryId,
      amount,
      description,
      paymentMode,
      reference,
      receipt,
      vendor,
      staffId,
      notes,
      status: 'Approved', // auto-approved for admin
    },
  })

  // Update cash register if cash expense
  if (paymentMode === 'Cash') {
    const dateOnly = new Date(date + 'T00:00:00')
    await prisma.dailyCashRegister.upsert({
      where: { date: dateOnly },
      create: { date: dateOnly, cashOut: amount },
      update: { cashOut: { increment: amount } },
    })
  }

  revalidatePath('/expenses')
  return { success: true, data: expense }
}

export async function updateExpense(id: number, data: unknown) {
  try {
    await requireRole('ADMIN')
  } catch {
    return { success: false, error: 'Admin access required to edit expenses' }
  }

  const parsed = createExpenseSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { date, categoryId, amount, description, paymentMode, reference, receipt, vendor, staffId, notes } = parsed.data

  const existing = await prisma.expense.findUnique({ where: { id } })
  if (!existing) return { success: false, error: 'Expense not found' }

  if (existing.paymentMode === 'Cash') {
    const defaultDate = new Date(existing.date.toISOString().split('T')[0] + 'T00:00:00')
    await prisma.dailyCashRegister.updateMany({
      where: { date: defaultDate },
      data: { cashOut: { decrement: existing.amount } },
    })
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      date: new Date(date),
      categoryId,
      amount,
      description,
      paymentMode,
      reference,
      receipt,
      vendor,
      staffId,
      notes,
    },
  })

  if (paymentMode === 'Cash') {
    const newDateOnly = new Date(date + 'T00:00:00')
    await prisma.dailyCashRegister.upsert({
      where: { date: newDateOnly },
      create: { date: newDateOnly, cashOut: amount },
      update: { cashOut: { increment: amount } },
    })
  }

  revalidatePath('/expenses')
  return { success: true, data: expense }
}

export async function deleteExpense(id: number) {
  return moveExpenseToDraft(id)
}

export async function approveExpense(id: number, approvedBy: string) {
  await prisma.expense.update({ where: { id }, data: { status: 'Approved', approvedBy } })
  revalidatePath('/expenses')
  return { success: true }
}

export async function rejectExpense(id: number) {
  await prisma.expense.update({ where: { id }, data: { status: 'Rejected' } })
  revalidatePath('/expenses')
  return { success: true }
}

// ─── RECURRING EXPENSES ───────────────────────────────

export async function getRecurringExpenses() {
  const recurring = await prisma.recurringExpense.findMany({
    include: { category: true },
    orderBy: { createdAt: 'desc' },
  })
  return {
    success: true,
    data: recurring.map(r => ({
      id: r.id,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      categoryColor: r.category.color,
      description: r.description,
      amount: r.amount,
      paymentMode: r.paymentMode,
      vendor: r.vendor,
      frequency: r.frequency,
      dayOfMonth: r.dayOfMonth,
      isActive: r.isActive,
      lastRun: r.lastRun?.toISOString().split('T')[0] || null,
      notes: r.notes,
    })),
  }
}

export async function createRecurringExpense(data: unknown) {
  const parsed = createRecurringSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const rec = await prisma.recurringExpense.create({
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
  })
  revalidatePath('/expenses')
  return { success: true, data: rec }
}

export async function toggleRecurringExpense(id: number) {
  const rec = await prisma.recurringExpense.findUnique({ where: { id } })
  if (!rec) return { success: false, error: 'Not found' }
  await prisma.recurringExpense.update({ where: { id }, data: { isActive: !rec.isActive } })
  revalidatePath('/expenses')
  return { success: true }
}

export async function deleteRecurringExpense(id: number) {
  await prisma.recurringExpense.delete({ where: { id } })
  revalidatePath('/expenses')
  return { success: true }
}

// ─── DAILY CASH REGISTER ──────────────────────────────

export async function getCashRegister(date: string) {
  const dateOnly = new Date(date + 'T00:00:00')
  let register = await prisma.dailyCashRegister.findUnique({ where: { date: dateOnly } })
  if (!register) {
    // Carry forward closing from previous day
    const prev = await prisma.dailyCashRegister.findFirst({
      where: { date: { lt: dateOnly } },
      orderBy: { date: 'desc' },
    })
    register = await prisma.dailyCashRegister.create({
      data: {
        date: dateOnly,
        openingCash: prev?.closingCash ?? 0,
      },
    })
  }
  return {
    success: true,
    data: {
      id: register.id,
      date: register.date.toISOString().split('T')[0],
      openingCash: register.openingCash,
      closingCash: register.closingCash,
      cashIn: register.cashIn,
      cashOut: register.cashOut,
      notes: register.notes,
    },
  }
}

export async function updateCashRegister(data: unknown) {
  const parsed = cashRegisterSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const dateOnly = new Date(parsed.data.date + 'T00:00:00')
  const register = await prisma.dailyCashRegister.upsert({
    where: { date: dateOnly },
    create: {
      date: dateOnly,
      openingCash: parsed.data.openingCash,
      closingCash: parsed.data.closingCash ?? null,
      cashIn: parsed.data.cashIn,
      notes: parsed.data.notes,
    },
    update: {
      openingCash: parsed.data.openingCash,
      closingCash: parsed.data.closingCash ?? null,
      cashIn: parsed.data.cashIn,
      notes: parsed.data.notes,
    },
  })
  revalidatePath('/expenses')
  return { success: true, data: register }
}

// ─── ANALYTICS & REPORTS ──────────────────────────────

export async function getExpenseSummary(fromDate: string, toDate: string) {
  const from = new Date(fromDate + 'T00:00:00')
  const to = new Date(toDate + 'T23:59:59')

  // Category-wise breakdown
  const byCategory = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { date: { gte: from, lte: to }, status: 'Approved' },
    _sum: { amount: true },
    _count: true,
  })

  const categories = await prisma.expenseCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]))

  const categoryBreakdown = byCategory.map(b => ({
    categoryId: b.categoryId,
    categoryName: catMap[b.categoryId]?.name || 'Unknown',
    categoryColor: catMap[b.categoryId]?.color || '#94A3B8',
    categoryIcon: catMap[b.categoryId]?.icon || 'MoreHorizontal',
    total: b._sum.amount || 0,
    count: b._count,
    budget: catMap[b.categoryId]?.budget || 0,
  })).sort((a, b) => b.total - a.total)

  // Payment mode breakdown
  const byPaymentMode = await prisma.expense.groupBy({
    by: ['paymentMode'],
    where: { date: { gte: from, lte: to }, status: 'Approved' },
    _sum: { amount: true },
    _count: true,
  })

  // Daily totals
  const allExpenses = await prisma.expense.findMany({
    where: { date: { gte: from, lte: to }, status: 'Approved' },
    select: { date: true, amount: true },
    orderBy: { date: 'asc' },
  })

  const dailyMap: Record<string, number> = {}
  allExpenses.forEach(e => {
    const d = e.date.toISOString().split('T')[0]
    dailyMap[d] = (dailyMap[d] || 0) + e.amount
  })

  const dailyTotals = Object.entries(dailyMap)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Grand total
  const grandTotal = categoryBreakdown.reduce((s, c) => s + c.total, 0)
  const totalBudget = categories.reduce((s, c) => s + (c.budget || 0), 0)
  const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)))
  const dailyAverage = Math.round(grandTotal / dayCount)

  // Top vendor
  const byVendor = await prisma.expense.groupBy({
    by: ['vendor'],
    where: { date: { gte: from, lte: to }, status: 'Approved', vendor: { not: null } },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: 'desc' } },
    take: 10,
  })

  return {
    success: true,
    data: {
      grandTotal,
      totalBudget,
      dailyAverage,
      dayCount,
      categoryBreakdown,
      paymentModeBreakdown: byPaymentMode.map(b => ({
        mode: b.paymentMode,
        total: b._sum.amount || 0,
        count: b._count,
      })),
      dailyTotals,
      topVendors: byVendor.map(v => ({
        vendor: v.vendor || 'Unknown',
        total: v._sum.amount || 0,
        count: v._count,
      })),
    },
  }
}

// ─── BUDGET VS ACTUAL ─────────────────────────────────

export async function getBudgetVsActual(month: string) {
  // month = "YYYY-MM"
  const from = new Date(month + '-01T00:00:00')
  const to = new Date(from)
  to.setMonth(to.getMonth() + 1)
  to.setDate(0) // last day of month
  to.setHours(23, 59, 59)

  const categories = await prisma.expenseCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  const byCategory = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { date: { gte: from, lte: to }, status: 'Approved' },
    _sum: { amount: true },
  })

  const spentMap = Object.fromEntries(byCategory.map(b => [b.categoryId, b._sum.amount || 0]))

  return {
    success: true,
    data: categories.map(c => ({
      categoryId: c.id,
      categoryName: c.name,
      categoryColor: c.color,
      categoryIcon: c.icon,
      budget: c.budget || 0,
      actual: spentMap[c.id] || 0,
      variance: (c.budget || 0) - (spentMap[c.id] || 0),
      percent: c.budget > 0 ? Math.round(((spentMap[c.id] || 0) / c.budget) * 100) : 0,
    })),
  }
}
