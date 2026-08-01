'use server'

/**
 * Dynamic CMA (Comparative Market Analysis) — pricing intelligence.
 *
 * Inspired by the "Dynamic CMA" tools in BoldTrail/Lofty: given a subject
 * configuration (type + net area, optionally scoped to a city/project),
 * find comparable units across the live inventory and derive a data-backed
 * price-per-sqft band and a suggested price range. Helps agents price units
 * and justify the number to buyers.
 *
 * Read-only over the Unit/Project tables; carpet-area-based AED /sqft (the RERA
 * convention used across the rest of the app).
 */

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { idSchema, unitTypeEnum } from '@/lib/validations/common'

const cmaSchema = z.object({
    type: unitTypeEnum,
    netArea: z.number({ message: 'Net area must be a number' }).finite().positive('Net area must be greater than 0'),
    city: z.string().trim().optional(),
    projectId: idSchema.optional(),
    areaTolerancePct: z.number().int().min(5).max(100).optional(),
})

export interface Comparable {
    unitId: number
    projectName: string
    city: string
    unitNumber: string
    type: string
    status: string
    netArea: number
    totalPrice: number
    pricePerSqft: number
}

export interface CmaResult {
    subject: { type: string; netArea: number; city: string | null }
    comparableCount: number
    pricePerSqft: { min: number; avg: number; max: number }
    suggested: { low: number; mid: number; high: number }
    comparables: Comparable[]
}

type Result<T> = { success: true; data: T } | { success: false; error: string }

function toNum(v: unknown): number {
    if (v == null) return 0
    if (typeof v === 'number') return v
    if (typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
        try { return (v as { toNumber: () => number }).toNumber() } catch { return 0 }
    }
    return Number(v) || 0
}

export async function generateCma(input: unknown): Promise<Result<CmaResult>> {
    const parsed = cmaSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { type, netArea, city, projectId, areaTolerancePct } = parsed.data
    const tol = (areaTolerancePct ?? 25) / 100
    const minArea = netArea * (1 - tol)
    const maxArea = netArea * (1 + tol)

    try {
        const units = await prisma.unit.findMany({
            where: {
                type,
                netArea: { gte: minArea, lte: maxArea },
                tower: {
                    project: {
                        ...(projectId ? { id: projectId } : {}),
                        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
                    },
                },
            },
            select: {
                id: true,
                unitNumber: true,
                type: true,
                status: true,
                netArea: true,
                totalPrice: true,
                tower: { select: { project: { select: { name: true, city: true } } } },
            },
            take: 200,
        })

        const comparables: Comparable[] = units
            .map((u) => {
                const ca = u.netArea
                const price = toNum(u.totalPrice)
                const ppsf = ca > 0 ? price / ca : 0
                return {
                    unitId: u.id,
                    projectName: u.tower?.project?.name ?? '—',
                    city: u.tower?.project?.city ?? '—',
                    unitNumber: u.unitNumber,
                    type: u.type,
                    status: u.status,
                    netArea: ca,
                    totalPrice: price,
                    pricePerSqft: Math.round(ppsf),
                }
            })
            .filter((c) => c.pricePerSqft > 0)
            .sort((a, b) => Math.abs(a.netArea - netArea) - Math.abs(b.netArea - netArea))

        if (comparables.length === 0) {
            return {
                success: true,
                data: {
                    subject: { type, netArea, city: city ?? null },
                    comparableCount: 0,
                    pricePerSqft: { min: 0, avg: 0, max: 0 },
                    suggested: { low: 0, mid: 0, high: 0 },
                    comparables: [],
                },
            }
        }

        const ppsfValues = comparables.map((c) => c.pricePerSqft)
        const min = Math.min(...ppsfValues)
        const max = Math.max(...ppsfValues)
        const avg = Math.round(ppsfValues.reduce((s, v) => s + v, 0) / ppsfValues.length)

        return {
            success: true,
            data: {
                subject: { type, netArea, city: city ?? null },
                comparableCount: comparables.length,
                pricePerSqft: { min, avg, max },
                suggested: {
                    low: Math.round(min * netArea),
                    mid: Math.round(avg * netArea),
                    high: Math.round(max * netArea),
                },
                comparables: comparables.slice(0, 40),
            },
        }
    } catch (error) {
        console.error('Error generating CMA:', error)
        return { success: false, error: 'Failed to generate CMA' }
    }
}
