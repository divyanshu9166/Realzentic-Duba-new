import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
    mortgageEligibility,
    mortgageLtvCap,
    rentalYield,
    appreciationProjection,
    vatAmount,
    vatRateForTreatment,
} from './finance-calculators'

describe('mortgageEligibility', () => {
    it('eligible loan never exceeds maxEMI × tenure (interest only reduces capacity)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 5_000_000, noNaN: true }),
                fc.double({ min: 0, max: 1_000_000, noNaN: true }),
                fc.double({ min: 0, max: 20, noNaN: true }),
                fc.integer({ min: 1, max: 360 }),
                (income, obligations, rate, tenure) => {
                    const { maxEmi, eligibleLoan, maxLoanByLtv } = mortgageEligibility({
                        monthlyIncome: income,
                        monthlyObligations: obligations,
                        annualRatePct: rate,
                        tenureMonths: tenure,
                        propertyValue: 10_000_000,
                    })
                    expect(eligibleLoan).toBeGreaterThanOrEqual(0)
                    // Reverse-amortized principal can never exceed the undiscounted sum.
                    expect(eligibleLoan).toBeLessThanOrEqual(maxEmi * tenure + 0.01)
                    expect(eligibleLoan).toBeLessThanOrEqual(maxLoanByLtv + 0.01)
                },
            ),
            { numRuns: 100 },
        )
    })

    it('higher income yields a higher or equal eligible loan', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 20_000, max: 500_000, noNaN: true }),
                fc.double({ min: 5, max: 12, noNaN: true }),
                fc.integer({ min: 12, max: 360 }),
                (income, rate, tenure) => {
                    const base = mortgageEligibility({ monthlyIncome: income, annualRatePct: rate, tenureMonths: tenure, propertyValue: 20_000_000 })
                    const more = mortgageEligibility({ monthlyIncome: income * 1.5, annualRatePct: rate, tenureMonths: tenure, propertyValue: 20_000_000 })
                    expect(more.eligibleLoan).toBeGreaterThanOrEqual(base.eligibleLoan)
                },
            ),
            { numRuns: 100 },
        )
    })

    it('zero-rate eligibility equals maxEMI × tenure', () => {
        const { maxEmi, eligibleLoan, maxLoanByIncome } = mortgageEligibility({ monthlyIncome: 100_000, annualRatePct: 0, stressRatePct: 0, tenureMonths: 240, propertyValue: 100_000_000 })
        expect(eligibleLoan).toBeCloseTo(Math.min(maxEmi * 240, maxLoanByIncome), 0)
    })

    it('applies the UAE off-plan and current expatriate LTV caps', () => {
        expect(mortgageLtvCap(4_000_000, 'EXPATRIATE', 'FIRST_HOME')).toBe(0.8)
        expect(mortgageLtvCap(5_000_000, 'EXPATRIATE', 'FIRST_HOME')).toBe(0.8)
        expect(mortgageLtvCap(6_000_000, 'EXPATRIATE', 'FIRST_HOME')).toBe(0.7)
        expect(mortgageLtvCap(4_000_000, 'UAE_NATIONAL', 'OFF_PLAN')).toBe(0.5)
    })

    it('applies income, stress-rate, and investment-rent safeguards', () => {
        const result = mortgageEligibility({
            monthlyIncome: 100_000,
            annualRatePct: 5,
            tenureMonths: 240,
            propertyValue: 20_000_000,
            purchaseType: 'SECONDARY_OR_INVESTMENT',
            investmentMonthlyRent: 30_000,
        })
        expect(result.stressRatePct).toBe(7)
        expect(result.dbrIncomeUsed).toBe(95_000)
        expect(result.eligibleLoan).toBeLessThanOrEqual(result.maxLoanByIncome + 0.01)
        expect(result.maxLoanByIncome).toBe(8_400_000)
    })
})

describe('rentalYield', () => {
    it('gross yield is at least net yield when expenses are non-negative', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 1, max: 100_000_000, noNaN: true }),
                fc.double({ min: 0, max: 1_000_000, noNaN: true }),
                fc.double({ min: 0, max: 1_000_000, noNaN: true }),
                (value, rent, expenses) => {
                    const r = rentalYield({ propertyValue: value, monthlyRent: rent, annualExpenses: expenses })
                    expect(r.grossYieldPct + 1e-9).toBeGreaterThanOrEqual(r.netYieldPct)
                },
            ),
            { numRuns: 100 },
        )
    })

    it('includes vacancy, management fees, and service charges in net yield', () => {
        const r = rentalYield({
            propertyValue: 1_000_000,
            monthlyRent: 10_000,
            annualExpenses: 12_000,
            vacancyRatePct: 5,
            managementFeePct: 5,
            annualServiceCharges: 6_000,
        })
        expect(r.annualRent).toBe(120_000)
        expect(r.vacancyLoss).toBe(6_000)
        expect(r.managementFee).toBe(6_000)
        expect(r.annualNetIncome).toBe(90_000)
        expect(r.netYieldPct).toBe(9)
    })

    it('zero property value yields 0% (no divide-by-zero)', () => {
        const r = rentalYield({ propertyValue: 0, monthlyRent: 25000 })
        expect(r.grossYieldPct).toBe(0)
        expect(r.netYieldPct).toBe(0)
    })
})

describe('appreciationProjection', () => {
    it('non-negative growth never decreases value and schedule length equals years', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 100_000, max: 100_000_000, noNaN: true }),
                fc.double({ min: 0, max: 30, noNaN: true }),
                fc.integer({ min: 0, max: 50 }),
                (value, growth, years) => {
                    const res = appreciationProjection({ currentValue: value, annualGrowthPct: growth, years })
                    expect(res.schedule.length).toBe(years)
                    // futureValue is rounded to 2dp, so compare against value at rounding scale.
                    expect(res.futureValue + 0.01).toBeGreaterThanOrEqual(value)
                    expect(res.totalGain + 0.01).toBeGreaterThanOrEqual(0)
                    // Monotonic non-decreasing for non-negative growth.
                    for (let i = 1; i < res.schedule.length; i++) {
                        expect(res.schedule[i].value + 0.01).toBeGreaterThanOrEqual(res.schedule[i - 1].value)
                    }
                },
            ),
            { numRuns: 100 },
        )
    })
})

describe('vatAmount', () => {
    it('equals base × rate', () => {
        expect(vatAmount(5_000_000, 0.05)).toBe(250_000)
        expect(vatAmount(5_000_000, 0)).toBe(0)
    })

    it('distinguishes UAE real-estate VAT treatments', () => {
        expect(vatRateForTreatment('COMMERCIAL_PROPERTY')).toBe(0.05)
        expect(vatRateForTreatment('REAL_ESTATE_SERVICE')).toBe(0.05)
        expect(vatRateForTreatment('NEW_RESIDENTIAL_FIRST_SUPPLY')).toBe(0)
        expect(vatRateForTreatment('EXISTING_RESIDENTIAL')).toBe(0)
        expect(vatRateForTreatment('MIXED_USE', 50)).toBe(0.025)
    })
})
