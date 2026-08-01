/**
 * EMI & Affordability pure functions for the Real Estate CRM (Module 7).
 *
 * Every function here is PURE: it performs no database access, no I/O, and no
 * mutation of its inputs. This keeps the financing math deterministic and
 * directly property-testable. All monetary math reuses the shared helpers in
 * `lib/money.ts` (`roundMoney`, `assertMoneyRange`) so the entire platform
 * shares identical rounding (round-half-up to 2 dp) and range
 * (`0.00 … 999,999,999.99`) semantics. Dubai transfer-fee estimates reuse
 * `computeDldFee` from `lib/cost-sheet.ts` rather than re-deriving them.
 *
 * Requirements: 10.1 (EMI, total interest, amortization schedule),
 * 10.3 (Dubai Land Department transfer-fee estimate),
 * 10.6 (down payment must be below property value).
 * Design properties: 38 (EMI/amortization consistency), 39 (down-payment guard).
 */

import {
    computeDldFee,
    MORTGAGE_REGISTRATION_ADMIN_FEE,
    MORTGAGE_REGISTRATION_FEE_RATE,
    type BuyerType,
} from './cost-sheet'
import { assertMoneyRange, roundMoney } from './money'

// Re-export the shared DLD helper so the mortgage tool can produce a fee
// estimate without duplicating the statutory calculation.
export { computeDldFee } from './cost-sheet'

// ---------------------------------------------------------------------------
// Down payment validation (Req 10.6 / Property 39)
// ---------------------------------------------------------------------------

/**
 * Validate a down payment against a property value. Returns `true` only when
 * the down payment is STRICTLY BELOW the property value, so that the financed
 * principal (`propertyValue − downPayment`) is always positive. A down payment
 * greater than or equal to the property value is rejected (Property 39); the
 * caller must surface a validation error and SHALL NOT compute an EMI.
 *
 * Both inputs must be finite numbers and the down payment must be
 * non-negative; any other input yields `false`.
 *
 * Requirements: 10.6.
 */
export function validateDownPayment(propertyValue: number, downPayment: number): boolean {
    if (typeof propertyValue !== 'number' || !Number.isFinite(propertyValue)) return false
    if (typeof downPayment !== 'number' || !Number.isFinite(downPayment)) return false
    if (downPayment < 0) return false
    return downPayment < propertyValue
}

// ---------------------------------------------------------------------------
// EMI computation (Req 10.1 / Property 38)
// ---------------------------------------------------------------------------

/** Convert an annual interest rate (in percent) to a per-month fraction. */
function monthlyRate(annualRatePct: number): number {
    return annualRatePct / 12 / 100
}

/**
 * Validate the shared EMI inputs. Principal must lie within the money range,
 * the annual rate must be a finite non-negative number, and the tenure must be
 * a positive integer number of months.
 */
function assertEmiInputs(principal: number, annualRatePct: number, tenureMonths: number): void {
    assertMoneyRange(principal)
    if (typeof annualRatePct !== 'number' || !Number.isFinite(annualRatePct) || annualRatePct < 0) {
        throw new Error(`EMI annual rate must be a finite, non-negative number, received: ${String(annualRatePct)}`)
    }
    if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
        throw new Error(`EMI tenure must be a positive integer number of months, received: ${String(tenureMonths)}`)
    }
}

/**
 * Compute the level monthly EMI for a loan using the standard amortization
 * formula:
 *
 * ```
 * EMI = P · r · (1 + r)^n / ((1 + r)^n − 1)
 * ```
 *
 * where `P` is the principal, `r` is the monthly interest rate
 * (`annualRatePct / 12 / 100`), and `n` is the tenure in months. When the rate
 * is zero the formula degenerates to a straight-line repayment `P / n`. The
 * result is rounded to 2 dp and validated to the money range.
 *
 * Requirements: 10.1 (Property 38).
 *
 * @throws if any input is invalid or the result overflows the money range.
 */
export function computeEmi(principal: number, annualRatePct: number, tenureMonths: number): number {
    assertEmiInputs(principal, annualRatePct, tenureMonths)

    const r = monthlyRate(annualRatePct)

    // Zero-interest loans repay the principal in equal straight-line slices.
    if (r === 0) {
        return assertMoneyRange(roundMoney(principal / tenureMonths))
    }

    const growth = Math.pow(1 + r, tenureMonths)
    const emi = (principal * r * growth) / (growth - 1)
    return assertMoneyRange(roundMoney(emi))
}

// ---------------------------------------------------------------------------
// Amortization schedule (Req 10.1 / Property 38)
// ---------------------------------------------------------------------------

/** A single month's row in an amortization schedule. */
export interface AmortizationRow {
    /** 1-based month index. */
    month: number
    /** Payment made this month (level EMI, except the final adjusting payment). */
    payment: number
    /** Portion of the payment that reduces the outstanding principal. */
    principal: number
    /** Portion of the payment that covers interest accrued this month. */
    interest: number
    /** Outstanding principal balance after this month's payment. */
    balance: number
}

/**
 * Build the per-month amortization schedule for a loan. Each month accrues
 * interest on the outstanding balance (`balance × r`); the remainder of the
 * EMI reduces the principal. The FINAL month absorbs any accumulated rounding
 * remainder by repaying the entire outstanding balance, so that:
 *
 *  - the principal components sum EXACTLY to the original principal, and
 *  - the final outstanding balance is EXACTLY `0`.
 *
 * Every monetary figure is rounded to 2 dp and stays within the money range.
 *
 * Requirements: 10.1 (Property 38).
 *
 * @throws if any input is invalid or an intermediate value overflows the range.
 */
export function amortizationSchedule(
    principal: number,
    annualRatePct: number,
    tenureMonths: number
): AmortizationRow[] {
    assertEmiInputs(principal, annualRatePct, tenureMonths)

    const r = monthlyRate(annualRatePct)
    const emi = computeEmi(principal, annualRatePct, tenureMonths)

    const rows: AmortizationRow[] = []
    let balance = roundMoney(principal)

    for (let month = 1; month <= tenureMonths; month++) {
        const interest = roundMoney(balance * r)
        const isLast = month === tenureMonths

        let principalComponent: number
        let payment: number
        if (isLast) {
            // Final month clears the remaining balance exactly, absorbing any
            // rounding drift accumulated over the prior months.
            principalComponent = balance
            payment = roundMoney(principalComponent + interest)
        } else {
            principalComponent = roundMoney(emi - interest)
            payment = emi
        }

        balance = roundMoney(balance - principalComponent)

        rows.push({
            month,
            payment,
            principal: principalComponent,
            interest,
            balance,
        })
    }

    return rows
}

/**
 * Total interest paid across the life of a loan, derived from the amortization
 * schedule (the sum of each month's interest component). Provided alongside the
 * EMI and schedule so the calculator can present monthly EMI, total interest,
 * and the full schedule together (Req 10.1).
 */
export function totalInterest(
    principal: number,
    annualRatePct: number,
    tenureMonths: number
): number {
    const schedule = amortizationSchedule(principal, annualRatePct, tenureMonths)
    const sum = schedule.reduce((acc, row) => acc + row.interest, 0)
    return assertMoneyRange(roundMoney(sum))
}

// ---------------------------------------------------------------------------
// DLD transfer & mortgage registration estimate (Req 10.3)
// ---------------------------------------------------------------------------

/**
 * Estimate statutory Dubai purchase charges. `mortgageAmount` may be omitted
 * for a cash purchase; its registration fee is never calculated against the
 * full property price by mistake.
 */
export function estimateDldFeeAndRegistration(
    propertyValue: number,
    buyerType: BuyerType = 'Individual',
    mortgageAmount = 0,
): {
    dldTransferFee: number
    dldAdminFee: number
    mortgageRegistrationFee: number
    mortgageAdminFee: number
    total: number
} {
    assertMoneyRange(propertyValue)
    const dld = computeDldFee(propertyValue, buyerType)
    const safeMortgage = Math.max(0, Number.isFinite(mortgageAmount) ? mortgageAmount : 0)
    assertMoneyRange(safeMortgage)
    const mortgageRegistrationFee = safeMortgage > 0
        ? assertMoneyRange(roundMoney(safeMortgage * MORTGAGE_REGISTRATION_FEE_RATE))
        : 0
    const mortgageAdminFee = safeMortgage > 0 ? MORTGAGE_REGISTRATION_ADMIN_FEE : 0
    return {
        dldTransferFee: dld.transferFee,
        dldAdminFee: dld.adminFee,
        mortgageRegistrationFee,
        mortgageAdminFee,
        total: assertMoneyRange(roundMoney(dld.total + mortgageRegistrationFee + mortgageAdminFee)),
    }
}
