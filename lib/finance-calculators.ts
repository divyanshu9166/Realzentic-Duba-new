/**
 * UAE finance calculators — additional PURE helpers.
 *
 * Complements the existing tested math (`computeEmi`, `amortizationSchedule`,
 * `computeDldFee`/`estimateDldFeeAndRegistration`, `vatRateForProperty`)
 * with mortgage eligibility (DBR + LTV) and investor metrics (rental yield +
 * appreciation projection).
 *
 * All functions are pure and deterministic; invalid/non-finite inputs degrade
 * to safe zeros rather than throwing, so they are convenient to drive directly
 * from form fields.
 */

/** Round to 2 decimal places. */
function round2(n: number): number {
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function num(n: unknown): number {
    return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

// ─── Mortgage eligibility (DBR + UAE Central Bank LTV caps) ──────────────────

export type MortgageApplicantType = 'UAE_NATIONAL' | 'EXPATRIATE'
export type MortgagePurchaseType = 'FIRST_HOME' | 'SECONDARY_OR_INVESTMENT' | 'OFF_PLAN'

export interface MortgageEligibilityInput {
    /** Gross monthly income. */
    monthlyIncome: number
    /** Existing monthly EMIs / obligations (default 0). */
    monthlyObligations?: number
    /** Annual interest rate in percent. */
    annualRatePct: number
    /** Tenure in months. */
    tenureMonths: number
    /** Property value is required to apply the regulatory LTV cap. */
    propertyValue: number
    applicantType?: MortgageApplicantType
    purchaseType?: MortgagePurchaseType
    /** Debt-burden-ratio cap as a fraction (default 0.5 = 50%). */
    dbr?: number
}

export interface MortgageEligibilityResult {
    /** Maximum EMI the applicant can service. */
    maxEmi: number
    /** Maximum loan principal that EMI supports at the given rate/tenure. */
    eligibleLoan: number
    /** Regulatory maximum percentage of the property value that may be financed. */
    ltvCap: number
    /** Monetary limit created by the LTV cap. */
    maxLoanByLtv: number
}

/**
 * Return the applicable UAE Central Bank LTV ceiling. Lenders may apply more
 * conservative underwriting criteria; this is a regulatory maximum, not an
 * approval promise.
 */
export function mortgageLtvCap(
    propertyValue: number,
    applicantType: MortgageApplicantType = 'EXPATRIATE',
    purchaseType: MortgagePurchaseType = 'FIRST_HOME',
): number {
    if (purchaseType === 'OFF_PLAN') return 0.5
    if (purchaseType === 'SECONDARY_OR_INVESTMENT') return applicantType === 'UAE_NATIONAL' ? 0.65 : 0.6
    if (applicantType === 'UAE_NATIONAL') return propertyValue <= 5_000_000 ? 0.85 : 0.75
    return propertyValue < 5_000_000 ? 0.75 : 0.65
}

/**
 * Estimate mortgage eligibility using debt burden ratio (DBR) and the UAE
 * Central Bank LTV ceiling. The bank caps total obligations at `dbr × income`, so the affordable EMI is
 * `income × foir − existing obligations`. That EMI is then reverse-amortized
 * into the maximum supportable principal at the given rate and tenure.
 */
export function mortgageEligibility(input: MortgageEligibilityInput): MortgageEligibilityResult {
    const income = num(input.monthlyIncome)
    const obligations = num(input.monthlyObligations)
    const dbr = clamp(num(input.dbr) || 0.5, 0, 1)
    const tenure = Math.max(0, Math.trunc(num(input.tenureMonths)))
    const r = num(input.annualRatePct) / 12 / 100

    const propertyValue = num(input.propertyValue)
    const ltvCap = mortgageLtvCap(propertyValue, input.applicantType, input.purchaseType)
    const maxLoanByLtv = round2(Math.max(0, propertyValue * ltvCap))
    const maxEmi = round2(Math.max(0, income * dbr - obligations))
    if (maxEmi <= 0 || tenure <= 0 || maxLoanByLtv <= 0) return { maxEmi, eligibleLoan: 0, ltvCap, maxLoanByLtv }

    // Undiscounted sum of all EMIs — the mathematical upper bound for the
    // principal. With any positive interest the reverse-amortized principal is
    // strictly smaller, so this also serves as a safe ceiling against the
    // floating-point cancellation that the formula below suffers when `r` is
    // extremely small.
    const undiscounted = maxEmi * tenure

    let eligibleLoan: number
    // Treat negligibly small rates as zero: below this threshold the
    // amortization formula loses all precision (g - 1 → ~machine epsilon) and
    // the principal converges to the undiscounted sum anyway.
    if (r < 1e-9) {
        eligibleLoan = undiscounted
    } else {
        const g = Math.pow(1 + r, tenure)
        eligibleLoan = (maxEmi * (g - 1)) / (r * g)
    }
    // Clamp to the undiscounted sum: positive interest can only reduce the
    // supportable principal, never increase it past EMI × tenure.
    eligibleLoan = Math.min(eligibleLoan, undiscounted)
    return { maxEmi, eligibleLoan: round2(Math.min(eligibleLoan, maxLoanByLtv)), ltvCap, maxLoanByLtv }
}

// ─── Rental yield ─────────────────────────────────────────────────────────────

export interface RentalYieldInput {
    propertyValue: number
    monthlyRent: number
    /** Annual ownership costs (maintenance, tax, etc.) — default 0. */
    annualExpenses?: number
}

export interface RentalYieldResult {
    annualRent: number
    grossYieldPct: number
    netYieldPct: number
}

/**
 * Rental yield: gross = annual rent / property value; net subtracts annual
 * ownership expenses from the annual rent before dividing.
 */
export function rentalYield(input: RentalYieldInput): RentalYieldResult {
    const value = num(input.propertyValue)
    const annualRent = num(input.monthlyRent) * 12
    const expenses = num(input.annualExpenses)
    const gross = value > 0 ? (annualRent / value) * 100 : 0
    const net = value > 0 ? ((annualRent - expenses) / value) * 100 : 0
    return { annualRent: round2(annualRent), grossYieldPct: round2(gross), netYieldPct: round2(net) }
}

// ─── Appreciation projection ───────────────────────────────────────────────────

export interface AppreciationInput {
    currentValue: number
    annualGrowthPct: number
    years: number
}

export interface AppreciationResult {
    futureValue: number
    totalGain: number
    schedule: Array<{ year: number; value: number }>
}

/**
 * Compound a property's value forward at a constant annual growth rate and
 * return the year-by-year projected value, the final value and the total gain.
 */
export function appreciationProjection(input: AppreciationInput): AppreciationResult {
    const current = num(input.currentValue)
    const g = num(input.annualGrowthPct) / 100
    const years = clamp(Math.trunc(num(input.years)), 0, 50)

    const schedule: Array<{ year: number; value: number }> = []
    for (let y = 1; y <= years; y++) {
        schedule.push({ year: y, value: round2(current * Math.pow(1 + g, y)) })
    }
    const futureValue = round2(current * Math.pow(1 + g, years))
    return { futureValue, totalGain: round2(futureValue - current), schedule }
}

// ─── VAT on property ─────────────────────────────────────────────────────────

/**
 * VAT amount on a base value at a given fractional rate (e.g. 0.05). Pure
 * multiply + round; the rate itself comes from `vatRateForProperty` in
 * `lib/cost-sheet.ts`.
 */
export function vatAmount(baseValue: number, rate: number): number {
    return round2(num(baseValue) * num(rate))
}
