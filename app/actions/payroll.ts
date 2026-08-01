'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { generatePayrollSchema, updateStaffPayrollSchema } from '@/lib/validations/payroll'
import { z } from 'zod'

// ─── ATTENDANCE SUMMARY FOR PAYROLL ──────────────────
// Used to display per-staff attendance breakdown before payroll generation
// (Like Keka / GreytHR's "Attendance Summary" pre-payroll screen)

export async function getAttendanceSummaryForPayroll(period: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied', data: [] } }

  const [year, month] = period.split('-').map(Number)
  const monthStart = new Date(year, month - 1, 1)
  const nextMonth  = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)

  const staffList = await prisma.staff.findMany({
    where: { status: 'Active' },
    select: {
      id: true,
      name: true,
      role: true,
      basicSalary: true,
      attendance: {
        where: { date: { gte: monthStart, lt: nextMonth } },
        select: { status: true, hours: true, clockIn: true, clockOut: true, date: true, isLate: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  const summary = staffList.map(s => {
    const att = s.attendance
    const present  = att.filter(a => { const n = (a.status||'').toLowerCase(); return n === 'present' || n === 'late' }).length
    const absent   = att.filter(a => { const n = (a.status||'').toLowerCase(); return n === 'absent' }).length
    const halfDay  = att.filter(a => { const n = (a.status||'').toLowerCase(); return n === 'half day' || n === 'half-day' }).length
    const late     = att.filter(a => a.isLate).length
    const otDays   = att.filter(a => (a.status||'').toUpperCase() === 'OT').length
    const totalHrs = att.reduce((sum, a) => sum + (a.hours || 0), 0)
    const otHours  = att.reduce((sum, a) => {
      const status = (a.status || '').toUpperCase()
      if (status === 'OT') return sum + Math.max(0, a.hours || 0)
      const dayCredit = (status === 'ABSENT' || status === 'OFF DUTY') ? 0 : (status === 'HALF DAY' || status === 'HALF-DAY') ? 0.5 : 1
      if (dayCredit <= 0 || a.hours == null) return sum
      const baseline = dayCredit >= 1 ? 8 : 4
      return sum + Math.max(0, a.hours - baseline)
    }, 0)

    const payableDays  = present + (halfDay * 0.5)
    const lopDays      = absent + (halfDay * 0.5)

    return {
      id: s.id,
      name: s.name,
      role: s.role,
      basicSalary: s.basicSalary || 0,
      totalLogged: att.length,
      present,
      absent,
      halfDay,
      late,
      otDays,
      otHours: Math.round(otHours * 10) / 10,
      totalHrs: Math.round(totalHrs * 10) / 10,
      payableDays: Math.round(payableDays * 10) / 10,
      lopDays: Math.round(lopDays * 10) / 10,
      hasAttendance: att.length > 0,
    }
  })

  return { success: true, data: summary }
}

function attendanceDayCredit(status: string): number {
  const normalized = (status || '').trim().toLowerCase()
  if (normalized === 'absent' || normalized === 'off duty' || normalized === 'off-duty') return 0
  if (normalized === 'half day' || normalized === 'half-day') return 0.5
  return 1
}

function overtimeHoursFromAttendance(entries: { status: string; hours: number | null }[]): number {
  return entries.reduce((sum, entry) => {
    const status = (entry.status || '').trim().toUpperCase()

    if (status === 'OT') {
      return sum + Math.max(0, entry.hours || 0)
    }

    const dayCredit = attendanceDayCredit(entry.status)
    if (dayCredit <= 0 || entry.hours == null) return sum

    const baselineHours = dayCredit >= 1 ? 8 : 4
    return sum + Math.max(0, entry.hours - baselineHours)
  }, 0)
}

// ─── PRE-PAYROLL READINESS ──────────────────────────

export async function getPayrollReadiness(period?: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const targetPeriod = period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const [year, month] = targetPeriod.split('-').map(Number)
  const monthStart = new Date(year, month - 1, 1)
  const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)

  const [staffList, attendanceRows] = await Promise.all([
    prisma.staff.findMany({
      where: { status: 'Active' },
      select: {
        id: true,
        name: true,
        basicSalary: true,
        emiratesId: true,
        laborCardNo: true,
        mohreNo: true,
        iban: true,
        bankName: true,
        visaStatus: true,
        eosbAccrued: true,
        wpsRegistered: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: monthStart, lt: nextMonth } },
      select: { staffId: true },
    }),
  ])

  const staffWithAttendance = new Set(attendanceRows.map(row => row.staffId))

  const missingBasic = staffList.filter(s => !s.basicSalary).map(s => s.name)
  const missingBankDetails = staffList
    .filter(s => !s.iban || !s.bankName)
    .map(s => s.name)
  const missingEmploymentIdentity = staffList
    .filter(s => !s.emiratesId || !s.laborCardNo || !s.mohreNo)
    .map(s => s.name)
  const missingWpsRegistration = staffList
    .filter(s => !s.wpsRegistered)
    .map(s => s.name)
  const noAttendanceConfigured = staffList
    .filter(s => !staffWithAttendance.has(s.id))
    .map(s => s.name)

  const blockers: string[] = []
  const warnings: string[] = []

  if (staffList.length === 0) blockers.push('No active staff found.')
  if (missingBasic.length > 0) blockers.push(`${missingBasic.length} staff are missing basic salary.`)
  if (missingBankDetails.length > 0) warnings.push(`${missingBankDetails.length} staff are missing IBAN or bank details.`)
  if (missingEmploymentIdentity.length > 0) warnings.push(`${missingEmploymentIdentity.length} staff are missing Emirates ID, labour card, or MOHRE number.`)
  if (missingWpsRegistration.length > 0) warnings.push(`${missingWpsRegistration.length} staff are not marked as WPS registered.`)
  if (noAttendanceConfigured.length > 0) warnings.push(`${noAttendanceConfigured.length} staff have no attendance in this period; full working days will be assumed.`)

  return {
    success: true,
    data: {
      period: targetPeriod,
      activeStaff: staffList.length,
      blockers,
      warnings,
      details: {
        missingBasic,
        missingBankDetails,
        missingEmploymentIdentity,
        missingWpsRegistration,
        noAttendanceConfigured,
      },
    },
  }
}

// ─── STAFF PAYROLL SETTINGS ──────────────────────────

export async function getStaffForPayroll() {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied', data: [] } }

  const staff = await prisma.staff.findMany({
    where: { status: 'Active' },
    select: {
      id: true, name: true, role: true, designation: true,
      basicSalary: true, emiratesId: true, laborCardNo: true, mohreNo: true,
      iban: true, bankName: true, visaStatus: true, eosbAccrued: true, wpsRegistered: true,
      loans: { where: { status: 'Active' }, select: { id: true, purpose: true, remainingAmount: true, monthlyInstallment: true } },
    },
    orderBy: { name: 'asc' },
  })

  // Do not spread Prisma records into this response. In particular,
  // `eosbAccrued` is a Prisma Decimal and React Server Components reject it
  // before the client can receive the payload. An explicit DTO also prevents a
  // future schema field from accidentally crossing this boundary unconverted.
  return {
    success: true,
    data: staff.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      designation: member.designation,
      basicSalary: Number(member.basicSalary ?? 0),
      emiratesId: member.emiratesId,
      laborCardNo: member.laborCardNo,
      mohreNo: member.mohreNo,
      iban: member.iban,
      bankName: member.bankName,
      visaStatus: member.visaStatus,
      eosbAccrued: Number(member.eosbAccrued ?? 0),
      wpsRegistered: member.wpsRegistered,
      loans: member.loans.map((loan) => ({
        id: loan.id,
        purpose: loan.purpose,
        remainingAmount: Number(loan.remainingAmount ?? 0),
        monthlyInstallment: Number(loan.monthlyInstallment ?? 0),
      })),
    })),
  }
}

export async function updateStaffPayrollInfo(data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }
  const parsed = updateStaffPayrollSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { staffId, ...rest } = parsed.data
  await prisma.staff.update({ where: { id: staffId }, data: rest })
  revalidatePath('/payroll')
  return { success: true }
}

// ─── LOANS & ADVANCES ────────────────────────────────

const loanSchema = z.object({
  staffId: z.number(),
  purpose: z.string().min(1),
  principalAmount: z.number().min(1),
  monthlyInstallment: z.number().min(1),
  startPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  notes: z.string().optional(),
}).refine((data) => data.monthlyInstallment <= data.principalAmount, {
  message: 'Monthly installment cannot exceed principal amount',
  path: ['monthlyInstallment'],
})

export async function getStaffLoans(staffId?: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied', data: [] } }

  const loans = await prisma.staffLoan.findMany({
    where: staffId ? { staffId } : undefined,
    include: { staff: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return {
    success: true,
    data: loans.map((loan) => ({
      ...loan,
      principalAmount: Number(loan.principalAmount ?? 0),
      remainingAmount: Number(loan.remainingAmount ?? 0),
      monthlyInstallment: Number(loan.monthlyInstallment ?? 0),
      createdAt: loan.createdAt.toISOString(),
    })),
  }
}

export async function createStaffLoan(data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }
  const parsed = loanSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const staff = await prisma.staff.findUnique({ where: { id: parsed.data.staffId }, select: { status: true } })
  if (!staff || staff.status !== 'Active') {
    return { success: false, error: 'Loan can only be created for active staff.' }
  }

  const loan = await prisma.staffLoan.create({
    data: {
      ...parsed.data,
      remainingAmount: parsed.data.principalAmount,
    },
  })
  revalidatePath('/payroll')
  return {
    success: true,
    data: {
      ...loan,
      principalAmount: Number(loan.principalAmount),
      remainingAmount: Number(loan.remainingAmount),
      monthlyInstallment: Number(loan.monthlyInstallment),
      createdAt: loan.createdAt.toISOString(),
    },
  }
}

export async function closeStaffLoan(id: number) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  await prisma.staffLoan.update({ where: { id }, data: { status: 'Closed', remainingAmount: 0 } })
  revalidatePath('/payroll')
  return { success: true }
}

// ─── GENERATE PAYROLL ────────────────────────────────

export async function generatePayroll(data: unknown) {
  let session
  try { session = await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const parsed = generatePayrollSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { period, workingDays, lopOverrides = {} } = parsed.data

  // Check if already finalized
  const existing = await prisma.payrollRun.findFirst({ where: { period } })
  if (existing && existing.status !== 'DRAFT') {
    return { success: false, error: `Payroll for ${period} is already ${existing.status}. Cannot re-generate.` }
  }

  // Build date range for attendance
  const [year, month] = period.split('-').map(Number)
  const currentMonth = new Date(year, month - 1, 1)
  const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)

  // Fetch all active staff with attendance + active loans
  const staffList = await prisma.staff.findMany({
    where: { status: 'Active' },
    include: {
      attendance: {
        where: { date: { gte: currentMonth, lt: nextMonth } },
        select: { status: true, hours: true },
      },
      loans: { where: { status: 'Active' } },
    },
    orderBy: { name: 'asc' },
  })

  if (staffList.length === 0) {
    return { success: false, error: 'No active staff found. Add staff before generating payroll.' }
  }

  const staffMissingBasic = staffList.filter(staff => (staff.basicSalary || 0) <= 0)
  if (staffMissingBasic.length > 0) {
    return { success: false, error: `Configure basic salary for ${staffMissingBasic.length} staff before generating payroll.` }
  }

  let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerContributions = 0

  const payslipData = staffList.map(staff => {
    // ── Attendance-based day credits ──────────────────────────────────────
    // If admin has provided a manual LOP override for this staff, use it.
    // Otherwise fall back to attendance records (or assume full month if none logged).
    const hasAttendance = staff.attendance.length > 0
    const manualLopDays = lopOverrides[String(staff.id)] !== undefined
      ? Number(lopOverrides[String(staff.id)])
      : null

    let attendanceCredits: number
    let presentDaysCalc: number

    if (manualLopDays !== null) {
      // Admin explicitly set LOP — trust it
      attendanceCredits = workingDays - manualLopDays
      presentDaysCalc   = attendanceCredits
    } else if (hasAttendance) {
      attendanceCredits = staff.attendance.reduce((sum, entry) => sum + attendanceDayCredit(entry.status), 0)
      presentDaysCalc   = staff.attendance.reduce((sum, entry) => {
        const credit = attendanceDayCredit(entry.status)
        return sum + (credit > 0 ? credit : 0)
      }, 0)
    } else {
      // No attendance logged → full working days (warning already surfaced in readiness)
      attendanceCredits = workingDays
      presentDaysCalc   = workingDays
    }

    const payableDays = Math.min(workingDays, Math.max(0, attendanceCredits))
    // presentDays stored as Int (schema); round to nearest half
    const presentDays = Math.round(Math.min(workingDays, presentDaysCalc) * 2) / 2

    // OT: explicitly marked OT entries or hours beyond baseline shift.
    const otHours = overtimeHoursFromAttendance(staff.attendance)

    // Basic (pro-rated)
    const basic = staff.basicSalary || 0
    const dailyRate = workingDays > 0 ? basic / workingDays : 0
    const effectiveBasic = Math.round(dailyRate * payableDays)

    // Earnings. The configured basic salary is the contractual wage. The
    // allowance fields are ready for a UAE compensation-policy extension and
    // are deliberately zero until those amounts are configured per staff.
    const housingAllowance = 0
    const transportAllowance = 0
    const hourlyRate = effectiveBasic > 0 ? Math.round(effectiveBasic / (workingDays * 8)) : 0
    const otPay = Math.round(hourlyRate * otHours * 2)      // OT at double rate

    // EOSB is accrued on the staff record using UAE service-length rules; it
    // is not a monthly employee deduction.
    const bonus = 0

    const grossSalary = effectiveBasic + otPay

    // Loan deductions — only loans that have started by this payroll period
    let requestedLoanDeduction = 0
    const eligibleLoans = staff.loans.filter(loan => loan.startPeriod <= period)
    for (const loan of eligibleLoans) {
      const installment = Math.min(loan.monthlyInstallment, loan.remainingAmount)
      requestedLoanDeduction += installment
    }

    // Guard against over-deduction; loan recovery should not push net below zero by itself.
    const maxLoanRecoverable = Math.max(0, grossSalary)
    const loanDeduction = Math.min(requestedLoanDeduction, maxLoanRecoverable)

    const totalDeductionsStaff = loanDeduction
    const netSalary = Math.max(0, grossSalary - totalDeductionsStaff)

    totalGross += grossSalary
    totalDeductions += totalDeductionsStaff
    totalNet += netSalary
    totalEmployerContributions += bonus

    return {
      staffId: staff.id,
      workingDays,
      presentDays,
      basicSalary: effectiveBasic,
      housingAllowance, transportAllowance,
      otherAllowance: 0,
      otHours,
      otPay,
      bonus,
      grossSalary,
      loanDeduction,
      otherDeductions: 0,
      totalDeductions: totalDeductionsStaff,
      netSalary,
    }
  })

  const displayId = `PAY-${period}`

  const run = await prisma.$transaction(async (tx) => {
    // Delete existing draft if re-generating
    if (existing) {
      await tx.payslip.deleteMany({ where: { payrollRunId: existing.id } })
      await tx.payrollRun.delete({ where: { id: existing.id } })
    }

    // Create payroll run
    const newRun = await tx.payrollRun.create({
      data: {
        displayId,
        period,
        totalGross,
        totalDeductions,
        totalNet,
        employerContributions: totalEmployerContributions,
        processedBy: session?.user?.name || session?.user?.email || null,
        payslips: { create: payslipData },
      },
      include: {
        payslips: {
          include: {
            staff: {
              select: {
                name: true, role: true, designation: true,
                emiratesId: true, laborCardNo: true, mohreNo: true,
                iban: true, bankName: true, visaStatus: true, wpsRegistered: true,
              },
            },
          },
          orderBy: { staff: { name: 'asc' } },
        },
      },
    })

    return newRun
  })

  revalidatePath('/payroll')
  return { success: true, data: run }
}

// ─── PAYROLL RUNS ────────────────────────────────────

export async function getPayrollHistory() {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied', data: [] } }

  const runs = await prisma.payrollRun.findMany({
    orderBy: { period: 'desc' },
    include: { _count: { select: { payslips: true } } },
  })
  return { success: true, data: runs }
}

export async function getPayrollRun(id: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied' } }

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      payslips: {
        include: {
          staff: {
            select: {
              name: true, role: true, designation: true,
              phone: true, email: true,
              emiratesId: true, laborCardNo: true, mohreNo: true,
              iban: true, bankName: true, visaStatus: true, wpsRegistered: true,
            },
          },
        },
        orderBy: { staff: { name: 'asc' } },
      },
    },
  })
  if (!run) return { success: false, error: 'Payroll run not found' }
  return { success: true, data: run }
}

export async function getAllPayslips(period?: string) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Access denied', data: [] } }

  const payslips = await prisma.payslip.findMany({
    where: period ? { payrollRun: { period } } : undefined,
    include: {
      staff: {
        select: {
          name: true,
          role: true,
          designation: true,
          phone: true,
          email: true,
          emiratesId: true,
          iban: true,
          bankName: true,
        },
      },
      payrollRun: { select: { period: true, status: true, displayId: true } },
    },
    orderBy: [{ payrollRun: { period: 'desc' } }, { staff: { name: 'asc' } }],
  })
  return { success: true, data: payslips }
}

export async function approvePayroll(id: number) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const run = await prisma.payrollRun.findUnique({ where: { id }, select: { status: true } })
  if (!run) return { success: false, error: 'Payroll run not found' }
  if (run.status !== 'DRAFT') return { success: false, error: `Cannot approve a ${run.status} payroll` }

  await prisma.payrollRun.update({ where: { id }, data: { status: 'APPROVED' } })
  revalidatePath('/payroll')
  return { success: true }
}

export async function markPayrollPaid(id: number) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    select: {
      status: true,
      period: true,
      payslips: { select: { staffId: true, loanDeduction: true } },
    },
  })
  if (!run) return { success: false, error: 'Payroll run not found' }
  if (run.status !== 'APPROVED') return { success: false, error: 'Payroll must be APPROVED before marking as paid' }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } })

    // Apply loan deductions only when payroll is actually paid.
    for (const payslip of run.payslips) {
      let pendingDeduction = payslip.loanDeduction || 0
      if (pendingDeduction <= 0) continue

      const loans = await tx.staffLoan.findMany({
        where: {
          staffId: payslip.staffId,
          status: 'Active',
          startPeriod: { lte: run.period },
        },
        orderBy: { createdAt: 'asc' },
      })

      for (const loan of loans) {
        if (pendingDeduction <= 0) break

        const scheduledInstallment = Math.min(loan.monthlyInstallment, loan.remainingAmount)
        const applied = Math.min(scheduledInstallment, pendingDeduction)
        if (applied <= 0) continue

        const newRemaining = loan.remainingAmount - applied
        await tx.staffLoan.update({
          where: { id: loan.id },
          data: {
            remainingAmount: newRemaining,
            status: newRemaining <= 0 ? 'Closed' : 'Active',
          },
        })

        pendingDeduction -= applied
      }
    }
  })

  revalidatePath('/payroll')
  return { success: true }
}
