/**
 * Property-based tests for the duplicate-lead detection pure helpers in
 * `lib/dedup.ts`.
 *
 * Implements design Correctness Properties 40, 41, 43:
 *   - Property 40: Duplicate detection criteria        (Req 11.1) — isDuplicate
 *   - Property 41: Duplicate confidence is bounded      (Req 11.2) — duplicateConfidence
 *   - Property 43: Dedup report groups are valid        (Req 11.6) — dedupGroups
 *
 * Tag convention (design.md → Testing Strategy → PBT):
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * Runs at the project default of 100 iterations via `fcAssert`.
 *
 * Note on empty values (per the dedup.ts "NOTE ON EMPTY VALUES" contract and
 * design "Key Decisions"): a phone/email/name clause only contributes a match
 * when the compared values are actually present. The expected-value
 * computations below mirror that documented contract so the iff in Property 40
 * is exercised against the real criteria.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
    isDuplicate,
    duplicateConfidence,
    dedupGroups,
    levenshtein,
    normalizePhone,
    NAME_DISTANCE_THRESHOLD,
    type DedupRecord,
} from '@/lib/dedup'
import { fcAssert } from '@/test/generators'

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A phone value drawn mostly from a small pool so that distinct records
 * frequently collide (after normalization) — exercising the phone-match
 * branch — while still admitting free-form and empty values.
 *
 * The first three pool entries all normalize to the same UAE mobile number, so
 * formatting/country-code variants are covered.
 */
const phoneArb: fc.Arbitrary<string> = fc.oneof(
    fc.constantFrom(
        '501234567',
        '+971 50 123 4567',
        '050-123-4567',
        '509999999',
        '508888888',
        '507777777',
        '',
    ),
    fc.string({ maxLength: 14 }),
)

/**
 * An email value biased toward a small pool (with case/whitespace variants of
 * the same address) to exercise the email-match branch, plus free-form values,
 * `null`, and `undefined`.
 */
const emailArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
    fc.constantFrom(
        'rahul@example.com',
        'RAHUL@example.com',
        '  rahul@example.com  ',
        'priya@example.com',
        'amit@test.in',
        '',
    ),
    fc.string({ maxLength: 20 }),
    fc.constant(null),
    fc.constant(undefined),
)

/**
 * A name value biased toward a small pool that includes near-duplicates
 * (Levenshtein distance < 3) so the fuzzy-name branch and the distance
 * threshold boundary are exercised, plus free-form and blank values.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
    fc.constantFrom(
        'Rahul Sharma',
        'Rahul Sharmaa', // distance 1 from "Rahul Sharma"
        'Rahul Sharm', // distance 1
        'Priya Patel',
        'Priya Patell', // distance 1
        'Amit',
        'Amitt', // distance 1
        '',
        '   ',
    ),
    fc.string({ maxLength: 16 }),
)

/** A single dedup record. */
const recordArb: fc.Arbitrary<DedupRecord> = fc.record({
    name: nameArb,
    phone: phoneArb,
    email: emailArb,
})

/** A pair of dedup records. */
const recordPairArb: fc.Arbitrary<[DedupRecord, DedupRecord]> = fc.tuple(
    recordArb,
    recordArb,
)

/**
 * A list of dedup records, each tagged with a unique numeric `id` so groups
 * can be checked for disjointness and subset membership.
 */
const recordListArb: fc.Arbitrary<DedupRecord[]> = fc
    .array(recordArb, { minLength: 0, maxLength: 8 })
    .map((records) => records.map((r, i) => ({ ...r, id: i })))

// ---------------------------------------------------------------------------
// Expected-value helpers (mirror the documented dedup.ts criteria)
// ---------------------------------------------------------------------------

function expectedPhoneMatch(a: DedupRecord, b: DedupRecord): boolean {
    const pa = normalizePhone(a.phone)
    const pb = normalizePhone(b.phone)
    return pa !== '' && pa === pb
}

function expectedEmailMatch(a: DedupRecord, b: DedupRecord): boolean {
    const ea = (a.email ?? '').trim().toLowerCase()
    const eb = (b.email ?? '').trim().toLowerCase()
    return ea !== '' && ea === eb
}

function expectedNameMatch(a: DedupRecord, b: DedupRecord): boolean {
    const na = (a.name ?? '').trim()
    const nb = (b.name ?? '').trim()
    if (na === '' || nb === '') return false
    return levenshtein(na, nb) < NAME_DISTANCE_THRESHOLD
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dedup pure helpers', () => {
    // Feature: real-estate-crm, Property 40: Duplicate detection criteria
    // For any candidate and existing contact, `isDuplicate` is true if and only
    // if their normalized phone numbers are equal, OR their lowercased email
    // addresses are equal, OR the Levenshtein distance between their full names
    // is less than 3 (each clause requiring the compared values to be present,
    // per the dedup.ts contract).
    // Validates: Requirements 11.1
    it('Property 40: isDuplicate matches the phone/email/name<3 criteria (iff)', () => {
        fcAssert(
            fc.property(recordPairArb, ([a, b]) => {
                const expected =
                    expectedPhoneMatch(a, b) ||
                    expectedEmailMatch(a, b) ||
                    expectedNameMatch(a, b)
                expect(isDuplicate(a, b)).toBe(expected)
            }),
        )
    })

    // Feature: real-estate-crm, Property 41: Duplicate confidence is bounded
    // For any matched contact, the reported confidence score is an integer in
    // [0, 100]. (Tested across all pairs: the non-matching case returns 0, which
    // is also an integer in range, so the bound holds universally.)
    // Validates: Requirements 11.2
    it('Property 41: duplicateConfidence is an integer in [0, 100]', () => {
        fcAssert(
            fc.property(recordPairArb, ([a, b]) => {
                const score = duplicateConfidence(a, b)
                expect(Number.isInteger(score)).toBe(true)
                expect(score).toBeGreaterThanOrEqual(0)
                expect(score).toBeLessThanOrEqual(100)
                // A matched pair must report positive confidence.
                if (isDuplicate(a, b)) {
                    expect(score).toBeGreaterThan(0)
                }
            }),
        )
    })

    // Feature: real-estate-crm, Property 43: Dedup report groups are valid
    // For any set of contacts, every group in the deduplication report contains
    // 2 or more contacts that mutually match the duplicate criteria (each member
    // directly matches at least one other member — the connected-component
    // invariant), and the report is empty when no duplicate groups exist.
    // Validates: Requirements 11.6
    it('Property 43: dedupGroups produces valid duplicate groups', () => {
        fcAssert(
            fc.property(recordListArb, (records) => {
                const groups = dedupGroups(records)

                // Whether any duplicate pair exists across the whole input.
                let anyDuplicatePair = false
                for (let i = 0; i < records.length && !anyDuplicatePair; i++) {
                    for (let j = i + 1; j < records.length; j++) {
                        if (isDuplicate(records[i], records[j])) {
                            anyDuplicatePair = true
                            break
                        }
                    }
                }

                // Empty iff there are no duplicate pairs.
                expect(groups.length > 0).toBe(anyDuplicatePair)

                const seenIds = new Set<number | string>()
                for (const group of groups) {
                    // Every group has 2 or more members.
                    expect(group.length).toBeGreaterThanOrEqual(2)

                    for (const member of group) {
                        const id = member.id as number
                        // Members are drawn from the input...
                        expect(records).toContain(member)
                        // ...and groups are disjoint (no member appears twice).
                        expect(seenIds.has(id)).toBe(false)
                        seenIds.add(id)

                        // Connectivity: each member directly matches at least one
                        // other member of the same group.
                        const matchesAnother = group.some(
                            (other) =>
                                other.id !== member.id && isDuplicate(member, other),
                        )
                        expect(matchesAnother).toBe(true)
                    }
                }
            }),
        )
    })
})
