'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { createJournalSchema, createAccountSchema } from '@/lib/validations/financials'

// ─── CHART OF ACCOUNTS ────────────────────────────────

const DEFAULT_ACCOUNTS = [
  // Assets
  { groupName: 'Current Assets', type: 'ASSET', code: '1001', name: 'Cash in Hand' },
  { groupName: 'Current Assets', type: 'ASSET', code: '1002', name: 'Bank Account' },
  { groupName: 'Current Assets', type: 'ASSET', code: '1100', name: 'Token / Advance Receivable' },
  { groupName: 'Current Assets', type: 'ASSET', code: '1200', name: 'Brokerage Receivable' },
  { groupName: 'Current Assets', type: 'ASSET', code: '1300', name: 'Security Deposit (Paid)' },
  { groupName: 'Fixed Assets', type: 'ASSET', code: '1500', name: 'Office Equipment' },
  { groupName: 'Fixed Assets', type: 'ASSET', code: '1510', name: 'Vehicles' },
  // Liabilities
  { groupName: 'Current Liabilities', type: 'LIABILITY', code: '2001', name: 'Advance from Clients' },
  { groupName: 'Current Liabilities', type: 'LIABILITY', code: '2100', name: 'Security Deposit (Received)' },
  { groupName: 'Current Liabilities', type: 'LIABILITY', code: '2200', name: 'Salary Payable' },
  { groupName: 'Current Liabilities', type: 'LIABILITY', code: '2300', name: 'End-of-Service Benefit Provision' },
  { groupName: 'Current Liabilities', type: 'LIABILITY', code: '2400', name: 'VAT Payable' },
  { groupName: 'Long Term Liabilities', type: 'LIABILITY', code: '2900', name: 'Bank Loan' },
  // Equity
  { groupName: 'Equity', type: 'EQUITY', code: '3001', name: "Owner's Capital" },
  { groupName: 'Equity', type: 'EQUITY', code: '3100', name: 'Retained Earnings' },
  { groupName: 'Equity', type: 'EQUITY', code: '3200', name: 'Drawings' },
  // Income
  { groupName: 'Revenue', type: 'INCOME', code: '4001', name: 'Brokerage Income' },
  { groupName: 'Revenue', type: 'INCOME', code: '4002', name: 'Rental Commission' },
  { groupName: 'Revenue', type: 'INCOME', code: '4100', name: 'Consultation Fees' },
  { groupName: 'Revenue', type: 'INCOME', code: '4200', name: 'Other Income' },
  // Expenses
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5100', name: 'Salary Expense' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5110', name: 'Employee Benefits / EOSB Provision' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5200', name: 'Rent Expense' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5300', name: 'Electricity & Utilities' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5400', name: 'Marketing & Advertising' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5500', name: 'Site Visit Expenses' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5600', name: 'Bank Charges' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5700', name: 'Depreciation' },
  { groupName: 'Operating Expenses', type: 'EXPENSE', code: '5800', name: 'Other Expenses' },
]

function parseAsOfDate(asOfDate: string) {
  const asOf = new Date(asOfDate)
  if (Number.isNaN(asOf.getTime())) return null
  asOf.setHours(23, 59, 59, 999)
  return asOf
}

function parseDateRange(fromDate: string, toDate: string) {
  const from = new Date(fromDate)
  const to = new Date(toDate)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  if (from > to) return null
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

// ─── CHART OF ACCOUNTS CRUD ──────────────────────────

export async function seedChartOfAccounts() {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const existing = await prisma.ledgerAccount.count()
  if (existing > 0) return { success: true, message: 'Chart of accounts already exists' }

  for (const acc of DEFAULT_ACCOUNTS) {
    const group = await prisma.accountGroup.upsert({
      where: { name: acc.groupName },
      create: { name: acc.groupName, type: acc.type },
      update: {},
    })
    await prisma.ledgerAccount.upsert({
      where: { code: acc.code },
      create: { code: acc.code, name: acc.name, groupId: group.id, isSystemAccount: true },
      update: {},
    })
  }

  revalidatePath('/financials')
  return { success: true, message: 'Chart of accounts created' }
}

export async function getAccounts() {
  const groups = await prisma.accountGroup.findMany({
    include: { accounts: { orderBy: { code: 'asc' } } },
    orderBy: { name: 'asc' },
  })
  return { success: true, data: groups }
}

export async function createAccount(data: unknown) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const parsed = createAccountSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const exists = await prisma.ledgerAccount.findFirst({ where: { code: parsed.data.code } })
  if (exists) return { success: false, error: `Account code ${parsed.data.code} already exists` }

  const acc = await prisma.ledgerAccount.create({ data: parsed.data })
  revalidatePath('/financials')
  return { success: true, data: acc }
}

// ─── PAYMENT COLLECTIONS SUMMARY (P&L Replacement) ────
// Real Estate CRM: revenue tracked through DailyPayment (type='IN')

export async function getProfitAndLoss(fromDate: string, toDate: string, compareFrom?: string, compareTo?: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const range = parseDateRange(fromDate, toDate)
  if (!range) return { success: false, error: 'Invalid date range' }

  async function fetchPL(fd: string, td: string) {
    const r = parseDateRange(fd, td)
    if (!r) return null
    const { from, to } = r

    const [inflow, outflow, payrollAgg, employerPayroll] = await Promise.all([
      // Revenue: payments received (type=IN)
      prisma.dailyPayment.aggregate({
        where: { type: 'IN', isReversal: false, date: { gte: from, lte: to } },
        _sum: { amount: true, vatAmount: true },
        _count: { id: true },
      }),
      // Outflows: payments made (type=OUT)
      prisma.dailyPayment.aggregate({
        where: { type: 'OUT', isReversal: false, date: { gte: from, lte: to } },
        _sum: { amount: true, vatAmount: true },
        _count: { id: true },
      }),
      // Payroll cost
      prisma.payrollRun.aggregate({
        where: { status: { in: ['APPROVED', 'PAID'] }, period: { gte: fd.substring(0, 7), lte: td.substring(0, 7) } },
        _sum: { totalNet: true, totalGross: true },
      }),
      prisma.payrollRun.aggregate({
        where: { status: { in: ['APPROVED', 'PAID'] }, period: { gte: fd.substring(0, 7), lte: td.substring(0, 7) } },
        _sum: { employerContributions: true },
      }),
    ])

    const revenue = inflow._sum.amount || 0
    const directOutflows = outflow._sum.amount || 0
    const salaryExpense = payrollAgg._sum.totalGross || 0
    const employerBenefits = employerPayroll._sum.employerContributions || 0
    const totalOpEx = salaryExpense + employerBenefits + directOutflows
    const netProfit = revenue - totalOpEx
    const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0

    return {
      period: { from: fd, to: td },
      paymentCount: (inflow._count.id || 0) + (outflow._count.id || 0),
      revenue: {
        total: revenue,
        vat: inflow._sum.vatAmount || 0,
        note: 'Sum of IN payments (DailyPayment type=IN; VAT reported separately)',
      },
      expenses: {
        directOutflows,
        vat: outflow._sum.vatAmount || 0,
        salary: salaryExpense,
        employerBenefits,
        total: totalOpEx,
      },
      netProfit,
      netMarginPct,
      grossMarginPct: netMarginPct, // same in this simplified model
      grossProfit: netProfit,
    }
  }

  const current = await fetchPL(fromDate, toDate)
  if (!current) return { success: false, error: 'Invalid date range' }
  let compare: Awaited<ReturnType<typeof fetchPL>> = null
  if (compareFrom && compareTo) {
    compare = await fetchPL(compareFrom, compareTo)
    if (!compare) return { success: false, error: 'Invalid comparison date range' }
  }

  return { success: true, data: { current, compare } }
}

// ─── BALANCE SHEET (Payment-based) ───────────────────

export async function getBalanceSheet(asOfDate: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const asOf = parseAsOfDate(asOfDate)
  if (!asOf) return { success: false, error: 'Invalid as-of date' }

  const [totalInflow, totalOutflow, payrollPaid, payrollPayable, staffLoans, loanRecoveries] = await Promise.all([
    prisma.dailyPayment.aggregate({
      where: { type: 'IN', isReversal: false, date: { lte: asOf } },
      _sum: { amount: true, vatAmount: true },
    }),
    prisma.dailyPayment.aggregate({
      where: { type: 'OUT', isReversal: false, date: { lte: asOf } },
      _sum: { amount: true, vatAmount: true },
    }),
    prisma.payrollRun.aggregate({ where: { status: 'PAID', paidAt: { lte: asOf } }, _sum: { totalNet: true } }),
    prisma.payrollRun.aggregate({ where: { status: 'APPROVED' }, _sum: { totalNet: true } }),
    prisma.staffLoan.aggregate({ where: { status: 'Active' }, _sum: { remainingAmount: true } }),
    prisma.payslip.aggregate({ where: { payrollRun: { status: 'PAID', paidAt: { lte: asOf } } }, _sum: { loanDeduction: true } }),
  ])

  const inflow = totalInflow._sum.amount || 0
  const outflow = totalOutflow._sum.amount || 0
  const vatOutput = totalInflow._sum.vatAmount || 0
  const vatInput = totalOutflow._sum.vatAmount || 0
  const salaryPaid = payrollPaid._sum.totalNet || 0
  const loanInflow = loanRecoveries._sum.loanDeduction || 0
  const cashAndBank = inflow + loanInflow - outflow - salaryPaid

  const staffLoanAsset = staffLoans._sum.remainingAmount || 0
  const totalCurrentAssets = cashAndBank + staffLoanAsset
  const totalAssets = totalCurrentAssets

  const salaryPayable = payrollPayable._sum.totalNet || 0
  const netVatPayable = Math.max(0, vatOutput - vatInput)
  const totalLiabilities = salaryPayable + netVatPayable

  const equity = totalAssets - totalLiabilities

  return {
    success: true,
    data: {
      asOfDate,
      currentAssets: {
        cashAndBank,
        staffLoans: staffLoanAsset,
        total: totalCurrentAssets,
        accountsReceivable: 0,
        inventory: 0,
        itcReceivable: 0,
      },
      totalAssets,
      currentLiabilities: {
        salaryPayable,
        accountsPayable: 0,
        netVatPayable,
        vatOutput,
        vatInput,
        total: totalLiabilities,
      },
      equity: {
        derived: equity,
        note: 'Equity = Total Assets − Total Liabilities',
      },
      quality: {
        cashModel: 'Cash = payment inflows + loan recoveries − payment outflows − salary payouts',
      },
    },
  }
}

// ─── CASH FLOW ────────────────────────────────────────

export async function getCashFlow(fromDate: string, toDate: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const range = parseDateRange(fromDate, toDate)
  if (!range) return { success: false, error: 'Invalid date range' }
  const { from, to } = range

  const [inflow, outflow, salaryPayments, loanCollections] = await Promise.all([
    prisma.dailyPayment.aggregate({
      where: { type: 'IN', isReversal: false, date: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    prisma.dailyPayment.aggregate({
      where: { type: 'OUT', isReversal: false, date: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    prisma.payrollRun.aggregate({
      where: { status: 'PAID', paidAt: { gte: from, lte: to } },
      _sum: { totalNet: true },
    }),
    prisma.payslip.aggregate({
      where: { payrollRun: { status: 'PAID', paidAt: { gte: from, lte: to } } },
      _sum: { loanDeduction: true },
    }),
  ])

  const salesInflow = inflow._sum.amount || 0
  const directOutflow = outflow._sum.amount || 0
  const salaryOutflow = salaryPayments._sum.totalNet || 0
  const loanInflow = loanCollections._sum.loanDeduction || 0

  const totalInflow = salesInflow + loanInflow
  const totalOutflow = directOutflow + salaryOutflow
  const netOperating = totalInflow - totalOutflow

  return {
    success: true,
    data: {
      period: { from: fromDate, to: toDate },
      operating: {
        inflow: {
          collections: salesInflow,
          loanRepayments: loanInflow,
          total: totalInflow,
        },
        outflow: {
          payments: directOutflow,
          salaries: salaryOutflow,
          total: totalOutflow,
        },
        net: netOperating,
      },
      investing: { net: 0, note: 'Fixed asset purchases not tracked yet' },
      financing: { net: 0, note: 'Equity/loan transactions not tracked yet' },
      netCashFlow: netOperating,
    },
  }
}

// ─── EXECUTIVE SUMMARY ────────────────────────────────

export async function getExecutiveSummary(fromDate: string, toDate: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const range = parseDateRange(fromDate, toDate)
  if (!range) return { success: false, error: 'Invalid date range' }
  const { from, to } = range

  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  const prevTo = new Date(from)
  prevTo.setDate(prevTo.getDate() - 1)
  prevTo.setHours(23, 59, 59, 999)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevFrom.getDate() - (periodDays - 1))
  prevFrom.setHours(0, 0, 0, 0)

  const [bsRes, currPLRes, prevPLRes] = await Promise.all([
    getBalanceSheet(toDate),
    getProfitAndLoss(fromDate, toDate),
    getProfitAndLoss(prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10)),
  ])

  if (!bsRes.success || !currPLRes.success || !prevPLRes.success) {
    return { success: false, error: 'Unable to compute executive summary' }
  }

  const bsData = bsRes.data!
  const currentPL = currPLRes.data!.current
  const previousPL = prevPLRes.data!.current

  const netProfitDelta = (currentPL.netProfit || 0) - (previousPL.netProfit || 0)
  const netMarginDeltaPct = (currentPL.netMarginPct || 0) - (previousPL.netMarginPct || 0)

  const currentAssets = bsData.currentAssets?.total || 0
  const currentLiabilities = bsData.currentLiabilities?.total || 0
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : null

  const alerts: string[] = [
    netMarginDeltaPct < -5 ? 'Net margin dropped more than 5 percentage points vs prior period' : null,
    currentRatio !== null && currentRatio < 1 ? 'Current ratio below 1.0 (working capital stress)' : null,
  ].filter(Boolean) as string[]

  return {
    success: true,
    data: {
      period: { from: fromDate, to: toDate, days: periodDays },
      liquidity: {
        currentAssets,
        currentLiabilities,
        currentRatio,
        cashAndBank: bsData.currentAssets?.cashAndBank || 0,
        cashRunwayDays: null,
      },
      performance: {
        netProfit: currentPL.netProfit || 0,
        netProfitDelta,
        netMarginPct: currentPL.netMarginPct || 0,
        netMarginDeltaPct,
        grossMarginPct: currentPL.grossMarginPct || 0,
        grossMarginDeltaPct: netMarginDeltaPct,
      },
      agingRisk: {
        receivables: { over90Amount: 0, over90SharePct: 0, note: 'No invoice-based receivables in Real Estate CRM' },
        payables: { over90Amount: 0, over90SharePct: 0, note: 'No purchase-order payables in Real Estate CRM' },
      },
      alerts,
    },
  }
}

// ─── TRIAL BALANCE (Payment-based) ───────────────────

export async function getTrialBalance(asOfDate: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const asOf = parseAsOfDate(asOfDate)
  if (!asOf) return { success: false, error: 'Invalid as-of date' }

  const [inflow, outflow, payrollPaid, payrollApproved, staffLoans, loanRecoveries,
    payrollTotal, employerTotal] = await Promise.all([
      prisma.dailyPayment.aggregate({ where: { type: 'IN', isReversal: false, date: { lte: asOf } }, _sum: { amount: true } }),
      prisma.dailyPayment.aggregate({ where: { type: 'OUT', isReversal: false, date: { lte: asOf } }, _sum: { amount: true } }),
      prisma.payrollRun.aggregate({ where: { status: 'PAID', paidAt: { lte: asOf } }, _sum: { totalNet: true } }),
      prisma.payrollRun.aggregate({ where: { status: 'APPROVED' }, _sum: { totalNet: true } }),
      prisma.staffLoan.aggregate({ where: { status: 'Active' }, _sum: { remainingAmount: true } }),
      prisma.payslip.aggregate({ where: { payrollRun: { status: 'PAID', paidAt: { lte: asOf } } }, _sum: { loanDeduction: true } }),
      prisma.payrollRun.aggregate({ where: { status: { in: ['APPROVED', 'PAID'] } }, _sum: { totalGross: true } }),
      prisma.payrollRun.aggregate({ where: { status: { in: ['APPROVED', 'PAID'] } }, _sum: { employerContributions: true } }),
    ])

  const totalInflow = inflow._sum.amount || 0
  const totalOutflow = outflow._sum.amount || 0
  const salaryPaid = payrollPaid._sum.totalNet || 0
  const loanInflow = loanRecoveries._sum.loanDeduction || 0
  const cashAndBank = totalInflow + loanInflow - totalOutflow - salaryPaid

  const staffLoanAsset = staffLoans._sum.remainingAmount || 0
  const salaryPayable = payrollApproved._sum.totalNet || 0
  const salaryEx = payrollTotal._sum.totalGross || 0
  const employerEx = employerTotal._sum.employerContributions || 0

  const lines = [
    { code: '1002', name: 'Cash & Bank', type: 'ASSET', debit: Math.max(0, cashAndBank), credit: cashAndBank < 0 ? Math.abs(cashAndBank) : 0 },
    { code: '1100', name: 'Staff Loans Outstanding', type: 'ASSET', debit: staffLoanAsset, credit: 0 },
    { code: '2200', name: 'Salary Payable', type: 'LIABILITY', debit: 0, credit: salaryPayable },
    { code: '4001', name: 'Collection Revenue', type: 'INCOME', debit: 0, credit: totalInflow },
    { code: '5100', name: 'Salary Expense', type: 'EXPENSE', debit: salaryEx, credit: 0 },
    { code: '5110', name: 'Employee Benefits / EOSB', type: 'EXPENSE', debit: employerEx, credit: 0 },
    { code: '5800', name: 'Other Outflows', type: 'EXPENSE', debit: totalOutflow, credit: 0 },
  ]

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)

  const equityBalance = totalDebit - totalCredit
  if (equityBalance !== 0) {
    lines.push({
      code: '3100', name: 'Retained Earnings / Equity',
      type: 'EQUITY',
      debit: equityBalance < 0 ? Math.abs(equityBalance) : 0,
      credit: equityBalance > 0 ? equityBalance : 0,
    })
  }

  const finalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const finalCredit = lines.reduce((s, l) => s + l.credit, 0)

  return {
    success: true,
    data: { asOfDate, lines, totalDebit: finalDebit, totalCredit: finalCredit },
  }
}

// ─── RECEIVABLES AGING (Payment-based stub) ──────────
// Real Estate CRM: no Invoice model — return empty aging

export async function getReceivablesAging() {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  return {
    success: true,
    data: {
      summary: [],
      totalOutstanding: 0,
      totalCount: 0,
      risk: { over90Amount: 0, over90SharePct: 0, top5SharePct: 0, averageDaysPastDue: 0 },
      note: 'Receivables aging not applicable — no Invoice model in Real Estate CRM',
    },
  }
}

// ─── PAYABLES AGING (Purchase Order stub) ────────────
// Real Estate CRM: no PurchaseOrder model — return empty aging

export async function getPayablesAging() {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  return {
    success: true,
    data: {
      summary: [],
      totalOutstanding: 0,
      totalCount: 0,
      risk: { over90Amount: 0, over90SharePct: 0, top5SharePct: 0, averageDaysPastDue: 0 },
      note: 'Payables aging not applicable — no PurchaseOrder model in Real Estate CRM',
    },
  }
}

// ─── JOURNAL ENTRIES ─────────────────────────────────

export async function getJournalEntries(fromDate?: string, toDate?: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const where: Record<string, unknown> = {}
  if (fromDate && toDate) {
    const range = parseDateRange(fromDate, toDate)
    if (!range) return { success: false, error: 'Invalid date range' }
    where.date = { gte: range.from, lte: range.to }
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
    include: {
      lines: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { debit: 'desc' },
      },
    },
  })
  return { success: true, data: entries }
}

export async function createManualJournal(data: unknown) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const parsed = createJournalSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { date, narration, lines } = parsed.data
  const journalDate = new Date(date)
  if (Number.isNaN(journalDate.getTime())) return { success: false, error: 'Invalid journal date' }

  const hasBothSidesInSingleLine = lines.some(l => l.debit > 0 && l.credit > 0)
  if (hasBothSidesInSingleLine) {
    return { success: false, error: 'A journal line cannot have both debit and credit values' }
  }

  const debitLines = lines.filter(l => l.debit > 0).length
  const creditLines = lines.filter(l => l.credit > 0).length
  if (debitLines === 0 || creditLines === 0) {
    return { success: false, error: 'Journal must include at least one debit line and one credit line' }
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDebit - totalCredit) > 1) {
    return { success: false, error: `Debit (${totalDebit}) ≠ Credit (${totalCredit}). Journal must balance.` }
  }

  const count = await prisma.journalEntry.count()
  const displayId = `JV-${String(count + 1).padStart(4, '0')}`

  const entry = await prisma.journalEntry.create({
    data: {
      displayId, date: journalDate, narration,
      referenceType: 'MANUAL', totalDebit, totalCredit,
      lines: {
        create: lines.map(l => ({
          accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description,
        })),
      },
    },
  })

  revalidatePath('/financials')
  return { success: true, data: entry }
}

export async function voidJournalEntry(id: number) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const entry = await prisma.journalEntry.findUnique({ where: { id }, select: { status: true } })
  if (!entry) return { success: false, error: 'Journal entry not found' }
  if (entry.status === 'VOIDED') return { success: false, error: 'Already voided' }

  await prisma.journalEntry.update({ where: { id }, data: { status: 'VOIDED' } })
  revalidatePath('/financials')
  return { success: true }
}
