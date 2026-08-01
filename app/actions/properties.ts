'use server'

/**
 * Inventory_Service — core server actions for Module 1 (Property & Inventory).
 *
 * This file is the head of the inventory/cost-sheet write-chain. Later tasks
 * append additional sections to it:
 *   - Task 3.3  — unit status changes, timed holds, and price revisions.
 *   - Task 5.1  — cost-sheet builder and payment-plan actions.
 *   - Task 5.2  — cost-sheet PDF generation and sharing.
 * Keep new actions grouped under clearly-labelled section banners so the file
 * stays navigable as it grows.
 *
 * Conventions (match the existing `app/actions/*.ts` style):
 *   - `'use server'` module with async server actions.
 *   - Prisma client imported from `@/lib/db`.
 *   - Every action returns a `Result<T>` discriminated union
 *     (`{ success: true, data }` or `{ success: false, error }`).
 *   - Every write validates its input with the Zod schemas in
 *     `@/lib/validations/properties` before touching the database (Req 1.10,
 *     20.4) and surfaces the offending field via the schema's error message.
 *   - Pure domain math (`computeTotalPrice`, `computePercentSold`,
 *     `filterUnits`, `computeAnalytics`) is delegated to `@/lib/inventory`.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.8, 20.6
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { groqChat } from '@/lib/ai-agent/groq'
import { idSchema, moneyAmount, percentage, unitStatusEnum } from '@/lib/validations/common'
import {
    createFloorSchema,
    createProjectSchema,
    createTowerSchema,
    createUnitSchema,
} from '@/lib/validations/properties'
import {
    canTransition,
    computeAnalytics,
    computePercentSold,
    computeTotalPrice,
    matchesUnitFilters,
    type AnalyticsUnit,
    type FilterableUnit,
    type InventoryAnalytics,
    type UnitFilters,
    type UnitStatus,
} from '@/lib/inventory'
import {
    computeGross,
    computeNetPayable,
    computeDldFee,
    vatRateForProperty,
    splitMilestones,
    validateDiscount,
    type PaymentPlanInput,
    type SplitMilestone,
} from '@/lib/cost-sheet'
import { assertMoneyRange, roundMoney } from '@/lib/money'
import { formatCompactCurrency, formatCurrency } from '@/lib/currency'
import { uploadFile } from '@/lib/r2'
import { sendEmail } from '@/lib/email'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isValidE164, normalizePhoneForMetaUae } from '@/lib/whatsapp/phone-utils'

// ---------------------------------------------------------------------------
// Shared result type and helpers
// ---------------------------------------------------------------------------

/** Standard server-action result shape used across the inventory service. */
export type Result<T> =
    | { success: true; data: T }
    | { success: false; error: string }

/** Path of the inventory UI; revalidated after any inventory mutation. */
const PROPERTIES_PATH = '/properties'

/**
 * Convert a Prisma `Decimal` (or null) to a plain `number` so results are
 * safe to pass to client components. Prisma `Decimal` values stringify
 * losslessly, so `Number(...)` reproduces the stored 2-dp money value.
 */
function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
    if (value === null || value === undefined) return null
    return typeof value === 'number' ? value : Number(value)
}

/** Pull the first Zod issue message (which names the offending field). */
function firstIssue(error: z.ZodError): string {
    return error.issues[0]?.message ?? 'Invalid input'
}

/**
 * Map a fully-loaded Prisma `Unit` to a JSON-serializable shape with money
 * fields coerced to numbers. Accepts any object carrying the unit's `Decimal`
 * money fields so it can serialize units fetched with varying `include`s.
 */
type UnitWithMoney = {
    basePricePerSqft: Prisma.Decimal
    floorRisePremium: Prisma.Decimal
    viewPremium: Prisma.Decimal
    totalPrice: Prisma.Decimal
    [key: string]: unknown
}

function serializeUnit<T extends UnitWithMoney>(unit: T) {
    return {
        ...unit,
        basePricePerSqft: toNumber(unit.basePricePerSqft),
        floorRisePremium: toNumber(unit.floorRisePremium),
        viewPremium: toNumber(unit.viewPremium),
        totalPrice: toNumber(unit.totalPrice),
    }
}

// ---------------------------------------------------------------------------
// Req 1.1 — createProject
// ---------------------------------------------------------------------------

/**
 * Persist a new Project after validating required fields, enums, and ranges
 * (Req 1.1, 1.10). Returns the created project on success.
 */
export async function createProject(data: unknown): Promise<Result<unknown>> {
    const parsed = createProjectSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    try {
        const project = await prisma.project.create({ data: parsed.data })
        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: project }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to create project') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.2 — createTower
// ---------------------------------------------------------------------------

/**
 * Persist a Tower linked to a Project (Req 1.2). Validates that the parent
 * project exists before writing so the FK error is surfaced as a clear field
 * error rather than a raw constraint violation.
 */
export async function createTower(data: unknown): Promise<Result<unknown>> {
    const parsed = createTowerSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId } })
    if (!project) return { success: false, error: 'projectId: project not found' }

    try {
        const tower = await prisma.tower.create({ data: parsed.data })
        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: tower }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to create tower') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.3 — createFloor
// ---------------------------------------------------------------------------

/**
 * Persist a Floor linked to a Tower (Req 1.3). Enforces the parent tower's
 * existence and surfaces the unique `(towerId, floorNumber)` constraint as a
 * field error.
 */
export async function createFloor(data: unknown): Promise<Result<unknown>> {
    const parsed = createFloorSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const tower = await prisma.tower.findUnique({ where: { id: parsed.data.towerId } })
    if (!tower) return { success: false, error: 'towerId: tower not found' }

    try {
        const floor = await prisma.floor.create({ data: parsed.data })
        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: floor }
    } catch (err) {
        if (isUniqueViolation(err)) {
            return { success: false, error: 'floorNumber: floor already exists for this tower' }
        }
        return { success: false, error: errorMessage(err, 'Failed to create floor') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.4 / 1.5 — createUnit
// ---------------------------------------------------------------------------

/**
 * Persist a Unit linked to a Tower (Req 1.4). The total price is derived from
 * the unit's pricing fields via {@link computeTotalPrice} (Req 1.5) unless an
 * explicit `totalPrice` override is supplied. Validates the parent tower and
 * surfaces the unique `(towerId, unitNumber)` constraint as a field error.
 */
export async function createUnit(data: unknown): Promise<Result<unknown>> {
    const parsed = createUnitSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const tower = await prisma.tower.findUnique({ where: { id: parsed.data.towerId } })
    if (!tower) return { success: false, error: 'towerId: tower not found' }

    let unitData: Prisma.UnitUncheckedCreateInput
    try {
        unitData = buildUnitCreateData(parsed.data)
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Invalid unit pricing') }
    }

    try {
        const unit = await prisma.unit.create({ data: unitData })
        revalidatePath(PROPERTIES_PATH)
        // Fire-and-forget: notify waitlisted buyers about the new unit (Feature B)
        notifyWaitlistOnNewUnit(unit.id).catch(console.error)
        return { success: true, data: serializeUnit(unit) }
    } catch (err) {
        if (isUniqueViolation(err)) {
            return { success: false, error: 'unitNumber: unit already exists in this tower' }
        }
        return { success: false, error: errorMessage(err, 'Failed to create unit') }
    }
}

/**
 * Build a Prisma create payload for a Unit from a validated `createUnitSchema`
 * input, computing `totalPrice` (Req 1.5) when no override is provided.
 * Shared by {@link createUnit} and {@link bulkCreateUnits}.
 */
function buildUnitCreateData(
    input: z.infer<typeof createUnitSchema>
): Prisma.UnitUncheckedCreateInput {
    const totalPrice =
        input.totalPrice ??
        computeTotalPrice(
            input.basePricePerSqft,
            input.builtUpArea,
            input.floorRisePremium,
            input.viewPremium
        )

    return {
        towerId: input.towerId,
        floorNumber: input.floorNumber,
        unitNumber: input.unitNumber,
        type: input.type,
        netArea: input.netArea,
        builtUpArea: input.builtUpArea,
        facing: input.facing,
        status: input.status,
        basePricePerSqft: input.basePricePerSqft,
        floorRisePremium: input.floorRisePremium,
        viewPremium: input.viewPremium,
        totalPrice,
        parkingType: input.parkingType,
        parkingCount: input.parkingCount,
        bookingId: input.bookingId,
    }
}

// ---------------------------------------------------------------------------
// Req 1.9 — bulkCreateUnits (single transaction, all-or-nothing)
// ---------------------------------------------------------------------------

/**
 * Envelope schema for {@link bulkCreateUnits}. The per-unit attributes are
 * validated individually with `createUnitSchema`; this schema only validates
 * the bulk envelope (target tower, floor range, and per-floor count).
 */
const bulkCreateUnitsSchema = z
    .object({
        towerId: idSchema,
        floorRange: z
            .object({
                start: z
                    .number({ message: 'Floor range start must be a number' })
                    .int('Floor range start must be a whole number'),
                end: z
                    .number({ message: 'Floor range end must be a number' })
                    .int('Floor range end must be a whole number'),
            })
            .refine((r) => r.start <= r.end, {
                message: 'Floor range start must not exceed end',
            }),
        unitsPerFloor: z
            .number({ message: 'Units per floor must be a number' })
            .int('Units per floor must be a whole number')
            .min(1, 'Units per floor must be at least 1'),
        // Per-unit template; `towerId`, `floorNumber`, and `unitNumber` are
        // generated per floor/slot, so they are omitted from the template.
        unitTemplate: createUnitSchema
            .omit({ towerId: true, floorNumber: true, unitNumber: true })
            .partial({ floorRisePremium: true, viewPremium: true, status: true, parkingCount: true }),
    })
    .strict()

/**
 * Create many Unit records for a tower across a floor range in a single
 * transaction (Req 1.9). Every generated unit is validated with
 * `createUnitSchema`; IF any unit fails validation, the whole batch is
 * rejected and NO units are created. The database writes run inside one
 * `prisma.$transaction`, so any write failure (e.g. a unique-constraint
 * violation) rolls back the entire batch — the operation is all-or-nothing.
 *
 * Unit numbers are generated as `<floorNumber><slot:2>` (e.g. floor 5, slot 1
 * → "501"), which keeps them unique within the tower.
 */
export async function bulkCreateUnits(input: unknown): Promise<Result<{ count: number }>> {
    const parsed = bulkCreateUnitsSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const { towerId, floorRange, unitsPerFloor, unitTemplate } = parsed.data

    const tower = await prisma.tower.findUnique({ where: { id: towerId } })
    if (!tower) return { success: false, error: 'towerId: tower not found' }

    // ── Validate every generated unit BEFORE any write (Req 1.9 / 1.10). ──
    const payloads: Prisma.UnitUncheckedCreateInput[] = []
    for (let floor = floorRange.start; floor <= floorRange.end; floor++) {
        for (let slot = 1; slot <= unitsPerFloor; slot++) {
            const unitNumber = `${floor}${String(slot).padStart(2, '0')}`
            const candidate = {
                ...unitTemplate,
                towerId,
                floorNumber: floor,
                unitNumber,
            }

            const unitParsed = createUnitSchema.safeParse(candidate)
            if (!unitParsed.success) {
                return {
                    success: false,
                    error: `unit ${unitNumber}: ${firstIssue(unitParsed.error)}`,
                }
            }

            try {
                payloads.push(buildUnitCreateData(unitParsed.data))
            } catch (err) {
                return {
                    success: false,
                    error: `unit ${unitNumber}: ${errorMessage(err, 'invalid pricing')}`,
                }
            }
        }
    }

    if (payloads.length === 0) {
        return { success: false, error: 'No units to create for the given floor range' }
    }

    // ── Single transaction: all-or-nothing (Req 1.9). ──
    try {
        const count = await prisma.$transaction(async (tx) => {
            for (const data of payloads) {
                await tx.unit.create({ data })
            }
            return payloads.length
        })

        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: { count } }
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                success: false,
                error: 'unitNumber: one or more units already exist in this tower; no units were created',
            }
        }
        return { success: false, error: errorMessage(err, 'Bulk unit creation failed; no units were created') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.6 — listProjects (project cards with percentage sold)
// ---------------------------------------------------------------------------

/** A project summary card for the properties listing (Req 1.6). */
export interface ProjectCard {
    id: number
    name: string
    location: string
    city: string
    emirate: string
    dldProjectRegNo: string | null
    photoUrl: string | null
    unitCount: number
    percentSold: number
}

/**
 * List all projects as cards including unit count and percentage sold
 * (Req 1.6). `percentSold` is derived with {@link computePercentSold} over the
 * Booked + Sold counts and is `0` when a project has no units.
 */
export async function listProjects(): Promise<Result<ProjectCard[]>> {
    try {
        const projects = await prisma.project.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                towers: {
                    include: { units: { select: { status: true } } },
                },
            },
        })

        const cards: ProjectCard[] = projects.map((project) => {
            let total = 0
            let booked = 0
            let sold = 0
            for (const tower of project.towers) {
                for (const unit of tower.units) {
                    total += 1
                    if (unit.status === 'Booked') booked += 1
                    else if (unit.status === 'Sold') sold += 1
                }
            }

            return {
                id: project.id,
                name: project.name,
                location: project.location,
                city: project.city,
                emirate: project.emirate,
                dldProjectRegNo: project.dldProjectRegNo,
                photoUrl: project.photoUrls[0] ?? null,
                unitCount: total,
                percentSold: computePercentSold(booked, sold, total),
            }
        })

        return { success: true, data: cards }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to list projects') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.7 — getProjectDetail (towers + floor grid)
// ---------------------------------------------------------------------------

/**
 * Return a project's full detail: its towers, each tower's floors, and the
 * units grouped per tower (with money fields serialized to numbers) so the UI
 * can render tower tabs and a color-coded floor grid (Req 1.7).
 */
export async function getProjectDetail(projectId: unknown): Promise<Result<unknown>> {
    const parsedId = idSchema.safeParse(projectId)
    if (!parsedId.success) return { success: false, error: firstIssue(parsedId.error) }

    try {
        const project = await prisma.project.findUnique({
            where: { id: parsedId.data },
            include: {
                towers: {
                    include: {
                        floors: { orderBy: { floorNumber: 'asc' } },
                        units: { orderBy: [{ floorNumber: 'asc' }, { unitNumber: 'asc' }] },
                    },
                },
            },
        })

        if (!project) return { success: false, error: 'Project not found' }

        const detail = {
            ...project,
            towers: project.towers.map((tower) => ({
                ...tower,
                units: tower.units.map(serializeUnit),
            })),
        }

        return { success: true, data: detail }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load project detail') }
    }
}

// ---------------------------------------------------------------------------
// Req 1.8 — filterUnits (type/status/price/area/facing/floor)
// ---------------------------------------------------------------------------

/**
 * Return the units in a project that match the supplied filters (Req 1.8).
 * Filtering uses the pure {@link matchesUnitFilters} predicate so the server
 * result is consistent with the property-tested filter semantics. An empty
 * array is returned when no units match (the UI renders the empty state).
 */
export async function filterUnits(
    projectId: unknown,
    filters: UnitFilters = {}
): Promise<Result<unknown[]>> {
    const parsedId = idSchema.safeParse(projectId)
    if (!parsedId.success) return { success: false, error: firstIssue(parsedId.error) }

    try {
        const units = await prisma.unit.findMany({
            where: { tower: { projectId: parsedId.data } },
            orderBy: [{ floorNumber: 'asc' }, { unitNumber: 'asc' }],
        })

        const matched = units.filter((unit) => {
            const filterable: FilterableUnit = {
                type: unit.type,
                status: unit.status,
                facing: unit.facing,
                floorNumber: unit.floorNumber,
                builtUpArea: unit.builtUpArea,
                totalPrice: Number(unit.totalPrice),
            }
            return matchesUnitFilters(filterable, filters ?? {})
        })

        return { success: true, data: matched.map(serializeUnit) }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to filter units') }
    }
}

// ---------------------------------------------------------------------------
// Req 2.8 — getInventoryAnalytics
// ---------------------------------------------------------------------------

/**
 * Return aggregated inventory analytics for a project (Req 2.8): percentage
 * sold, total revenue potential, and available stock value, computed by the
 * pure {@link computeAnalytics} helper.
 */
export async function getInventoryAnalytics(
    projectId: unknown
): Promise<Result<InventoryAnalytics>> {
    const parsedId = idSchema.safeParse(projectId)
    if (!parsedId.success) return { success: false, error: firstIssue(parsedId.error) }

    try {
        const units = await prisma.unit.findMany({
            where: { tower: { projectId: parsedId.data } },
            select: { status: true, totalPrice: true },
        })

        const analyticsUnits: AnalyticsUnit[] = units.map((unit) => ({
            status: unit.status,
            totalPrice: Number(unit.totalPrice),
        }))

        return { success: true, data: computeAnalytics(analyticsUnits) }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to compute analytics') }
    }
}

// ===========================================================================
// Task 3.3 — Unit status changes, timed holds, and price revisions
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 20.5, 20.7
// ===========================================================================

/** Timed-hold duration bounds (hours), per Req 2.5. */
const HOLD_MIN_HOURS = 1
const HOLD_MAX_HOURS = 168
const HOLD_DEFAULT_HOURS = 48

/** Milliseconds in one hour, used to derive hold-expiry timestamps. */
const MS_PER_HOUR = 60 * 60 * 1000

/**
 * Identifies who performed an inventory action so the change can be audited
 * (Req 20.7) and, for holds, attributed to the blocking principal (Req 2.5).
 * A staff member, a channel partner, or both may be supplied; an explicit
 * `staffId` overrides the session user when resolving the audit performer.
 */
export interface InventoryActor {
    staffId?: number | null
    partnerId?: number | null
}

/**
 * Resolve the acting staff id for audit logging (Req 20.7): prefer an explicit
 * `actor.staffId`, then fall back to the session user's staff id, and finally
 * `null` when neither is available.
 */
async function resolveStaffId(actor?: InventoryActor): Promise<number | null> {
    if (actor && typeof actor.staffId === 'number' && Number.isFinite(actor.staffId)) {
        return actor.staffId
    }
    const session = await getSession()
    const staffId = session?.user?.staffId
    return typeof staffId === 'number' && Number.isFinite(staffId) ? staffId : null
}

/**
 * Record an audit/activity entry for a status-changing inventory action
 * (Req 20.7, design Property 69). Audit rows are written to `StaffActivity`,
 * which requires a staff id; when the action was performed by a channel
 * partner (or anonymously) no staff row exists to attribute it to, so the
 * audit write is skipped. The write runs on the supplied transaction client so
 * it commits atomically with the underlying state change (Req 20.6).
 */
async function recordUnitAudit(
    tx: Prisma.TransactionClient,
    staffId: number | null,
    type: string,
    text: string,
    when: Date
): Promise<void> {
    if (staffId == null) return
    await tx.staffActivity.create({
        data: {
            staffId,
            type,
            text,
            time: when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            date: when,
        },
    })
}

// ---------------------------------------------------------------------------
// Req 2.1 / 2.2 / 2.3 / 2.4 / 20.5 / 20.7 — changeUnitStatus
// ---------------------------------------------------------------------------

const changeUnitStatusSchema = z.object({
    unitId: idSchema,
    toStatus: unitStatusEnum,
})

/**
 * Change a Unit's status, permitting only the transitions encoded in
 * {@link canTransition} (Req 2.1). The current status is read under a
 * `SELECT ... FOR UPDATE` row lock inside a transaction so two concurrent
 * requests against the same unit are serialized and only the first can win
 * (Req 2.4, 20.5) — preventing double-booking. A disallowed transition leaves
 * the unit unchanged and returns an error naming the current and requested
 * status (Req 2.2). A successful change writes an audit entry (Req 20.7).
 *
 * @param unitId   The unit to transition.
 * @param toStatus The requested target status.
 * @param actor    Who is performing the change (for audit, Req 20.7).
 */
export async function changeUnitStatus(
    unitId: unknown,
    toStatus: unknown,
    actor?: InventoryActor
): Promise<Result<unknown>> {
    const parsed = changeUnitStatusSchema.safeParse({ unitId, toStatus })
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const staffId = await resolveStaffId(actor)

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Lock the unit row so concurrent transitions serialize (Req 2.4, 20.5).
            const locked = await tx.$queryRaw<Array<{ id: number; status: UnitStatus }>>`
                SELECT "id", "status" FROM "Unit" WHERE "id" = ${parsed.data.unitId} FOR UPDATE
            `
            const current = locked[0]
            if (!current) {
                return { success: false as const, error: 'Unit not found' }
            }

            const from = current.status
            const to = parsed.data.toStatus
            if (!canTransition(from, to)) {
                // Leave the unit unchanged and identify both states (Req 2.2).
                return {
                    success: false as const,
                    error: `Cannot change unit status from ${from} to ${to}`,
                }
            }

            const updated = await tx.unit.update({
                where: { id: current.id },
                data: { status: to },
            })

            await recordUnitAudit(
                tx,
                staffId,
                'unit_status',
                `Unit ${updated.unitNumber} status changed from ${from} to ${to}`,
                new Date()
            )

            return { success: true as const, data: serializeUnit(updated) }
        })

        if (result.success) revalidatePath(PROPERTIES_PATH)
        return result
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to change unit status') }
    }
}

// ---------------------------------------------------------------------------
// Req 2.3 / 2.4 / 2.5 / 20.5 / 20.7 — blockUnit (Timed_Hold)
// ---------------------------------------------------------------------------

const blockUnitSchema = z.object({
    unitId: idSchema,
    holdHours: z
        .number({ message: 'Hold duration must be a number' })
        .finite('Hold duration must be a finite number')
        .min(HOLD_MIN_HOURS, `Hold duration must be at least ${HOLD_MIN_HOURS} hour`)
        .max(HOLD_MAX_HOURS, `Hold duration must not exceed ${HOLD_MAX_HOURS} hours`)
        .default(HOLD_DEFAULT_HOURS),
})

/**
 * Place a Timed_Hold on an Available Unit (Req 2.5). The unit must currently be
 * Available; a block on any other status is rejected with an error identifying
 * the current status (Req 2.3). The current status is read under a
 * `SELECT ... FOR UPDATE` row lock inside a transaction so concurrent blocks
 * serialize and only the first wins (Req 2.4, 20.5).
 *
 * On success the unit transitions to Blocked and records the blocking staff or
 * channel partner, the hold-creation timestamp, and a hold-expiry timestamp
 * exactly `holdHours` ahead — a value in `[1, 168]` hours, defaulting to 48
 * when omitted (Req 2.5). An audit entry is written (Req 20.7).
 *
 * @param unitId    The unit to block.
 * @param holdHours Hold duration in `[1, 168]` hours (default 48).
 * @param actor     The blocking staff and/or channel partner (Req 2.5).
 */
export async function blockUnit(
    unitId: unknown,
    holdHours?: unknown,
    actor?: InventoryActor
): Promise<Result<unknown>> {
    const parsed = blockUnitSchema.safeParse({ unitId, holdHours })
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const staffId = await resolveStaffId(actor)
    const partnerId =
        actor && typeof actor.partnerId === 'number' && Number.isFinite(actor.partnerId)
            ? actor.partnerId
            : null

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Lock the unit row so concurrent blocks serialize (Req 2.4, 20.5).
            const locked = await tx.$queryRaw<Array<{ id: number; status: UnitStatus }>>`
                SELECT "id", "status" FROM "Unit" WHERE "id" = ${parsed.data.unitId} FOR UPDATE
            `
            const current = locked[0]
            if (!current) {
                return { success: false as const, error: 'Unit not found' }
            }

            // A block is only valid on an Available unit (Req 2.3).
            if (current.status !== 'Available') {
                return {
                    success: false as const,
                    error: `Cannot block unit: current status is ${current.status}`,
                }
            }

            const createdAt = new Date()
            const expiresAt = new Date(createdAt.getTime() + parsed.data.holdHours * MS_PER_HOUR)

            const updated = await tx.unit.update({
                where: { id: current.id },
                data: {
                    status: 'Blocked',
                    holdByStaffId: staffId,
                    holdByPartnerId: partnerId,
                    holdCreatedAt: createdAt,
                    holdExpiresAt: expiresAt,
                },
            })

            await recordUnitAudit(
                tx,
                staffId,
                'unit_hold',
                `Unit ${updated.unitNumber} blocked until ${expiresAt.toISOString()}`,
                createdAt
            )

            return { success: true as const, data: serializeUnit(updated) }
        })

        if (result.success) revalidatePath(PROPERTIES_PATH)
        return result
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to block unit') }
    }
}

// ---------------------------------------------------------------------------
// Req 2.6 — sweepExpiredHolds (Timed_Hold auto-release)
// ---------------------------------------------------------------------------

/**
 * Release every expired Timed_Hold (Req 2.6, design Property 9): for each unit
 * that is still Blocked and whose `holdExpiresAt` is at or before `now` (so it
 * never progressed to Booked), return the unit to Available and clear the hold
 * record (blocking principal and hold timestamps). Each release runs inside a
 * transaction; units that have since progressed to Booked are left untouched.
 *
 * Intended to be driven by the scheduled hold-expiry job. Returns the number
 * of units released.
 *
 * @param now The reference time; defaults to the current time. Injectable so
 *   the sweep is deterministic under test.
 */
export async function sweepExpiredHolds(now: Date = new Date()): Promise<Result<{ released: number }>> {
    try {
        const expired = await prisma.unit.findMany({
            where: {
                status: 'Blocked',
                holdExpiresAt: { not: null, lte: now },
            },
            select: { id: true },
        })

        if (expired.length === 0) {
            return { success: true, data: { released: 0 } }
        }

        const released = await prisma.$transaction(async (tx) => {
            let count = 0
            for (const { id } of expired) {
                // Re-check status inside the transaction so a unit that raced to
                // Booked between the scan and the write is not reverted (Req 2.6).
                const result = await tx.unit.updateMany({
                    where: { id, status: 'Blocked', holdExpiresAt: { not: null, lte: now } },
                    data: {
                        status: 'Available',
                        holdByStaffId: null,
                        holdByPartnerId: null,
                        holdCreatedAt: null,
                        holdExpiresAt: null,
                    },
                })
                count += result.count
            }
            return count
        })

        if (released > 0) revalidatePath(PROPERTIES_PATH)
        return { success: true, data: { released } }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to sweep expired holds') }
    }
}

// ---------------------------------------------------------------------------
// Req 2.7 / 20.7 — revisePrice (UnitPriceHistory)
// ---------------------------------------------------------------------------

const revisePriceSchema = z.object({
    unitId: idSchema,
    newPrice: moneyAmount,
    reason: z
        .string({ message: 'Reason is required' })
        .trim()
        .min(1, 'Reason must be at least 1 character')
        .max(500, 'Reason must not exceed 500 characters'),
})

/**
 * Revise a Unit's total price (Req 2.7). Within a single transaction the unit's
 * `totalPrice` is updated to `newPrice` and a {@link UnitPriceHistory} record is
 * created capturing the old price, new price, changed-by, effective date, and
 * reason (1–500 characters). The `UnitPriceHistory` row is itself the audit
 * trail for this financial action (Req 20.7), recording who changed the price
 * and when.
 *
 * @param unitId   The unit whose price is revised.
 * @param newPrice The new total price (money range, 0.00–999,999,999.99).
 * @param reason   The reason for the revision (1–500 characters).
 * @param actor    Who is performing the revision (for changed-by, Req 20.7).
 */
export async function revisePrice(
    unitId: unknown,
    newPrice: unknown,
    reason: unknown,
    actor?: InventoryActor
): Promise<Result<unknown>> {
    const parsed = revisePriceSchema.safeParse({ unitId, newPrice, reason })
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const changedById = await resolveStaffId(actor)

    try {
        const result = await prisma.$transaction(async (tx) => {
            const unit = await tx.unit.findUnique({ where: { id: parsed.data.unitId } })
            if (!unit) {
                return { success: false as const, error: 'Unit not found' }
            }

            const oldPrice = toNumber(unit.totalPrice) ?? 0

            await tx.unitPriceHistory.create({
                data: {
                    unitId: unit.id,
                    oldPrice,
                    newPrice: parsed.data.newPrice,
                    changedById,
                    reason: parsed.data.reason,
                },
            })

            const updated = await tx.unit.update({
                where: { id: unit.id },
                data: { totalPrice: parsed.data.newPrice },
            })

            return { success: true as const, data: serializeUnit(updated) }
        })

        if (result.success) revalidatePath(PROPERTIES_PATH)
        return result
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to revise unit price') }
    }
}

// ---------------------------------------------------------------------------
// Internal error helpers
// ---------------------------------------------------------------------------

/** Narrow a thrown value to a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'P2002'
    )
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message
    return fallback
}

// ===========================================================================
// Task 5.1 — Cost_Sheet_Service: builder, payment plans, schedule generation
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.11, 20.4
//
// `buildCostSheet` auto-populates the unit-derived figures (base cost, floor
// rise, view premium, parking) from the Unit (Req 3.1), computes DLD transfer fees
// from the Dubai Land Department fee and VAT from the project's property type,
// and derives net
// payable as `total + Σ(add-ons) − discount` (Req 3.3) while rejecting any
// discount that exceeds the gross so net payable can never go negative
// (Req 3.4, via `validateDiscount`). `upsertPaymentPlan` enforces at most one
// default plan per project (Req 3.11), and `generatePaymentSchedule` links a
// booking and plan to dated milestone amounts whose sum equals the basis
// (Req 3.11, via `splitMilestones`). All money math reuses the shared helpers.
// ===========================================================================

/**
 * Serialize a Prisma `CostSheet` to a JSON-safe shape with every `Decimal`
 * money field coerced to a plain `number` so it is safe to hand to client
 * components.
 */
type CostSheetWithMoney = {
    baseCost: Prisma.Decimal
    floorRise: Prisma.Decimal
    viewPremium: Prisma.Decimal
    parkingCharges: Prisma.Decimal
    clubhouseCharges: Prisma.Decimal
    legalCharges: Prisma.Decimal
    dldTransferFee: Prisma.Decimal
    vatAmount: Prisma.Decimal
    registrationCharges: Prisma.Decimal
    total: Prisma.Decimal
    discount: Prisma.Decimal
    netPayable: Prisma.Decimal
    [key: string]: unknown
}

function serializeCostSheet<T extends CostSheetWithMoney>(sheet: T) {
    return {
        ...sheet,
        baseCost: toNumber(sheet.baseCost),
        floorRise: toNumber(sheet.floorRise),
        viewPremium: toNumber(sheet.viewPremium),
        parkingCharges: toNumber(sheet.parkingCharges),
        clubhouseCharges: toNumber(sheet.clubhouseCharges),
        legalCharges: toNumber(sheet.legalCharges),
        dldTransferFee: toNumber(sheet.dldTransferFee),
        vatAmount: toNumber(sheet.vatAmount),
        registrationCharges: toNumber(sheet.registrationCharges),
        total: toNumber(sheet.total),
        discount: toNumber(sheet.discount),
        netPayable: toNumber(sheet.netPayable),
    }
}

// ---------------------------------------------------------------------------
// Req 3.1 / 3.2 / 3.3 / 3.4 / 3.5 — buildCostSheet
// ---------------------------------------------------------------------------

/**
 * Add-on charges supplied by the caller. Unit-derived figures (base cost,
 * floor rise, view premium) are read from the Unit and are NOT part of this
 * input (Req 3.1). DLD fees and VAT are computed automatically (Req 3.5–3.8)
 * but MAY be overridden here when a deal-specific figure is required. Every
 * field defaults to `0` when omitted.
 */
const costSheetAddonsSchema = z
    .object({
        parkingCharges: moneyAmount.optional(),
        clubhouseCharges: moneyAmount.optional(),
        legalCharges: moneyAmount.optional(),
        registrationCharges: moneyAmount.optional(),
        // Optional explicit overrides; otherwise computed from the Dubai fee
        // and property-use rules.
        dldTransferFee: moneyAmount.optional(),
        vatAmount: moneyAmount.optional(),
    })
    .strict()
    .default({})

/**
 * Build and persist a {@link CostSheet} for a Unit and Contact (Req 3.1, 3.2).
 *
 * Auto-populated from the Unit (Req 3.1):
 *   - `baseCost`   = base price per sqft × super-built-up area
 *   - `floorRise`  = the unit's floor-rise premium
 *   - `viewPremium`= the unit's view premium
 *   - `total`      = the unit's total price (base + floor rise + view)
 *
 * Computed (Req 3.5–3.8): DLD transfer fees for the project's Dubai sale via
 * {@link computeDldFee} and VAT from the project's property type via
 * {@link vatRateForProperty}; either may be overridden through `addons`.
 *
 * Net payable is `total + Σ(add-ons) − discount` (Req 3.3). A discount that
 * exceeds the gross amount is rejected with an error so net payable can never
 * be negative (Req 3.4). All inputs are validated before any write (Req 20.4).
 *
 * @param unitId    The unit to price.
 * @param contactId The buyer the cost sheet is for.
 * @param addons    Add-on charges and optional DLD/VAT overrides.
 * @param discount  The discount to apply (default 0).
 * @param actor     Who is generating the sheet (for `generatedById`).
 */
export async function buildCostSheet(
    unitId: unknown,
    contactId: unknown,
    addons?: unknown,
    discount?: unknown,
    actor?: InventoryActor
): Promise<Result<unknown>> {
    const parsedUnitId = idSchema.safeParse(unitId)
    if (!parsedUnitId.success) return { success: false, error: `unitId: ${firstIssue(parsedUnitId.error)}` }

    const parsedContactId = idSchema.safeParse(contactId)
    if (!parsedContactId.success) {
        return { success: false, error: `contactId: ${firstIssue(parsedContactId.error)}` }
    }

    const parsedAddons = costSheetAddonsSchema.safeParse(addons ?? {})
    if (!parsedAddons.success) return { success: false, error: firstIssue(parsedAddons.error) }

    const parsedDiscount = moneyAmount.default(0).safeParse(discount ?? 0)
    if (!parsedDiscount.success) return { success: false, error: `discount: ${firstIssue(parsedDiscount.error)}` }

    const generatedById = await resolveStaffId(actor)

    try {
        const unit = await prisma.unit.findUnique({
            where: { id: parsedUnitId.data },
            include: { tower: { include: { project: true } } },
        })
        if (!unit) return { success: false, error: 'Unit not found' }

        const contact = await prisma.contact.findUnique({ where: { id: parsedContactId.data } })
        if (!contact) return { success: false, error: 'Contact not found' }

        const project = unit.tower.project

        // ── Unit-derived figures (Req 3.1). ──
        const baseCost = roundMoney(Number(unit.basePricePerSqft) * unit.builtUpArea)
        const floorRise = toNumber(unit.floorRisePremium) ?? 0
        const viewPremium = toNumber(unit.viewPremium) ?? 0
        const total = toNumber(unit.totalPrice) ?? roundMoney(baseCost + floorRise + viewPremium)

        // ── Add-ons and computed charges (Req 3.5–3.8). ──
        const parkingCharges = parsedAddons.data.parkingCharges ?? 0
        const clubhouseCharges = parsedAddons.data.clubhouseCharges ?? 0
        const legalCharges = parsedAddons.data.legalCharges ?? 0
        const registrationCharges = parsedAddons.data.registrationCharges ?? 0
        const dldTransferFee = parsedAddons.data.dldTransferFee ?? computeDldFee(total).transferFee
        const vatAmount = parsedAddons.data.vatAmount ?? roundMoney(total * vatRateForProperty(project.type))

        const addonList = [
            parkingCharges,
            clubhouseCharges,
            legalCharges,
            dldTransferFee,
            vatAmount,
            registrationCharges,
        ]

        // ── Gross, discount guard (Req 3.4), and net payable (Req 3.3). ──
        const gross = computeGross(total, addonList)
        const discountAmount = parsedDiscount.data
        if (!validateDiscount(gross, discountAmount)) {
            return {
                success: false,
                error: `discount: ${discountAmount} exceeds gross amount ${gross}; net payable cannot be negative`,
            }
        }
        const netPayable = computeNetPayable(total, addonList, discountAmount)

        const sheet = await prisma.costSheet.create({
            data: {
                unitId: unit.id,
                contactId: contact.id,
                baseCost,
                floorRise,
                viewPremium,
                parkingCharges,
                clubhouseCharges,
                legalCharges,
                dldTransferFee,
                vatAmount,
                registrationCharges,
                total,
                discount: discountAmount,
                netPayable,
                generatedById,
            },
        })

        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: serializeCostSheet(sheet) }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to build cost sheet') }
    }
}

// ---------------------------------------------------------------------------
// Req 3.11 — upsertPaymentPlan (≤1 default per project)
// ---------------------------------------------------------------------------

/** A single milestone definition within a payment plan (Req 3.11). */
const planMilestoneSchema = z.object({
    name: z
        .string({ message: 'Milestone name is required' })
        .trim()
        .min(1, 'Milestone name must be at least 1 character')
        .max(100, 'Milestone name must not exceed 100 characters'),
    dueOffsetDays: z
        .number({ message: 'Milestone dueOffsetDays must be a number' })
        .int('Milestone dueOffsetDays must be a whole number')
        .min(0, 'Milestone dueOffsetDays must not be negative'),
    percentage,
})

/**
 * Validate a payment-plan upsert. The milestone percentages must sum to 100
 * (within a 0.01 rounding tolerance) so the plan covers the entire basis
 * amount; over-allocation (sum > 100) would push the final milestone negative.
 */
const upsertPaymentPlanSchema = z
    .object({
        id: idSchema.optional(),
        name: z
            .string({ message: 'Plan name is required' })
            .trim()
            .min(1, 'Plan name must be at least 1 character')
            .max(100, 'Plan name must not exceed 100 characters'),
        isDefault: z.boolean().default(false),
        milestones: z
            .array(planMilestoneSchema)
            .min(1, 'A payment plan must have at least one milestone'),
    })
    .strict()
    .refine(
        (plan) => Math.abs(plan.milestones.reduce((sum, m) => sum + m.percentage, 0) - 100) <= 0.01,
        { message: 'milestones: percentages must sum to 100', path: ['milestones'] }
    )

/**
 * Create or update a {@link PaymentPlan} for a project (Req 3.11). At most one
 * default plan may exist per project: when the upserted plan is marked default,
 * every other plan for the same project is cleared of its default flag inside
 * the same transaction so the at-most-one-default invariant always holds. When
 * an `id` is supplied the matching plan is updated (and must belong to the
 * given project); otherwise a new plan is created. Milestone definitions are
 * stored as JSON.
 *
 * @param projectId The project the plan belongs to.
 * @param plan      The plan definition (`{ id?, name, isDefault, milestones }`).
 */
export async function upsertPaymentPlan(
    projectId: unknown,
    plan: unknown
): Promise<Result<unknown>> {
    const parsedProjectId = idSchema.safeParse(projectId)
    if (!parsedProjectId.success) {
        return { success: false, error: `projectId: ${firstIssue(parsedProjectId.error)}` }
    }

    const parsed = upsertPaymentPlanSchema.safeParse(plan)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const project = await prisma.project.findUnique({ where: { id: parsedProjectId.data } })
    if (!project) return { success: false, error: 'projectId: project not found' }

    const { id, name, isDefault, milestones } = parsed.data
    const milestonesJson = milestones as unknown as Prisma.InputJsonValue

    try {
        const result = await prisma.$transaction(async (tx) => {
            if (id != null) {
                // Updating an existing plan: it must belong to this project.
                const existing = await tx.paymentPlan.findUnique({ where: { id } })
                if (!existing || existing.projectId !== parsedProjectId.data) {
                    return { success: false as const, error: 'Payment plan not found for this project' }
                }
            }

            // Enforce ≤1 default per project (Req 3.11): clear other defaults.
            if (isDefault) {
                await tx.paymentPlan.updateMany({
                    where: {
                        projectId: parsedProjectId.data,
                        isDefault: true,
                        ...(id != null ? { id: { not: id } } : {}),
                    },
                    data: { isDefault: false },
                })
            }

            const saved =
                id != null
                    ? await tx.paymentPlan.update({
                        where: { id },
                        data: { name, isDefault, milestones: milestonesJson },
                    })
                    : await tx.paymentPlan.create({
                        data: {
                            projectId: parsedProjectId.data,
                            name,
                            isDefault,
                            milestones: milestonesJson,
                        },
                    })

            return { success: true as const, data: saved }
        })

        if (result.success) revalidatePath(PROPERTIES_PATH)
        return result
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to save payment plan') }
    }
}

// ---------------------------------------------------------------------------
// Req 3.11 — generatePaymentSchedule (dated milestone amounts summing to basis)
// ---------------------------------------------------------------------------

const generatePaymentScheduleSchema = z.object({
    bookingId: idSchema,
    paymentPlanId: idSchema,
    basisAmount: moneyAmount,
})

/**
 * Generate a {@link PaymentSchedule} linking a booking and a payment plan, and
 * compute the dated milestone amounts for that plan over the basis amount
 * (typically the cost-sheet net payable or the booking agreement value). The
 * milestone amounts are produced by the pure {@link splitMilestones} helper, so
 * their sum equals the basis amount EXACTLY (Req 3.11). The `PaymentSchedule`
 * row is persisted as the booking↔plan link; the computed breakdown is returned
 * alongside it for callers (e.g. the milestone tracker) to render.
 *
 * @param bookingId     The booking the schedule belongs to.
 * @param paymentPlanId The payment plan to apply.
 * @param basisAmount   The amount to split across the plan's milestones.
 */
export async function generatePaymentSchedule(
    bookingId: unknown,
    paymentPlanId: unknown,
    basisAmount: unknown
): Promise<Result<{ schedule: unknown; milestones: SplitMilestone[] }>> {
    const parsed = generatePaymentScheduleSchema.safeParse({ bookingId, paymentPlanId, basisAmount })
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    try {
        const plan = await prisma.paymentPlan.findUnique({ where: { id: parsed.data.paymentPlanId } })
        if (!plan) return { success: false, error: 'Payment plan not found' }

        const booking = await prisma.booking.findUnique({ where: { id: parsed.data.bookingId } })
        if (!booking) return { success: false, error: 'Booking not found' }

        // Compute the dated milestone amounts (sum equals basis exactly, Req 3.11).
        let milestones: SplitMilestone[]
        try {
            const planInput = plan.milestones as unknown as PaymentPlanInput
            milestones = splitMilestones(planInput, parsed.data.basisAmount)
        } catch (err) {
            return { success: false, error: errorMessage(err, 'Invalid payment plan milestones') }
        }

        const schedule = await prisma.paymentSchedule.create({
            data: {
                bookingId: parsed.data.bookingId,
                paymentPlanId: parsed.data.paymentPlanId,
            },
        })

        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: { schedule, milestones } }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to generate payment schedule') }
    }
}

// ===========================================================================
// Task 5.2 — Cost_Sheet_Service: PDF generation and sharing
// Requirements: 3.9, 3.10
//
// `generateCostSheetPdf` builds a branded A4 PDF for a CostSheet using
// jspdf, pulling store name and logo from StoreSettings (Assumption A9,
// Req 3.9).  On success the generated URL is persisted to `CostSheet.pdfUrl`
// and returned.  On any failure the *existing* pdfUrl is preserved and an
// error is returned so the caller always gets a determinate response
// (Req 3.9).
//
// `shareCostSheet` dispatches the cost-sheet PDF link to the buyer over
// WhatsApp and/or Email (Req 3.10).  Each channel records an observable
// delivery status ('Sent' | 'Failed' | 'Skipped') that the caller can
// inspect.  The action never throws; channel failures are recorded in the
// return value.
// ===========================================================================

// ---------------------------------------------------------------------------
// Req 3.9 — generateCostSheetPdf
// ---------------------------------------------------------------------------

/**
 * Generate a branded PDF for a {@link CostSheet} and persist the resulting
 * URL back to the record (Req 3.9).
 *
 * Branding (store name, logo, bank details) is pulled from the single
 * {@link StoreSettings} row (Assumption A9).  The PDF is produced with
 * `jspdf` and uploaded via the shared `uploadFile` helper (same storage
 * as all other documents in the system).
 *
 * **Failure contract (Req 3.9):** if any step after the initial validation
 * throws, the function catches the error, leaves `CostSheet.pdfUrl`
 * unchanged, and returns `{ success: false, error }`.  The caller can
 * therefore always rely on the existing `pdfUrl` being valid when an error
 * is returned.
 *
 * @param costSheetId  The cost sheet to generate a PDF for.
 * @returns On success: `{ success: true, data: { pdfUrl } }`.
 *          On failure: `{ success: false, error }`.
 */
export async function generateCostSheetPdf(
    costSheetId: unknown
): Promise<Result<{ pdfUrl: string }>> {
    const parsedId = idSchema.safeParse(costSheetId)
    if (!parsedId.success) {
        return { success: false, error: `costSheetId: ${firstIssue(parsedId.error)}` }
    }

    try {
        // ── Fetch the cost sheet with related unit, project, and contact. ──
        const sheet = await prisma.costSheet.findUnique({
            where: { id: parsedId.data },
            include: {
                unit: {
                    include: { tower: { include: { project: true } } },
                },
                contact: true,
            },
        })
        if (!sheet) return { success: false, error: 'Cost sheet not found' }

        // ── Fetch branding from StoreSettings (A9). ──
        const settings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
        const storeName = settings?.storeName ?? 'Real Estate Agency'
        const storePhone = settings?.phone ?? ''
        const storeEmail = settings?.email ?? ''
        const storeAddress = settings?.address ?? ''
        const bankName = settings?.bankName ?? ''
        const bankAccountName = settings?.bankAccountName ?? ''
        const bankAccountNumber = settings?.bankAccountNumber ?? ''
        const bankIban = settings?.bankIban ?? ''

        const project = sheet.unit.tower.project
        const contact = sheet.contact

        // ── Build the PDF with jspdf. ──
        const { jsPDF } = await import('jspdf')
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        const marginX = 15
        const pageWidth = doc.internal.pageSize.getWidth()
        let y = 18

        // Header — store name
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.text(storeName, marginX, y)
        y += 7

        // Store contact details
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        const headerParts: string[] = []
        if (storePhone) headerParts.push(`Ph: ${storePhone}`)
        if (storeEmail) headerParts.push(`Email: ${storeEmail}`)
        if (storeAddress) headerParts.push(storeAddress)
        if (headerParts.length > 0) {
            doc.text(headerParts.join('  |  '), marginX, y)
            y += 6
        }

        // Divider
        doc.setDrawColor(180, 180, 180)
        doc.line(marginX, y, pageWidth - marginX, y)
        y += 6

        // Document title
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.text('COST SHEET', marginX, y)
        y += 8

        // Project & unit details
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text('Project Details', marginX, y)
        y += 6
        doc.setFont('helvetica', 'normal')
        doc.text(`Project: ${project.name}`, marginX, y)
        y += 5
        doc.text(`Location: ${project.location}, ${project.city}, ${project.emirate}`, marginX, y)
        y += 5
        if (project.dldProjectRegNo) {
            doc.text(`DLD Registration No: ${project.dldProjectRegNo}`, marginX, y)
            y += 5
        }
        doc.text(`Unit No: ${sheet.unit.unitNumber}  |  Floor: ${sheet.unit.floorNumber}  |  Type: ${sheet.unit.type}`, marginX, y)
        y += 5
        doc.text(
            `Built-Up Area (BUA): ${sheet.unit.builtUpArea.toFixed(2)} sq ft  |  Net Area: ${sheet.unit.netArea.toFixed(2)} sq ft`,
            marginX,
            y
        )
        y += 8

        // Buyer details
        doc.setFont('helvetica', 'bold')
        doc.text('Buyer Details', marginX, y)
        y += 6
        doc.setFont('helvetica', 'normal')
        doc.text(`Name: ${contact.name}`, marginX, y)
        y += 5
        if (contact.phone) {
            doc.text(`Phone: ${contact.phone}`, marginX, y)
            y += 5
        }
        if (contact.email) {
            doc.text(`Email: ${contact.email}`, marginX, y)
            y += 5
        }
        y += 3

        // Price breakdown table
        doc.setFont('helvetica', 'bold')
        doc.text('Price Breakdown', marginX, y)
        y += 6

        const col1X = marginX
        const col2X = pageWidth - marginX - 40
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)

        const rows: [string, number][] = [
            ['Base Cost', toNumber(sheet.baseCost) ?? 0],
            ['Floor Rise Premium', toNumber(sheet.floorRise) ?? 0],
            ['View Premium', toNumber(sheet.viewPremium) ?? 0],
            ['Parking Charges', toNumber(sheet.parkingCharges) ?? 0],
            ['Clubhouse Charges', toNumber(sheet.clubhouseCharges) ?? 0],
            ['Legal Charges', toNumber(sheet.legalCharges) ?? 0],
            ['DLD Transfer Fee', toNumber(sheet.dldTransferFee) ?? 0],
            ['VAT', toNumber(sheet.vatAmount) ?? 0],
            ['Registration Charges', toNumber(sheet.registrationCharges) ?? 0],
        ]

        for (const [label, value] of rows) {
            doc.text(label, col1X, y)
            doc.text(`AED  ${value.toFixed(2)}`, col2X, y, { align: 'right' })
            y += 5
        }

        // Separator
        doc.setDrawColor(180, 180, 180)
        doc.line(col1X, y, pageWidth - marginX, y)
        y += 4

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text('Total', col1X, y)
        doc.text(`AED  ${(toNumber(sheet.total) ?? 0).toFixed(2)}`, col2X, y, { align: 'right' })
        y += 5

        const discountVal = toNumber(sheet.discount) ?? 0
        if (discountVal > 0) {
            doc.setFont('helvetica', 'normal')
            doc.text('Discount', col1X, y)
            doc.text(`- AED  ${discountVal.toFixed(2)}`, col2X, y, { align: 'right' })
            y += 5
        }

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text('Net Payable', col1X, y)
        doc.text(`AED  ${(toNumber(sheet.netPayable) ?? 0).toFixed(2)}`, col2X, y, { align: 'right' })
        y += 8

        // Bank details (for payment)
        if (bankName || bankAccountNumber) {
            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.text('Bank Details', marginX, y)
            y += 5
            doc.setFont('helvetica', 'normal')
            if (bankName) { doc.text(`Bank: ${bankName}`, marginX, y); y += 4 }
            if (bankAccountName) { doc.text(`Account Name: ${bankAccountName}`, marginX, y); y += 4 }
            if (bankAccountNumber) { doc.text(`Account No: ${bankAccountNumber}`, marginX, y); y += 4 }
            if (bankIban) { doc.text(`IBAN: ${bankIban}`, marginX, y); y += 4 }
            y += 4
        }

        // Footer
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(120, 120, 120)
        doc.text(
            `Generated on ${new Date().toLocaleString('en-AE')} — ${storeName}`,
            marginX,
            y
        )
        doc.setTextColor(0, 0, 0)

        // ── Upload the PDF. ──
        const pdfBuffer = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
        const fileName = `cost-sheet-${sheet.id}-${Date.now()}.pdf`
        const pdfUrl = await uploadFile(pdfBuffer, fileName, 'application/pdf', 'cost-sheets')

        // ── Persist the URL back to the record. ──
        await prisma.costSheet.update({
            where: { id: sheet.id },
            data: { pdfUrl },
        })

        revalidatePath(PROPERTIES_PATH)
        return { success: true, data: { pdfUrl } }
    } catch (err) {
        // Req 3.9: preserve existing pdfUrl on failure and return an error.
        return {
            success: false,
            error: errorMessage(err, 'Failed to generate cost-sheet PDF'),
        }
    }
}

// ---------------------------------------------------------------------------
// Req 3.10 — shareCostSheet
// ---------------------------------------------------------------------------

/** Observable per-channel delivery status returned by {@link shareCostSheet}. */
export type ShareDeliveryStatus = 'Sent' | 'Failed' | 'Skipped'

/** Per-channel delivery result returned by {@link shareCostSheet}. */
export interface ShareResult {
    whatsapp: ShareDeliveryStatus
    email: ShareDeliveryStatus
}

/** The sharing channel(s) requested by the caller. */
const shareCostSheetSchema = z.object({
    channel: z.enum(['WhatsApp', 'Email', 'Both']).default('Both'),
})

/**
 * Share a {@link CostSheet} PDF with the buyer over WhatsApp, Email, or both
 * (Req 3.10).
 *
 * Each channel records an observable delivery status:
 * - `'Sent'`    — the message was dispatched successfully.
 * - `'Failed'`  — dispatch was attempted but failed (or configuration is
 *                  missing).
 * - `'Skipped'` — the channel was not requested, or the buyer lacks the
 *                  required contact information (phone for WhatsApp, email
 *                  for Email).
 *
 * If the cost sheet has no `pdfUrl` yet this action automatically calls
 * {@link generateCostSheetPdf} first so the buyer always receives a real
 * link.  The action never throws; all failures are captured in the returned
 * {@link ShareResult}.
 *
 * @param costSheetId  The cost sheet to share.
 * @param options      `{ channel: 'WhatsApp' | 'Email' | 'Both' }` — which
 *                     channel(s) to use (defaults to `'Both'`).
 * @returns `{ success: true, data: ShareResult }` with per-channel statuses.
 */
export async function shareCostSheet(
    costSheetId: unknown,
    options?: unknown
): Promise<Result<ShareResult>> {
    const parsedId = idSchema.safeParse(costSheetId)
    if (!parsedId.success) {
        return { success: false, error: `costSheetId: ${firstIssue(parsedId.error)}` }
    }

    const parsedOptions = shareCostSheetSchema.safeParse(options ?? {})
    if (!parsedOptions.success) {
        return { success: false, error: firstIssue(parsedOptions.error) }
    }

    const { channel } = parsedOptions.data
    const sendWa = channel === 'WhatsApp' || channel === 'Both'
    const sendEml = channel === 'Email' || channel === 'Both'

    const result: ShareResult = {
        whatsapp: 'Skipped',
        email: 'Skipped',
    }

    try {
        // ── Fetch cost sheet with contact details. ──
        const sheet = await prisma.costSheet.findUnique({
            where: { id: parsedId.data },
            include: {
                contact: true,
                unit: { include: { tower: { include: { project: true } } } },
            },
        })
        if (!sheet) return { success: false, error: 'Cost sheet not found' }

        // ── Ensure a PDF URL exists; generate one if not (Req 3.9). ──
        let pdfUrl = sheet.pdfUrl
        if (!pdfUrl) {
            const genResult = await generateCostSheetPdf(parsedId.data)
            if (!genResult.success) {
                return { success: false, error: `PDF generation failed: ${genResult.error}` }
            }
            pdfUrl = genResult.data.pdfUrl
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
        const absolutePdfUrl = pdfUrl.startsWith('http') ? pdfUrl : `${appUrl}${pdfUrl}`

        const project = sheet.unit.tower.project
        const contact = sheet.contact
        const netPayable = (toNumber(sheet.netPayable) ?? 0).toFixed(2)

        // ── WhatsApp dispatch. ──
        if (sendWa) {
            const phone = contact.phone
            if (!phone) {
                result.whatsapp = 'Skipped'
            } else {
                const normalizedPhone = normalizePhoneForMetaUae(phone)
                if (!isValidE164(normalizedPhone)) {
                    result.whatsapp = 'Skipped'
                } else {
                    try {
                        const config = await prisma.waWhatsappConfig.findFirst()
                        if (!config) {
                            result.whatsapp = 'Failed'
                        } else {
                            const accessToken = decrypt(config.access_token)
                            const messageText =
                                `Hi ${contact.name},\n\n` +
                                `Your cost sheet for *${project.name}* — Unit ${sheet.unit.unitNumber} is ready.\n\n` +
                                `Net Payable: AED ${netPayable}\n\n` +
                                `Download your cost sheet: ${absolutePdfUrl}\n\n` +
                                `For queries, feel free to reach us.`
                            await sendTextMessage({
                                phoneNumberId: config.phone_number_id,
                                accessToken,
                                to: normalizedPhone,
                                text: messageText,
                            })
                            result.whatsapp = 'Sent'
                        }
                    } catch {
                        result.whatsapp = 'Failed'
                    }
                }
            }
        }

        // ── Email dispatch. ──
        if (sendEml) {
            const email = contact.email
            if (!email) {
                result.email = 'Skipped'
            } else {
                try {
                    const emailResult = await sendEmail({
                        to: email,
                        subject: `Your Cost Sheet — ${project.name} (Unit ${sheet.unit.unitNumber})`,
                        html: `
                            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                                <h2 style="color:#1a1a1a;">Your Cost Sheet is Ready</h2>
                                <p>Dear ${contact.name},</p>
                                <p>
                                    Please find the cost sheet for your selected unit:
                                </p>
                                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                                    <tr>
                                        <td style="padding:6px 0;color:#555;">Project</td>
                                        <td style="padding:6px 0;font-weight:600;">${project.name}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:6px 0;color:#555;">Unit</td>
                                        <td style="padding:6px 0;font-weight:600;">${sheet.unit.unitNumber}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:6px 0;color:#555;">Net Payable</td>
                                        <td style="padding:6px 0;font-weight:600;color:#16a34a;">AED ${netPayable}</td>
                                    </tr>
                                </table>
                                <a
                                    href="${absolutePdfUrl}"
                                    style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:8px 0;"
                                >
                                    Download Cost Sheet
                                </a>
                                <p style="color:#888;font-size:13px;margin-top:24px;">
                                    If you have any questions, please reply to this email or call us.
                                </p>
                            </div>
                        `,
                    })
                    result.email = emailResult.success ? 'Sent' : 'Failed'
                } catch {
                    result.email = 'Failed'
                }
            }
        }

        return { success: true, data: result }
    } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to share cost sheet') }
    }
}


// ═══════════════════════════════════════════════════════════
// AI-GENERATED PROPERTY DESCRIPTIONS (Unique edge #22)
//
// One-click brochure/listing copy generation per unit. Uses the same
// Groq (Llama) client the WhatsApp/social AI agent uses (lib/ai-agent/groq),
// and degrades gracefully to a deterministic, template-built description when
// no GROQ_API_KEY is configured or the model call fails — so the feature is
// always usable, never blocking.
// ═══════════════════════════════════════════════════════════

const UNIT_TYPE_LABELS: Record<string, string> = {
    Studio: 'studio apartment',
    Apartment1: '1-bedroom apartment',
    Apartment2: '2-bedroom apartment',
    Apartment3: '3-bedroom apartment',
    Apartment4Plus: '4+ bedroom apartment',
    Penthouse: 'penthouse',
    Villa: 'villa',
    Townhouse: 'townhouse',
    Duplex: 'duplex',
    Retail: 'retail unit',
    Office: 'office space',
    Warehouse: 'warehouse',
    LandPlot: 'land plot',
}

const FACING_LABELS: Record<string, string> = {
    N: 'North', S: 'South', E: 'East', W: 'West',
    NE: 'North-East', NW: 'North-West', SE: 'South-East', SW: 'South-West',
}

/** Compact AED formatting for listing copy. */
function formatDubaiPrice(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return 'Price on request'
    return amount >= 1_000 ? formatCompactCurrency(amount) : formatCurrency(amount)
}

/** Deterministic fallback copy built purely from the unit's facts. */
function templateUnitDescription(facts: {
    typeLabel: string
    projectName: string
    location: string
    city: string | null
    floorNumber: number
    builtUpArea: number
    netArea: number
    facingLabel: string
    priceLabel: string
    amenities: string[]
}): string {
    const where = [facts.location, facts.city].filter(Boolean).join(', ')
    const amenityLine =
        facts.amenities.length > 0
            ? ` Residents enjoy ${facts.amenities.slice(0, 6).join(', ')}.`
            : ''
    return (
        `Presenting a ${facts.facingLabel}-facing ${facts.typeLabel} at ${facts.projectName}` +
        `${where ? `, ${where}` : ''}. Set on floor ${facts.floorNumber}, this home offers ` +
        `${facts.builtUpArea} sq.ft. of built-up area (${facts.netArea} sq.ft. net area), ` +
        `thoughtfully planned for natural light and ventilation.${amenityLine} ` +
        `Priced at ${facts.priceLabel}. Contact us today to schedule a site visit.`
    ).replace(/\s+/g, ' ').trim()
}

/**
 * Generate marketing/listing copy for a single unit (Unique edge #22).
 *
 * Loads the unit with its parent tower/project context, asks the Groq Llama
 * model for a polished 2–4 sentence description, and returns the text. If the
 * model is unavailable (no API key / network / quota), it falls back to a
 * deterministic template so the caller always receives usable copy.
 *
 * Returns `{ description, source }` where `source` is `'ai'` or `'template'`.
 */
export async function generateUnitDescription(
    unitId: unknown,
): Promise<Result<{ description: string; source: 'ai' | 'template' }>> {
    const parsed = idSchema.safeParse(unitId)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const unit = await prisma.unit.findUnique({
        where: { id: parsed.data },
        include: { tower: { include: { project: true } } },
    })
    if (!unit) return { success: false, error: 'Unit not found' }

    const project = unit.tower?.project ?? null
    const facts = {
        typeLabel: UNIT_TYPE_LABELS[unit.type] ?? 'property',
        projectName: project?.name ?? 'our project',
        location: project?.location ?? '',
        city: project?.city ?? null,
        floorNumber: unit.floorNumber,
        builtUpArea: unit.builtUpArea,
        netArea: unit.netArea,
        facingLabel: FACING_LABELS[unit.facing] ?? unit.facing,
        priceLabel: formatDubaiPrice(Number(unit.totalPrice)),
        amenities: project?.amenities ?? [],
    }

    const fallback = templateUnitDescription(facts)

    // Build a tight, fact-grounded prompt so the model embellishes only the
    // tone, never the facts (no invented amenities, prices, or locations).
    const prompt =
        `Write an appealing but factual real-estate listing description (2 to 4 sentences, ` +
        `no markdown, no bullet points, no emojis) for the following unit. ` +
        `Use ONLY these facts and do not invent any detail:\n` +
        `- Type: ${facts.typeLabel}\n` +
        `- Project: ${facts.projectName}\n` +
        `- Location: ${[facts.location, facts.city].filter(Boolean).join(', ') || 'not specified'}\n` +
        `- Floor: ${facts.floorNumber}\n` +
        `- Built-up area (BUA): ${facts.builtUpArea} sq.ft.\n` +
        `- Net / suite area: ${facts.netArea} sq.ft.\n` +
        `- Facing: ${facts.facingLabel}\n` +
        `- Price: ${facts.priceLabel}\n` +
        `- Amenities: ${facts.amenities.length ? facts.amenities.join(', ') : 'none listed'}\n` +
        `End with a brief call to action to book a site visit.`

    try {
        const raw = await groqChat({
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 220,
            temperature: 0.6,
        })
        const description = raw.trim()
        if (!description) return { success: true, data: { description: fallback, source: 'template' } }
        return { success: true, data: { description, source: 'ai' } }
    } catch (err) {
        console.warn(
            '[properties] AI description generation fell back to template:',
            err instanceof Error ? err.message : err,
        )
        return { success: true, data: { description: fallback, source: 'template' } }
    }
}

// ===========================================================================
// Feature B — Automated Property Alerts (new inventory → matching buyers)
// ===========================================================================

/**
 * Notify waitlisted buyers when a new unit is created in a matching project.
 *
 * Steps:
 *  1. Load the new unit with its type, location (tower → project) and price.
 *  2. Query UnitWaitlist for entries where projectId matches the unit's tower's
 *     projectId and status = 'Waiting'.
 *  3. For each matching entry load the contact's phone.
 *  4. Create an in-app Notification (type: 'property_available') for the contact.
 *  5. Return { notified: number }.
 *
 * This function is fire-and-forget from createUnit — errors are logged but
 * never bubble up to the caller.
 */
export async function notifyWaitlistOnNewUnit(
    unitId: number
): Promise<{ notified: number }> {
    // 1. Load the new unit with project context
    const unit = await prisma.unit.findUnique({
        where: { id: unitId },
        select: {
            id: true,
            unitNumber: true,
            type: true,
            totalPrice: true,
            tower: {
                select: {
                    projectId: true,
                    project: { select: { name: true, location: true } },
                },
            },
        },
    })

    if (!unit) return { notified: 0 }

    const projectId = unit.tower.projectId

    // 2. Find waitlist entries for this project that are still waiting
    const waitlistEntries = await prisma.unitWaitlist.findMany({
        where: {
            projectId,
            status: 'Waiting',
        },
        select: {
            id: true,
            contactId: true,
            contact: { select: { id: true, phone: true } },
        },
    })

    if (waitlistEntries.length === 0) return { notified: 0 }

    // 3 & 4. For each entry create an in-app notification
    const notifications = waitlistEntries.map((entry) => ({
        type: 'property_available',
        title: 'New unit available',
        subtitle: `Unit ${unit.unitNumber} matching your preference is now available`,
        href: `/properties?unit=${unit.id}`,
        metadata: {
            unitId: unit.id,
            unitNumber: unit.unitNumber,
            unitType: unit.type,
            projectId,
            projectName: unit.tower.project.name,
            contactId: entry.contact.id,
            contactPhone: entry.contact.phone,
        },
    }))

    await prisma.notification.createMany({ data: notifications })

    return { notified: notifications.length }
}
