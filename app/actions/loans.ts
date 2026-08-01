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
import { idSchema } from '@/lib/validations/common'
import { computeEmi } from '@/lib/emi'

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

export interface LoanDealOption {
    id: number
    contactId: number
    label: string
}

export interface LoanComparisonRow extends LoanRow {
    monthlyPayment: number | null
}

export interface LoanComparison {
    deal: { id: number; buyerName: string; unitNumber: string | null; projectName: string | null }
    offers: LoanComparisonRow[]
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

/** Deal choices used to attach mortgage applications and compare bank offers. */
export async function listLoanDealOptions(): Promise<Result<LoanDealOption[]>> {
    try {
        const deals = await prisma.deal.findMany({
            select: {
                id: true,
                contactId: true,
                contact: { select: { name: true } },
                unit: { select: { unitNumber: true, tower: { select: { project: { select: { name: true } } } } } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 500,
        })
        return {
            success: true,
            data: deals.map((deal) => ({
                id: deal.id,
                contactId: deal.contactId,
                label: `${deal.contact.name} — ${deal.unit?.tower.project?.name ?? 'No project'}${deal.unit ? ` / Unit ${deal.unit.unitNumber}` : ''}`,
            })),
        }
    } catch {
        return { success: false, error: 'Failed to list deals for mortgage comparison' }
    }
}

/** Return the saved bank applications for one deal as a side-by-side comparison. */
export async function getLoanComparison(dealId: unknown): Promise<Result<LoanComparison>> {
    const parsed = idSchema.safeParse(dealId)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid deal' }

    const deal = await prisma.deal.findUnique({
        where: { id: parsed.data },
        select: {
            id: true,
            contact: { select: { name: true } },
            unit: { select: { unitNumber: true, tower: { select: { project: { select: { name: true } } } } } },
        },
    })
    if (!deal) return { success: false, error: 'Deal not found' }

    const loans = await prisma.loanApplication.findMany({
        where: { dealId: deal.id },
        include: loanInclude,
        orderBy: [{ interestRate: 'asc' }, { createdAt: 'desc' }],
    })
    const offers = loans.map((loan) => {
        const row = mapLoan(loan)
        const principal = row.sanctionedAmount ?? row.loanAmount
        let monthlyPayment: number | null = null
        if (principal && row.interestRate != null && row.tenureYears != null) {
            try {
                monthlyPayment = computeEmi(principal, row.interestRate, row.tenureYears * 12)
            } catch {
                monthlyPayment = null
            }
        }
        return { ...row, monthlyPayment }
    })

    return {
        success: true,
        data: {
            deal: {
                id: deal.id,
                buyerName: deal.contact.name,
                unitNumber: deal.unit?.unitNumber ?? null,
                projectName: deal.unit?.tower.project?.name ?? null,
            },
            offers,
        },
    }
}

export async function createLoan(data: unknown): Promise<Result<LoanRow>> {
    const parsed = createLoanSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const d = parsed.data
    const contact = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { id: true } })
    if (!contact) return { success: false, error: 'Contact not found' }
    if (d.dealId != null) {
        const deal = await prisma.deal.findUnique({ where: { id: d.dealId }, select: { contactId: true } })
        if (!deal) return { success: false, error: 'Deal not found' }
        if (deal.contactId !== d.contactId) return { success: false, error: 'The selected deal belongs to a different contact' }
    }
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
