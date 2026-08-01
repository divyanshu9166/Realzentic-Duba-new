/**
 * Unit tests for the EMI & Affordability pure helpers (`lib/emi.ts`, Task 14.1).
 *
 * These are example-based unit tests covering core behaviour and edge cases.
 * The numbered design Properties (38–39) are implemented separately as
 * property-based tests in Tasks 14.2 and 14.3.
 */
import { describe, expect, it } from 'vitest'
import {
    amortizationSchedule,
    computeEmi,
    estimateDldFeeAndRegistration,
    totalInterest,
    validateDownPayment,
} from './emi'

describe('validateDownPayment', () => {
    it('accepts a down payment strictly below the property value', () => {
        expect(validateDownPayment(5_000_000, 1_000_000)).toBe(true)
    })

    it('rejects a down payment equal to the property value', () => {
        expect(validateDownPayment(5_000_000, 5_000_000)).toBe(false)
    })

    it('rejects a down payment greater than the property value', () => {
        expect(validateDownPayment(5_000_000, 6_000_000)).toBe(false)
    })

    it('rejects negative or non-finite inputs', () => {
        expect(validateDownPayment(5_000_000, -1)).toBe(false)
        expect(validateDownPayment(Number.NaN, 1000)).toBe(false)
        expect(validateDownPayment(5_000_000, Number.POSITIVE_INFINITY)).toBe(false)
    })
})

describe('computeEmi', () => {
    it('matches the standard formula for a typical mortgage', () => {
        // AED 4,000,000 at 8.5% p.a. for 240 months → ≈ 34,712.93
        const emi = computeEmi(4_000_000, 8.5, 240)
        expect(emi).toBeCloseTo(34_712.93, 1)
    })

    it('uses straight-line repayment for a zero-interest loan', () => {
        expect(computeEmi(1_200_000, 0, 12)).toBe(100_000)
    })

    it('rejects an invalid tenure', () => {
        expect(() => computeEmi(1_000_000, 8, 0)).toThrow(/tenure/i)
        expect(() => computeEmi(1_000_000, 8, 12.5)).toThrow(/tenure/i)
    })

    it('rejects a negative interest rate', () => {
        expect(() => computeEmi(1_000_000, -1, 12)).toThrow(/rate/i)
    })
})

describe('amortizationSchedule', () => {
    it('produces one row per month with the principal reducing to exactly zero', () => {
        const schedule = amortizationSchedule(1_000_000, 9, 24)
        expect(schedule).toHaveLength(24)
        expect(schedule[schedule.length - 1].balance).toBe(0)
    })

    it('repays exactly the original principal across all months', () => {
        const principal = 2_500_000
        const schedule = amortizationSchedule(principal, 7.5, 60)
        const repaid = schedule.reduce((acc, row) => acc + row.principal, 0)
        expect(repaid).toBeCloseTo(principal, 2)
    })

    it('handles a zero-interest loan with no interest in any month', () => {
        const schedule = amortizationSchedule(120_000, 0, 12)
        expect(schedule.every((row) => row.interest === 0)).toBe(true)
        expect(schedule[schedule.length - 1].balance).toBe(0)
    })
})

describe('totalInterest', () => {
    it('is zero for a zero-interest loan', () => {
        expect(totalInterest(120_000, 0, 12)).toBe(0)
    })

    it('is positive for an interest-bearing loan', () => {
        expect(totalInterest(1_000_000, 9, 24)).toBeGreaterThan(0)
    })
})

describe('estimateDldFeeAndRegistration', () => {
    it('computes DLD and mortgage registration charges', () => {
        const estimate = estimateDldFeeAndRegistration(5_000_000, 'Individual', 3_000_000)
        expect(estimate.dldTransferFee).toBe(200_000)
        expect(estimate.dldAdminFee).toBe(4945)
        expect(estimate.mortgageRegistrationFee).toBe(7_500)
        expect(estimate.mortgageAdminFee).toBe(4470)
        expect(estimate.total).toBe(216_915)
    })
})
