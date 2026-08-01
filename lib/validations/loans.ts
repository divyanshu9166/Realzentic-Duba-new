import { z } from 'zod'
import { idSchema } from '@/lib/validations/common'

export const loanStatusEnum = z.enum([
    'Enquiry',
    'Documentation',
    'Submitted',
    'Sanctioned',
    'Disbursed',
    'Rejected',
])

const wholeAed = z
    .number({ message: 'Amount must be a number' })
    .int('Amount must be a whole number of AED')
    .min(0, 'Amount must not be negative')

export const createLoanSchema = z.object({
    contactId: idSchema,
    dealId: idSchema.optional().nullable(),
    bankName: z.string().trim().min(1, 'Bank name is required').max(120),
    loanAmount: wholeAed.optional().nullable(),
    interestRate: z.number().finite().min(0).max(100).optional().nullable(),
    tenureYears: z.number().int().min(1).max(40).optional().nullable(),
    status: loanStatusEnum.default('Enquiry'),
    applicationNo: z.string().trim().max(80).optional().nullable(),
    sanctionedAmount: wholeAed.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    assignedToId: idSchema.optional().nullable(),
})

export const updateLoanSchema = z.object({
    id: idSchema,
    bankName: z.string().trim().min(1).max(120).optional(),
    loanAmount: wholeAed.optional().nullable(),
    interestRate: z.number().finite().min(0).max(100).optional().nullable(),
    tenureYears: z.number().int().min(1).max(40).optional().nullable(),
    status: loanStatusEnum.optional(),
    applicationNo: z.string().trim().max(80).optional().nullable(),
    sanctionedAmount: wholeAed.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    assignedToId: idSchema.optional().nullable(),
})

export type CreateLoanInput = z.infer<typeof createLoanSchema>
export type LoanStatus = z.infer<typeof loanStatusEnum>
