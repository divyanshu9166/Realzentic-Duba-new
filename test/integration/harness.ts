/**
 * Integration-test harness for the Real Estate CRM.
 *
 * These helpers back the DB-backed integration / persistence tests that run the
 * real server actions against the isolated local Postgres
 * `realzentic_dubai_test` database.
 *
 * Isolation strategy: every fixture is created with a unique, test-only marker
 * and registered with a {@link Cleanup} tracker that deletes the created rows
 * (in reverse-dependency order) after each test, so a test run never leaves
 * residue and never touches pre-existing data.
 *
 * NOTE ON MOCKS: each integration test file must add, at the top of the file:
 *
 *   vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
 *   vi.mock('@/lib/auth-helpers', async () => {
 *     const s = await import('./_session')
 *     return {
 *       getSession: async () => s.getTestSession(),
 *       requireAuth: async () => {
 *         const sess = s.getTestSession()
 *         if (!sess) throw new Error('Unauthorized')
 *         return sess
 *       },
 *       requireRole: async (...roles: string[]) => {
 *         const sess = s.getTestSession()
 *         if (!sess) throw new Error('Unauthorized')
 *         if (!roles.includes(sess.user.role)) throw new Error('Forbidden')
 *         return sess
 *       },
 *     }
 *   })
 *
 * (vi.mock is hoisted, so it must be literally in the test file — it cannot be
 * abstracted into this module.)
 */
import { prisma } from '@/lib/db'

/** A unique-ish token so test rows are easy to identify and never collide. */
export function uid(prefix = 'IT'): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * LIFO cleanup registry. Register a delete thunk right after creating a row;
 * call {@link Cleanup.run} in `afterEach` to undo everything in reverse order.
 * Each thunk is wrapped so one failure does not abort the rest.
 */
export class Cleanup {
    private thunks: Array<() => Promise<unknown>> = []

    add(thunk: () => Promise<unknown>): void {
        this.thunks.push(thunk)
    }

    async run(): Promise<void> {
        // Reverse order so children are removed before parents.
        for (const thunk of this.thunks.reverse()) {
            try {
                await thunk()
            } catch {
                // Best-effort cleanup; ignore rows already removed by a cascade.
            }
        }
        this.thunks = []
    }
}

// ─── Fixture factories ───────────────────────────────────────────────────────

/** Create a Staff row (used as the acting principal / agent in audits). */
export async function makeStaff(cleanup: Cleanup, overrides: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
        data: {
            name: `Test Agent ${uid()}`,
            role: 'Sales Executive',
            phone: `+9715${Math.floor(1000000 + Math.random() * 8999999)}`,
            email: `${uid('agent').toLowerCase()}@test.local`,
            status: 'Active',
            joinDate: new Date(),
            ...overrides,
        },
    })
    cleanup.add(() => prisma.staff.delete({ where: { id: staff.id } }))
    return staff
}

/** Create a Contact row. */
export async function makeContact(cleanup: Cleanup, overrides: Record<string, unknown> = {}) {
    const contact = await prisma.contact.create({
        data: {
            name: `Test Buyer ${uid()}`,
            phone: `+9715${Math.floor(1000000 + Math.random() * 8999999)}`,
            email: `${uid('buyer').toLowerCase()}@test.local`,
            ...overrides,
        },
    })
    cleanup.add(() => prisma.contact.delete({ where: { id: contact.id } }))
    return contact
}

/** Create a Project → Tower → (optional) Unit fixture graph. */
export async function makeProject(cleanup: Cleanup, overrides: Record<string, unknown> = {}) {
    const project = await prisma.project.create({
        data: {
            name: `Test Project ${uid()}`,
            location: 'Test Location',
            city: 'Dubai',
            emirate: 'Dubai',
            type: 'Residential',
            status: 'UnderConstruction',
            ...overrides,
        },
    })
    cleanup.add(() => prisma.project.delete({ where: { id: project.id } }))
    return project
}

export async function makeTower(
    cleanup: Cleanup,
    projectId: number,
    overrides: Record<string, unknown> = {},
) {
    const tower = await prisma.tower.create({
        data: {
            projectId,
            name: `Tower ${uid()}`,
            totalFloors: 10,
            status: 'Active',
            ...overrides,
        },
    })
    cleanup.add(() => prisma.tower.delete({ where: { id: tower.id } }))
    return tower
}

export async function makeUnit(
    cleanup: Cleanup,
    towerId: number,
    overrides: Record<string, unknown> = {},
) {
    const unit = await prisma.unit.create({
        data: {
            towerId,
            floorNumber: 1,
            unitNumber: uid('U'),
            type: 'Apartment2',
            netArea: 800,
            builtUpArea: 1000,
            facing: 'N',
            status: 'Available',
            basePricePerSqft: 5000,
            floorRisePremium: 0,
            viewPremium: 0,
            totalPrice: 5000000,
            ...overrides,
        },
    })
    cleanup.add(() => prisma.unit.delete({ where: { id: unit.id } }))
    return unit
}

/** Create a DealStage. */
export async function makeStage(
    cleanup: Cleanup,
    overrides: Record<string, unknown> = {},
) {
    const stage = await prisma.dealStage.create({
        data: {
            name: `Stage ${uid()}`,
            order: Math.floor(1000 + Math.random() * 8999),
            color: '#3366ff',
            isWon: false,
            isLost: false,
            ...overrides,
        },
    })
    cleanup.add(() => prisma.dealStage.delete({ where: { id: stage.id } }))
    return stage
}

/** Disconnect Prisma so the pg pool does not keep the vitest process alive. */
export async function disconnect(): Promise<void> {
    await prisma.$disconnect().catch(() => undefined)
}

export { prisma }
