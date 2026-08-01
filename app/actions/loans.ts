'use server'

/**
 * Mortgage desk service.
 *
 * Tracks buyer mortgage applications through the UAE bank pipeline
 * (Enquiry → Documentation → Submitted → Sanctioned → Disbursed / Rejected),
 * with requested/sanctioned amounts, bank, rate, tenure and assignment.
 */

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createLoanSchema, updateLoanSchema } from '@/lib/validations/loans'

type Result<T> = { success: true; data: T } | { success: false; error: string }

const LOANS_PATH = '/loans'

export interface LoanRow {
    id: number
    contactId: number
    contactName: string
    contactPhone: string | null
    dealId: number | null
    bankName: string
    loanAmount: number | null
    interestRate: number | null
    tenureYears: number | null
    status: string
    applicationNo: string | null
    sanctionedAmount: number | null
    notes: string | null
    assignedToId: number | null
    assignedToName: string | null
    createdAt: string
}

const loanInclude = {
    contact: { select: { name: true, phone: true } },
    assignedTo: { select: { name: true } },
} as const

function mapLoan(l: {
    id: number
    contactId: number
    contact: { name: string; phone: string | null }
    dealId: number | null
    bankName: string
    loanAmount: number | null
    interestRate: number | null
    tenureYears: number | null
    status: string
    applicationNo: string | null
    sanctionedAmount: number | null
    notes: string | null
    assignedToId: number | null
    assignedTo: { name: string } | null
    createdAt: Date
}): LoanRow {
    return {
        id: l.id,
        contactId: l.contactId,
        contactName: l.contact.name,
        contactPhone: l.contact.phone,
        dealId: l.dealId,
        bankName: l.bankName,
        loanAmount: l.loanAmount,
        interestRate: l.interestRate,
        tenureYears: l.tenureYears,
        status: l.status,
        applicationNo: l.applicationNo,
        sanctionedAmount: l.sanctionedAmount,
        notes: l.notes,
        assignedToId: l.assignedToId,
        assignedToName: l.assignedTo?.name ?? null,
        createdAt: l.createdAt.toISOString(),
    }
}

export async function getLoans(filters: { status?: string } = {}): Promise<{ success: boolean; data: LoanRow[] }> {
    try {
        const where: Record<string, unknown> = {}
        if (filters.status) where.status = filters.status
        const loans = await prisma.loanApplication.findMany({
            where,
            include: loanInclude,
            orderBy: { createdAt: 'desc' },
            take: 500,
        })
        return { success: true, data: loans.map(mapLoan) }
    } catch (error) {
        console.error('Error listing loans:', error)
        return { success: false, data: [] }
    }
}

export async function createLoan(data: unknown): Promise<Result<LoanRow>> {
    const parsed = createLoanSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const d = parsed.data
    const contact = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { id: true } })
    if (!contact) return { success: false, error: 'Contact not found' }
    if (d.assignedToId != null) {
        const staff = await prisma.staff.findUnique({ where: { id: d.assignedToId }, select: { id: true } })
        if (!staff) return { success: false, error: 'Assigned staff member not found' }
    }

    const loan = await prisma.loanApplication.create({
        data: {
            contactId: d.contactId,
            dealId: d.dealId ?? null,
            bankName: d.bankName,
            loanAmount: d.loanAmount ?? null,
            interestRate: d.interestRate ?? null,
            tenureYears: d.tenureYears ?? null,
            status: d.status,
            applicationNo: d.applicationNo ?? null,
            sanctionedAmount: d.sanctionedAmount ?? null,
            notes: d.notes ?? null,
            assignedToId: d.assignedToId ?? null,
        },
        include: loanInclude,
    })

    revalidatePath(LOANS_PATH)
    return { success: true, data: mapLoan(loan) }
}

export async function updateLoan(data: unknown): Promise<Result<LoanRow>> {
    const parsed = updateLoanSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { id, ...rest } = parsed.data
    // Drop undefined keys so a partial update never nulls untouched columns.
    const updateData: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updateData[k] = v
    }

    try {
        const loan = await prisma.loanApplication.update({ where: { id }, data: updateData, include: loanInclude })
        revalidatePath(LOANS_PATH)
        return { success: true, data: mapLoan(loan) }
    } catch {
        return { success: false, error: 'Mortgage application not found' }
    }
}

export async function deleteLoan(id: number): Promise<Result<{ id: number }>> {
    try {
        await prisma.loanApplication.delete({ where: { id } })
        revalidatePath(LOANS_PATH)
        return { success: true, data: { id } }
    } catch {
        return { success: false, error: 'Mortgage application not found' }
    }
}
