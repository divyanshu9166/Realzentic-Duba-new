/**
 * Integration tests for the Inventory service (`app/actions/properties.ts`),
 * run against the real Postgres database.
 *
 * Covers the DB-backed tasks that the pure-helper property tests cannot:
 *   - 3.4  Property 4:  bulk unit creation is all-or-nothing (Req 1.9)
 *   - 3.5  Property 5:  record validation rejects invalid input by field (Req 1.10, 20.4)
 *   - 3.6  Property 7:  block/book requires Available (Req 2.3)
 *   - 3.7  Property 8:  timed hold expiry bounds (Req 2.5)
 *   - 3.8  Property 9:  expired holds revert to Available (Req 2.6)
 *   - 3.9  Property 10: price revision records history (Req 2.7)
 *   - 3.10 Integration: concurrent block serialization (Req 2.4, 20.5)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => { }, revalidateTag: () => { } }))
vi.mock('@/lib/auth-helpers', async () => {
    const s = await import('./_session')
    return {
        getSession: async () => s.getTestSession(),
        requireAuth: async () => {
            const sess = s.getTestSession()
            if (!sess) throw new Error('Unauthorized')
            return sess
        },
        requireRole: async (...roles: string[]) => {
            const sess = s.getTestSession()
            if (!sess) throw new Error('Unauthorized')
            if (!roles.includes(sess.user.role)) throw new Error('Forbidden')
            return sess
        },
    }
})

import {
    blockUnit,
    bulkCreateUnits,
    changeUnitStatus,
    createProject,
    createUnit,
    revisePrice,
    saveProjectLocation,
    sweepExpiredHolds,
    updateUnit,
} from '@/app/actions/properties'
import {
    Cleanup,
    disconnect,
    makeProject,
    makeTower,
    makeUnit,
    prisma,
    uid,
} from './harness'
import { resetTestSession, setTestSession } from './_session'

let cleanup: Cleanup
beforeEach(() => {
    cleanup = new Cleanup()
    resetTestSession()
})
afterEach(async () => {
    await cleanup.run()
    resetTestSession()
})
afterAll(async () => {
    await disconnect()
})

const unitTemplate = {
    type: 'Apartment2',
    netArea: 800,
    builtUpArea: 1000,
    facing: 'N',
    basePricePerSqft: 5000,
} as const

describe('Inventory service — DB integration', () => {
    // 3.4 / Property 4: bulk unit creation is all-or-nothing (Req 1.9)
    it('bulkCreateUnits rolls back entirely when one generated unit collides', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)

        // Pre-create the unit that floor 1, slot 1 will generate ("101") so the
        // bulk insert hits a unique-constraint violation mid-batch.
        await makeUnit(cleanup, tower.id, { floorNumber: 1, unitNumber: '101' })

        const before = await prisma.unit.count({ where: { towerId: tower.id } })

        const res = await bulkCreateUnits({
            towerId: tower.id,
            floorRange: { start: 1, end: 2 },
            unitsPerFloor: 2,
            unitTemplate,
        })

        expect(res.success).toBe(false)
        const after = await prisma.unit.count({ where: { towerId: tower.id } })
        // No new units created — the whole batch rolled back (only the seed unit remains).
        expect(after).toBe(before)
    })

    it('bulkCreateUnits creates every unit when none collide', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)

        const res = await bulkCreateUnits({
            towerId: tower.id,
            floorRange: { start: 3, end: 4 },
            unitsPerFloor: 2,
            unitTemplate,
        })
        // Register cleanup for the bulk-created rows.
        cleanup.add(() => prisma.unit.deleteMany({ where: { towerId: tower.id } }))

        expect(res.success).toBe(true)
        const count = await prisma.unit.count({ where: { towerId: tower.id } })
        expect(count).toBe(4)
    })

    // 3.5 / Property 5: record validation rejects invalid input by field (Req 1.10, 20.4)
    it('createProject rejects a missing required field with a field-naming error', async () => {
        const res = await createProject({
            name: '', // required → invalid
            location: 'X',
            city: 'Dubai',
            state: 'Maharashtra',
            type: 'Residential',
            status: 'UnderConstruction',
        })
        expect(res.success).toBe(false)
        if (!res.success) expect(typeof res.error).toBe('string')
    })

    it('saves a confirmed UAE arrival point and project-specific geofence', async () => {
        const project = await makeProject(cleanup)
        const result = await saveProjectLocation({
            projectId: project.id,
            latitude: 25.0808,
            longitude: 55.1403,
            geofenceRadiusM: 175,
            locationConfirmed: true,
        })

        expect(result).toMatchObject({
            success: true,
            data: { id: project.id, latitude: 25.0808, longitude: 55.1403, geofenceRadiusM: 175 },
        })
        const saved = await prisma.project.findUnique({ where: { id: project.id } })
        expect(saved).toMatchObject({
            latitude: 25.0808,
            longitude: 55.1403,
            geofenceRadiusM: 175,
            locationConfirmedAt: expect.any(Date),
        })
    })

    it('rejects an unconfirmed or non-UAE project map pin', async () => {
        const project = await makeProject(cleanup)
        const unconfirmed = await saveProjectLocation({
            projectId: project.id,
            latitude: 25.0808,
            longitude: 55.1403,
            geofenceRadiusM: 200,
            locationConfirmed: false,
        })
        expect(unconfirmed.success).toBe(false)

        const outsideUae = await saveProjectLocation({
            projectId: project.id,
            latitude: 26.783,
            longitude: 75.863,
            geofenceRadiusM: 200,
            locationConfirmed: true,
        })
        expect(outsideUae).toEqual({ success: false, error: 'Project coordinates must be within the UAE' })
    })

    it('createUnit rejects an out-of-range value and persists nothing', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const before = await prisma.unit.count({ where: { towerId: tower.id } })

        const res = await createUnit({
            towerId: tower.id,
            floorNumber: 1,
            unitNumber: uid('U'),
            type: 'Apartment2',
            netArea: -5, // invalid
            builtUpArea: 1000,
            facing: 'N',
            basePricePerSqft: 5000,
        })
        expect(res.success).toBe(false)
        const after = await prisma.unit.count({ where: { towerId: tower.id } })
        expect(after).toBe(before)
    })

    it('updateUnit persists villa attributes without bypassing the current status', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available', totalPrice: 6500000 })

        const res = await updateUnit(unit.id, {
            type: 'Villa',
            unitNumber: unit.unitNumber,
            floorNumber: 1,
            netArea: 3200,
            builtUpArea: 4100,
            plotArea: 5200,
            bedroomCount: 4,
            bathroomCount: 5,
            facing: 'E',
            basePricePerSqft: 1550,
            floorRisePremium: 0,
            viewPremium: 0,
            totalPrice: 6500000,
            parkingType: 'Garage',
            parkingCount: 2,
            maidRoom: true,
            driverRoom: true,
            privateGarden: true,
            privatePool: false,
            furnishingStatus: 'Semi-Furnished',
        })

        expect(res.success).toBe(true)
        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(row).toMatchObject({
            type: 'Villa',
            status: 'Available',
            plotArea: 5200,
            bedroomCount: 4,
            bathroomCount: 5,
            maidRoom: true,
            driverRoom: true,
            privateGarden: true,
            furnishingStatus: 'Semi-Furnished',
        })
    })

    it('inventory mutations reject a normal staff session', async () => {
        const project = await makeProject(cleanup)
        setTestSession({
            user: {
                id: 'staff-user',
                email: 'staff@test.local',
                name: 'Staff User',
                role: 'STAFF',
                staffId: null,
            },
        })

        const res = await createUnit({
            towerId: 999999,
            floorNumber: 1,
            unitNumber: uid('STAFF'),
            type: 'Villa',
            netArea: 1000,
            builtUpArea: 1200,
            facing: 'N',
            basePricePerSqft: 1000,
        })

        expect(res).toEqual({ success: false, error: 'Access denied. ADMIN or MANAGER role required.' })
        expect(project.id).toBeGreaterThan(0)
    })

    // 3.6 / Property 7: block requires Available (Req 2.3)
    it('blockUnit succeeds on an Available unit and fails on a non-Available unit', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        const ok = await blockUnit(unit.id)
        expect(ok.success).toBe(true)
        const blocked = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(blocked?.status).toBe('Blocked')

        // A second block on the now-Blocked unit is rejected (Req 2.3).
        const second = await blockUnit(unit.id)
        expect(second.success).toBe(false)
    })

    it('changeUnitStatus rejects a disallowed transition and leaves the unit unchanged', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        // Available → Sold is not in the transition table.
        const res = await changeUnitStatus(unit.id, 'Sold')
        expect(res.success).toBe(false)
        const after = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(after?.status).toBe('Available')
    })

    // 3.7 / Property 8: timed hold expiry bounds (Req 2.5)
    it('blockUnit sets a hold expiry within [1,168]h of creation and rejects out-of-range', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        const before = Date.now()
        const res = await blockUnit(unit.id, 48)
        expect(res.success).toBe(true)
        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(row?.holdExpiresAt).toBeTruthy()
        const ms = row!.holdExpiresAt!.getTime() - before
        // ~48h ahead (allow scheduling slack).
        expect(ms).toBeGreaterThan(47 * 3600_000)
        expect(ms).toBeLessThan(49 * 3600_000)

        // Out-of-range hold duration is rejected.
        const u2 = await makeUnit(cleanup, tower.id, { status: 'Available' })
        const bad = await blockUnit(u2.id, 200)
        expect(bad.success).toBe(false)
    })

    it('changing a held unit clears all stale hold metadata', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        await blockUnit(unit.id, 24)
        const res = await changeUnitStatus(unit.id, 'Booked')
        expect(res.success).toBe(true)

        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(row).toMatchObject({
            status: 'Booked',
            holdByStaffId: null,
            holdByPartnerId: null,
            holdCreatedAt: null,
            holdExpiresAt: null,
        })
    })

    // 3.8 / Property 9: expired holds revert to Available (Req 2.6)
    it('sweepExpiredHolds reverts a Blocked unit whose hold has expired', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        await blockUnit(unit.id, 1) // 1-hour hold
        // Sweep as if 2 hours have passed.
        const res = await sweepExpiredHolds(new Date(Date.now() + 2 * 3600_000))
        expect(res.success).toBe(true)

        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(row?.status).toBe('Available')
        expect(row?.holdExpiresAt).toBeNull()
    })

    // 3.9 / Property 10: price revision records history (Req 2.7)
    it('revisePrice updates the price and writes a UnitPriceHistory row', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { totalPrice: 5000000 })
        cleanup.add(() => prisma.unitPriceHistory.deleteMany({ where: { unitId: unit.id } }))

        const res = await revisePrice(unit.id, 5500000, 'Market revision')
        expect(res.success).toBe(true)

        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(Number(row?.totalPrice)).toBe(5500000)

        const history = await prisma.unitPriceHistory.findMany({ where: { unitId: unit.id } })
        expect(history).toHaveLength(1)
        expect(Number(history[0].oldPrice)).toBe(5000000)
        expect(Number(history[0].newPrice)).toBe(5500000)
        expect(history[0].reason).toBe('Market revision')
    })

    // 3.10 Integration: concurrent block serialization (Req 2.4, 20.5)
    it('two concurrent blockUnit calls on the same unit: exactly one succeeds', async () => {
        const project = await makeProject(cleanup)
        const tower = await makeTower(cleanup, project.id)
        const unit = await makeUnit(cleanup, tower.id, { status: 'Available' })

        const [a, b] = await Promise.all([blockUnit(unit.id), blockUnit(unit.id)])
        const successes = [a, b].filter((r) => r.success).length
        expect(successes).toBe(1)

        const row = await prisma.unit.findUnique({ where: { id: unit.id } })
        expect(row?.status).toBe('Blocked')
    })
})
