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
    /**
     * Optional lender stress-test rate. If omitted, the calculator uses the
     * current rate + 2 percentage points, within the CBUAE stress-test range.
     */
    stressRatePct?: number
    /** Monthly rent used for the CBUAE investment-property DBR deduction. */
    investmentMonthlyRent?: number
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
    /** CBUAE maximum-financing limit based on annual income. */
    maxLoanByIncome: number
    /** Rate used for the conservative affordability stress test. */
    stressRatePct: number
    /** Monthly income used for DBR after the investment-rent deduction. */
    dbrIncomeUsed: number
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
    return propertyValue <= 5_000_000 ? 0.8 : 0.7
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
    const currentRatePct = Math.max(0, num(input.annualRatePct))
    const stressRatePct = input.stressRatePct == null
        ? currentRatePct + 2
        : Math.max(0, num(input.stressRatePct))

    const propertyValue = num(input.propertyValue)
    const applicantType = input.applicantType ?? 'EXPATRIATE'
    const purchaseType = input.purchaseType ?? 'FIRST_HOME'
    const ltvCap = mortgageLtvCap(propertyValue, applicantType, purchaseType)
    const maxLoanByLtv = round2(Math.max(0, propertyValue * ltvCap))
    const rentDeduction = purchaseType === 'SECONDARY_OR_INVESTMENT'
        ? (Math.max(0, num(input.investmentMonthlyRent)) * 2) / 12
        : 0
    const dbrIncomeUsed = round2(Math.max(0, income - rentDeduction))
    const maxEmi = round2(Math.max(0, dbrIncomeUsed * dbr - obligations))
    const maxLoanByIncome = round2(Math.max(0, income * 12 * (applicantType === 'UAE_NATIONAL' ? 8 : 7)))
    if (maxEmi <= 0 || tenure <= 0 || maxLoanByLtv <= 0 || maxLoanByIncome <= 0) {
        return { maxEmi, eligibleLoan: 0, ltvCap, maxLoanByLtv, maxLoanByIncome, stressRatePct, dbrIncomeUsed }
    }

    const r = stressRatePct / 12 / 100

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
    return {
        maxEmi,
        eligibleLoan: round2(Math.min(eligibleLoan, maxLoanByLtv, maxLoanByIncome)),
        ltvCap,
        maxLoanByLtv,
        maxLoanByIncome,
        stressRatePct,
        dbrIncomeUsed,
    }
}

// ─── Rental yield ─────────────────────────────────────────────────────────────

export interface RentalYieldInput {
    propertyValue: number
    monthlyRent: number
    /** Annual ownership costs (maintenance, tax, etc.) — default 0. */
    annualExpenses?: number
    /** Expected annual vacancy allowance as a percentage of gross rent. */
    vacancyRatePct?: number
    /** Property-management fee as a percentage of gross rent. */
    managementFeePct?: number
    /** Annual service charges, kept separate from other operating expenses. */
    annualServiceCharges?: number
}

export interface RentalYieldResult {
    annualRent: number
    vacancyLoss: number
    managementFee: number
    annualNetIncome: number
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
    const vacancyLoss = annualRent * clamp(num(input.vacancyRatePct), 0, 100) / 100
    const managementFee = annualRent * clamp(num(input.managementFeePct), 0, 100) / 100
    const serviceCharges = num(input.annualServiceCharges)
    const annualNetIncome = annualRent - vacancyLoss - managementFee - expenses - serviceCharges
    const gross = value > 0 ? (annualRent / value) * 100 : 0
    const net = value > 0 ? (annualNetIncome / value) * 100 : 0
    return {
        annualRent: round2(annualRent),
        vacancyLoss: round2(vacancyLoss),
        managementFee: round2(managementFee),
        annualNetIncome: round2(annualNetIncome),
        grossYieldPct: round2(gross),
        netYieldPct: round2(net),
    }
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

export type UaeVatTreatment =
    | 'COMMERCIAL_PROPERTY'
    | 'NEW_RESIDENTIAL_FIRST_SUPPLY'
    | 'EXISTING_RESIDENTIAL'
    | 'REAL_ESTATE_SERVICE'
    | 'MIXED_USE'

/**
 * Return the VAT rate for the selected UAE real-estate treatment. For mixed
 * use, `commercialSharePct` produces a blended headline rate for the entered
 * base; the underlying invoice still needs proper FTA apportionment.
 */
export function vatRateForTreatment(treatment: UaeVatTreatment, commercialSharePct = 0): number {
    if (treatment === 'COMMERCIAL_PROPERTY' || treatment === 'REAL_ESTATE_SERVICE') return 0.05
    if (treatment === 'MIXED_USE') return 0.05 * clamp(num(commercialSharePct), 0, 100) / 100
    return 0
}

/**
 * VAT amount on a base value at a given fractional rate (e.g. 0.05). Pure
 * multiply + round; the rate itself comes from `vatRateForProperty` in
 * `lib/cost-sheet.ts`.
 */
export function vatAmount(baseValue: number, rate: number): number {
    return round2(num(baseValue) * num(rate))
}
