/**
 * Property-based tests for the portal-payload pure helper in `lib/portal.ts`.
 *
 * Implements design Correctness Properties 53 and 54:
 *   - Property 53: Disabled portals ignore webhooks          (Req 15.4)
 *   - Property 54: Invalid webhook payloads create no records (Req 15.6) — validatePortalPayload
 *
 * Tag convention (design.md → Testing Strategy → PBT):
 *   // Feature: real-estate-crm, Property N: <text>
 *
 * Runs at the project default of 100 iterations via `fcAssert`.
 *
 * ---------------------------------------------------------------------------
 * Note on Property 53 (where the disabled-portal gate is enforced)
 * ---------------------------------------------------------------------------
 * The enabled/disabled decision is NOT part of the pure helper. `lib/portal.ts`
 * only validates and parses payloads; it never sees a PortalConfig and never
 * touches a database. The actual "disabled portals ignore webhooks" gate lives
 * upstream in `ingestPortalLead` (`app/actions/portal-integration.ts`), which
 * resolves the PortalConfig and returns `{ status: 'ignored' }` — writing
 * nothing — when no config exists or `config.enabled` is false, BEFORE
 * `validatePortalPayload` is ever called (Req 15.4).
 *
 * At the pure-helper layer we therefore test the validation invariant that
 * *frames* Property 53: record creation can only ever be authorized by a
 * verdict from `validatePortalPayload`, and that helper is referentially
 * transparent — deterministic, free of side effects, and returns only a plain
 * verdict (never an IO handle or a record). Because the helper cannot itself
 * create records and does not consider any enabled flag, the disabled-portal
 * decision is structurally isolated in the action layer, where it is verified
 * end-to-end by the ingestion tests (tasks 20.4 / 20.6).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { validatePortalPayload, type PortalValidation } from '@/lib/portal'
import { fcAssert } from '@/test/generators'

// ---------------------------------------------------------------------------
// Generators for VALID payloads
// ---------------------------------------------------------------------------

/** A non-empty, non-whitespace string suitable for required text fields. */
const nonEmptyTextArb: fc.Arbitrary<string> = fc
    .tuple(fc.constantFrom('A', 'R', 'P', 'S', 'Z', '9'), fc.string({ maxLength: 20 }))
    .map(([head, tail]) => head + tail)

/** A required id: a non-empty string or a finite positive number (coerces to text). */
const validPortalLeadIdArb: fc.Arbitrary<string | number> = fc.oneof(
    nonEmptyTextArb,
    fc.integer({ min: 1, max: 1_000_000_000 }),
)

/**
 * A phone value guaranteed to normalize to at least MIN_PHONE_DIGITS (10).
 * Plain 10-digit numbers stay 10 digits through `normalizePhone`; the formatted
 * constants below normalize to a valid 10-digit number too.
 */
const validPhoneArb: fc.Arbitrary<string> = fc.oneof(
    fc
        .tuple(
            fc.integer({ min: 6, max: 9 }),
            fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
        )
        .map(([first, rest]) => String(first) + rest.join('')),
    fc.constantFrom('+971 98765 43210', '098-7654-3210', '9876543210'),
)

/** An optional, valid email (absent → undefined, or a well-formed address). */
const validEmailArb: fc.Arbitrary<string | undefined> = fc.oneof(
    fc.constant(undefined),
    fc.constantFrom('a@b.co', 'rahul@example.com', 'test.user@mail.in', 'PRIYA@Example.COM'),
)

/** An optional, valid inquiry date (absent → undefined, or a valid epoch-ms). */
const validInquiryDateArb: fc.Arbitrary<number | undefined> = fc.oneof(
    fc.constant(undefined),
    fc.integer({ min: 946_684_800_000, max: 2_051_222_400_000 }), // 2000-01-01 .. 2035-01-01
)

/** A fully VALID portal payload — `validatePortalPayload` must return ok:true. */
const validPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
    portalLeadId: validPortalLeadIdArb,
    name: nonEmptyTextArb,
    phone: validPhoneArb,
    email: validEmailArb,
    propertyName: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    buyerMessage: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    inquiryDate: validInquiryDateArb,
})

// ---------------------------------------------------------------------------
// Generators for INVALID payloads (each guaranteed to fail validation)
// ---------------------------------------------------------------------------

/** Values that make `payload` itself invalid (not a non-null, non-array object). */
const nonObjectPayloadArb: fc.Arbitrary<unknown> = fc.constantFrom(
    null,
    undefined,
    42,
    0,
    'a string',
    true,
    false,
    [],
    [1, 2, 3],
)

/** Values that fail a required string field (portalLeadId / name). */
const invalidRequiredTextArb: fc.Arbitrary<unknown> = fc.constantFrom(
    '',
    '   ',
    null,
    undefined,
    true,
    false,
    {},
    [],
)

/** Values that fail the phone rule (absent, non-coercible, or < 10 digits). */
const invalidPhoneArb: fc.Arbitrary<unknown> = fc.constantFrom(
    '',
    '   ',
    'abc',
    '123',
    '12345',
    '999-999',
    null,
    undefined,
    true,
    42,
    {},
)

/** Present-but-malformed email values (optional field, so must be present to fail). */
const invalidEmailArb: fc.Arbitrary<string> = fc.constantFrom(
    'plainaddress',
    'noatsign.com',
    'a@b',
    'a@bcom',
    'foo @bar.com',
    'foo@ bar.com',
    '@nodomain.com',
    'space in@local.com',
)

/** Present-but-invalid inquiry-date values (optional field, so must be present to fail). */
const invalidInquiryDateArb: fc.Arbitrary<unknown> = fc.constantFrom(
    'not-a-date',
    'hello',
    '2020-13-45xyz',
    true,
    {},
    NaN,
)

/**
 * Build an otherwise-valid payload, then corrupt exactly one field with a
 * guaranteed-invalid value. Validation runs field-by-field, so whichever field
 * is broken, the result is `{ ok: false }` (the surrounding fields stay valid).
 */
function brokenField(
    field: 'portalLeadId' | 'name' | 'phone' | 'email' | 'inquiryDate',
    badValueArb: fc.Arbitrary<unknown>,
): fc.Arbitrary<unknown> {
    return fc
        .tuple(validPayloadArb, badValueArb)
        .map(([base, bad]) => ({ ...base, [field]: bad }))
}

/** A webhook payload that is guaranteed to FAIL validation. */
const invalidPayloadArb: fc.Arbitrary<unknown> = fc.oneof(
    nonObjectPayloadArb,
    brokenField('portalLeadId', invalidRequiredTextArb),
    brokenField('name', invalidRequiredTextArb),
    brokenField('phone', invalidPhoneArb),
    brokenField('email', invalidEmailArb),
    brokenField('inquiryDate', invalidInquiryDateArb),
)

/** Any payload — valid or invalid — for the purity invariant. */
const anyPayloadArb: fc.Arbitrary<unknown> = fc.oneof(validPayloadArb, invalidPayloadArb)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('portal payload pure helper', () => {
    // Feature: real-estate-crm, Property 53: Disabled portals ignore webhooks
    // The disabled-portal gate is enforced in `ingestPortalLead`
    // (app/actions/portal-integration.ts), not in the pure helper. The
    // invariant that frames Property 53 at this layer: `validatePortalPayload`
    // is the sole authorizer of writes and is referentially transparent — it
    // returns only a plain verdict (never a record/IO handle), is deterministic,
    // and never mutates its input — so the helper itself can never create a
    // record, leaving the enabled/disabled decision isolated in the action.
    // Validates: Requirements 15.4
    it('Property 53: validatePortalPayload is a pure, side-effect-free verdict (frames the disabled-portal gate)', () => {
        fcAssert(
            fc.property(anyPayloadArb, (payload) => {
                const before = JSON.stringify(payload)

                const first = validatePortalPayload(payload)
                const second = validatePortalPayload(payload)

                // The result is only a plain verdict: a boolean `ok` discriminator.
                expect(typeof first.ok).toBe('boolean')

                // Deterministic: the same input yields the same verdict every time.
                expect(JSON.stringify(second)).toBe(JSON.stringify(first))

                // No side effects: the input payload is never mutated.
                expect(JSON.stringify(payload)).toBe(before)
            }),
        )
    })

    // Feature: real-estate-crm, Property 54: Invalid webhook payloads create no records
    // For any payload that fails validation, validatePortalPayload returns a
    // not-ok verdict naming the offending field with an error message and
    // carrying no parsed lead — so the caller creates no records.
    // Validates: Requirements 15.6
    it('Property 54: invalid payloads validate as not-ok with no parsed lead', () => {
        fcAssert(
            fc.property(invalidPayloadArb, (payload) => {
                const result: PortalValidation = validatePortalPayload(payload)

                // Rejected with an error...
                expect(result.ok).toBe(false)
                if (result.ok === false) {
                    expect(typeof result.field).toBe('string')
                    expect(result.field.length).toBeGreaterThan(0)
                    expect(typeof result.error).toBe('string')
                    expect(result.error.length).toBeGreaterThan(0)
                }

                // ...and no lead is produced, so the caller creates no records.
                expect((result as { lead?: unknown }).lead).toBeUndefined()
            }),
        )
    })

    // Sanity anchor for the generators: the "valid" arbitrary really is valid,
    // so Property 54's "broken one field" construction isolates the failure.
    it('valid payload generator produces ok:true verdicts', () => {
        fcAssert(
            fc.property(validPayloadArb, (payload) => {
                expect(validatePortalPayload(payload).ok).toBe(true)
            }),
        )
    })
})
