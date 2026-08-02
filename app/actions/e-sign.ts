'use server'

/**
 * E-Signature server actions.
 *
 * - createSignature  — validates and persists a DocumentSignature row.
 * - getSignaturesForContact — lists all signatures for a contact.
 */

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth-helpers'

// ─── Shared types ──────────────────────────────────────

type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string }

export interface CreateSignatureInput {
    signerName: string
    signerEmail?: string | null
    signerPhone?: string | null
    signatureUrl: string
    signedDocUrl?: string | null
    contactId?: number | null
    documentId?: number | null
    contractId?: number | null
}

// ─── Helpers ───────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
}

// ─── createSignature ───────────────────────────────────

export async function createSignature(
    data: CreateSignatureInput
): Promise<ActionResult<{
    id: number
    signerName: string
    signerEmail: string | null
    signerPhone: string | null
    signatureUrl: string
    signedDocUrl: string | null
    contactId: number | null
    documentId: number | null
    ipAddress: string | null
    signedAt: string
    createdAt: string
}>> {
    try {
        await requireAuth()
        if (!isNonEmptyString(data?.signerName)) {
            return { success: false, error: 'signerName is required' }
        }
        if (!isNonEmptyString(data?.signatureUrl)) {
            return { success: false, error: 'signatureUrl is required' }
        }
        if (data.contactId != null && !isPositiveInt(data.contactId)) {
            return { success: false, error: 'contactId must be a positive integer' }
        }
        if (data.documentId != null && !isPositiveInt(data.documentId)) {
            return { success: false, error: 'documentId must be a positive integer' }
        }
        if (data.contractId != null && !isPositiveInt(data.contractId)) {
            return { success: false, error: 'contractId must be a positive integer' }
        }

        // Verify referential integrity when contactId is provided.
        if (data.contactId != null) {
            const contact = await prisma.contact.findUnique({
                where: { id: data.contactId },
                select: { id: true },
            })
            if (!contact) {
                return { success: false, error: `Contact ${data.contactId} not found` }
            }
        }

        let contract: { id: number; fileUrl: string | null } | null = null
        if (data.contractId != null) {
            contract = await prisma.contract.findUnique({ where: { id: data.contractId }, select: { id: true, fileUrl: true } })
            if (!contract) return { success: false, error: `Contract ${data.contractId} not found` }
        }

        const signature = await prisma.documentSignature.create({
            data: {
                signerName: data.signerName.trim(),
                signerEmail: data.signerEmail?.trim() || null,
                signerPhone: data.signerPhone?.trim() || null,
                signatureUrl: data.signatureUrl,
                signedDocUrl: data.signedDocUrl ?? null,
                contactId: data.contactId ?? null,
                documentId: data.documentId ?? null,
                contractId: data.contractId ?? null,
                ipAddress: null,
            },
        })

        if (contract) {
            await prisma.contract.update({ where: { id: contract.id }, data: { status: 'SIGNED', signedAt: new Date(), signedFileUrl: contract.fileUrl } })
            revalidatePath('/billing')
        }

        revalidatePath('/documents')

        return {
            success: true,
            data: {
                id: signature.id,
                signerName: signature.signerName,
                signerEmail: signature.signerEmail,
                signerPhone: signature.signerPhone,
                signatureUrl: signature.signatureUrl,
                signedDocUrl: signature.signedDocUrl,
                contactId: signature.contactId,
                documentId: signature.documentId,
                ipAddress: signature.ipAddress,
                signedAt: signature.signedAt.toISOString(),
                createdAt: signature.createdAt.toISOString(),
            },
        }
    } catch (error) {
        console.error('Error creating signature:', error)
        return { success: false, error: 'Failed to save signature' }
    }
}

// ─── getSignaturesForContact ───────────────────────────

export async function getSignaturesForContact(
    contactId: number
): Promise<ActionResult<Array<{
    id: number
    signerName: string
    signerEmail: string | null
    signerPhone: string | null
    signatureUrl: string
    signedDocUrl: string | null
    documentId: number | null
    ipAddress: string | null
    signedAt: string
    createdAt: string
}>>> {
    try {
        if (!isPositiveInt(contactId)) {
            return { success: false, error: 'contactId must be a positive integer' }
        }

        const signatures = await prisma.documentSignature.findMany({
            where: { contactId },
            orderBy: { signedAt: 'desc' },
        })

        return {
            success: true,
            data: signatures.map((s) => ({
                id: s.id,
                signerName: s.signerName,
                signerEmail: s.signerEmail,
                signerPhone: s.signerPhone,
                signatureUrl: s.signatureUrl,
                signedDocUrl: s.signedDocUrl,
                documentId: s.documentId,
                ipAddress: s.ipAddress,
                signedAt: s.signedAt.toISOString(),
                createdAt: s.createdAt.toISOString(),
            })),
        }
    } catch (error) {
        console.error('Error fetching signatures for contact:', error)
        return { success: false, error: 'Failed to fetch signatures' }
    }
}
