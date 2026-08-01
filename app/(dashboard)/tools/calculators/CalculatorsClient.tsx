'use client'

/**
 * Dubai property finance calculators:
 *   1. DLD transfer + mortgage registration fees
 *   2. Mortgage EMI + eligibility (DBR and LTV)
 *   3. Rental Yield + Appreciation (investor metrics)
 *   4. VAT by property use
 *
 * All math reuses the tested pure helpers in lib/* (no server round-trip).
 */

import { useMemo, useState } from 'react'
import { Landmark, Home, TrendingUp, Receipt, Percent } from 'lucide-react'
import { vatRateForProperty } from '@/lib/cost-sheet'
import { computeEmi, totalInterest, validateDownPayment, estimateDldFeeAndRegistration } from '@/lib/emi'
import { mortgageEligibility, rentalYield, appreciationProjection, vatAmount } from '@/lib/finance-calculators'
import { formatCurrency } from '@/lib/currency'

const TABS = [
    { id: 'dld', label: 'DLD Fees', Icon: Landmark },
    { id: 'mortgage', label: 'Mortgage', Icon: Home },
    { id: 'invest', label: 'Yield & Growth', Icon: TrendingUp },
    { id: 'vat', label: 'VAT', Icon: Receipt },
] as const
type TabId = (typeof TABS)[number]['id']

// Illustrative rates only — lender offers must be verified before advising a buyer.
const BANK_RATES: Array<{ bank: string; rate: number }> = [
    { bank: 'Scenario A', rate: 4.5 }, { bank: 'Scenario B', rate: 5 }, { bank: 'Scenario C', rate: 5.5 },
]

function Field({ label, value, onChange, type = 'number', placeholder, min, max }: {
    label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; min?: number; max?: number
}) {
    return (
        <div>
            <label className="block text-xs text-muted mb-1">{label}</label>
            <input type={type} value={value} min={min} max={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm" />
        </div>
    )
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
    return (
        <div className="glass-card p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={`text-lg font-bold ${tint ?? 'text-foreground'}`}>{value}</p>
        </div>
    )
}

export default function CalculatorsClient() {
    const [tab, setTab] = useState<TabId>('dld')

    // 1. Dubai Land Department fees
    const [sdValue, setSdValue] = useState('5000000')
    const [buyerType, setBuyerType] = useState<'Individual' | 'Company'>('Individual')
    const [mortgageForDld, setMortgageForDld] = useState('0')
    const dld = useMemo(() => {
        const base = Number(sdValue)
        if (!base || base <= 0 || base > 999_999_999) return null
        try {
            return estimateDldFeeAndRegistration(base, buyerType, Number(mortgageForDld))
        } catch { return null }
    }, [sdValue, buyerType, mortgageForDld])

    // 2. Mortgage
    const [pValue, setPValue] = useState('5000000')
    const [down, setDown] = useState('1000000')
    const [rate, setRate] = useState('8.5')
    const [years, setYears] = useState('20')
    const effectiveYears = Math.min(25, Math.max(1, Number(years) || 20))
    const loan = useMemo(() => {
        const value = Number(pValue), dp = Number(down), r = Number(rate), n = effectiveYears * 12
        if (!value || value <= 0 || value > 999_999_999) return null
        if (!validateDownPayment(value, dp)) return null
        if (!Number.isFinite(r) || r < 0 || !Number.isInteger(n) || n < 1) return null
        try {
            const principal = value - dp
            const emi = computeEmi(principal, r, n)
            const interest = totalInterest(principal, r, n)
            return { principal, emi, interest, total: principal + interest }
        } catch { return null }
    }, [pValue, down, rate, effectiveYears])
    const bankEmis = useMemo(() => {
        const value = Number(pValue), dp = Number(down), n = effectiveYears * 12
        if (!validateDownPayment(value, dp) || !Number.isInteger(n) || n < 1) return []
        const principal = value - dp
        return BANK_RATES.map((b) => {
            try { return { ...b, emi: computeEmi(principal, b.rate, n) } } catch { return { ...b, emi: 0 } }
        })
    }, [pValue, down, effectiveYears])

    // Eligibility
    const [income, setIncome] = useState('100000')
    const [obligations, setObligations] = useState('0')
    const [applicantType, setApplicantType] = useState<'UAE_NATIONAL' | 'EXPATRIATE'>('EXPATRIATE')
    const [purchaseType, setPurchaseType] = useState<'FIRST_HOME' | 'SECONDARY_OR_INVESTMENT' | 'OFF_PLAN'>('FIRST_HOME')
    const elig = useMemo(() => mortgageEligibility({
        monthlyIncome: Number(income), monthlyObligations: Number(obligations),
        annualRatePct: Number(rate) || 8.5, tenureMonths: effectiveYears * 12,
        propertyValue: Number(pValue), applicantType, purchaseType,
    }), [income, obligations, rate, effectiveYears, pValue, applicantType, purchaseType])

    // 3. Yield & appreciation
    const [ryValue, setRyValue] = useState('8000000')
    const [rent, setRent] = useState('25000')
    const [expenses, setExpenses] = useState('30000')
    const ry = useMemo(() => rentalYield({ propertyValue: Number(ryValue), monthlyRent: Number(rent), annualExpenses: Number(expenses) }), [ryValue, rent, expenses])
    const [growth, setGrowth] = useState('8')
    const [appYears, setAppYears] = useState('5')
    const app = useMemo(() => appreciationProjection({ currentValue: Number(ryValue), annualGrowthPct: Number(growth), years: Number(appYears) }), [ryValue, growth, appYears])

    // 4. VAT
    const [vatBase, setVatBase] = useState('5000000')
    const [propertyUse, setPropertyUse] = useState<'Residential' | 'Commercial'>('Residential')
    const vat = useMemo(() => {
        const base = Number(vatBase)
        const rate = vatRateForProperty(propertyUse)
        return { rate, amount: vatAmount(base, rate), total: base + vatAmount(base, rate) }
    }, [vatBase, propertyUse])

    return (
        <div className="space-y-5 max-w-4xl">
            <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/10"><Percent className="size-5 text-accent" /></div>
                <div>
                    <h1 className="text-xl font-bold text-foreground">Property Finance Calculators</h1>
                    <p className="text-sm text-muted">DLD fees, mortgage eligibility, rental yield, appreciation, and VAT — all in one place.</p>
                </div>
            </div>

            <div className="flex bg-surface rounded-xl border border-border p-0.5 w-fit overflow-x-auto">
                {TABS.map(({ id, label, Icon }) => (
                    <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>
                        <Icon className="size-3.5" /> {label}
                    </button>
                ))}
            </div>

            {/* 1. DLD fees */}
            {tab === 'dld' && (
                <div className="space-y-4">
                    <div className="glass-card p-5 grid gap-3 sm:grid-cols-3">
                        <div>
                            <label className="block text-xs text-muted mb-1">Buyer Type</label>
                            <select value={buyerType} onChange={(e) => setBuyerType(e.target.value as 'Individual' | 'Company')} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                <option value="Individual">Individual</option>
                                <option value="Company">Company</option>
                            </select>
                        </div>
                        <Field label="Property Value (AED)" value={sdValue} onChange={setSdValue} />
                        <Field label="Mortgage Amount (AED, optional)" value={mortgageForDld} onChange={setMortgageForDld} />
                    </div>
                    {dld && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <Stat label="DLD Total (4%)" value={formatCurrency(dld.dldTransferFee)} tint="text-accent" />
                            <Stat label="Buyer share (2%)" value={formatCurrency(dld.buyerTransferFee)} />
                            <Stat label="Sale registration add-ons" value={formatCurrency(dld.dldAdminFee)} />
                            <Stat label="Mortgage Registration" value={formatCurrency(dld.mortgageRegistrationFee + dld.mortgageAdminFee)} />
                            <Stat label="Estimated charges" value={formatCurrency(dld.total)} tint="text-emerald-600" />
                        </div>
                    )}
                    <p className="text-[11px] text-muted">Indicative estimate based on current DLD published fees; the 4% sale fee is shown as the total transaction fee and the 2% buyer share separately. Trustee, title, map and mortgage charges can vary by service route and property type.</p>
                </div>
            )}

            {/* 2. Mortgage */}
            {tab === 'mortgage' && (
                <div className="space-y-4">
                    <div className="glass-card p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Property Value (AED)" value={pValue} onChange={setPValue} />
                        <Field label="Down Payment (AED)" value={down} onChange={setDown} />
                        <Field label="Interest Rate (%)" value={rate} onChange={setRate} />
                        <Field label="Tenure (years, max 25)" value={years} onChange={(value) => setYears(value === '' ? '' : String(Math.min(25, Number(value))))} min={1} max={25} />
                    </div>
                    {loan ? (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <Stat label="Mortgage Amount" value={formatCurrency(loan.principal)} />
                                <Stat label="Monthly Installment" value={formatCurrency(loan.emi)} tint="text-accent" />
                                <Stat label="Total Interest" value={formatCurrency(loan.interest)} tint="text-amber-600" />
                                <Stat label="Total Payment" value={formatCurrency(loan.total)} />
                            </div>
                            <div className="glass-card overflow-hidden">
                                <div className="px-4 py-2 text-xs font-semibold text-muted border-b border-border">Illustrative rate comparison — monthly installment on {formatCurrency(loan.principal)} over {effectiveYears} yrs</div>
                                <div className="overflow-x-auto">
                                    <table className="crm-table">
                                        <thead><tr><th>Bank</th><th>Rate</th><th>Monthly EMI</th></tr></thead>
                                        <tbody>
                                            {bankEmis.map((b) => (
                                                <tr key={b.bank}><td className="text-foreground">{b.bank}</td><td className="text-muted">{b.rate}%</td><td className="text-accent font-medium">{formatCurrency(b.emi)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="px-4 py-2 text-[11px] text-muted">Rates are indicative; confirm live rates with the lender (live-rate feeds require a paid data source).</p>
                            </div>
                        </>
                    ) : (
                        <p className="glass-card p-4 text-sm text-muted">Enter a valid property value with a down payment below it.</p>
                    )}

                    <div className="glass-card p-5 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground">Mortgage Eligibility (DBR + LTV)</h2>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Field label="Monthly Income (AED)" value={income} onChange={setIncome} />
                            <Field label="Existing Obligations (AED)" value={obligations} onChange={setObligations} />
                            <select value={applicantType} onChange={(e) => setApplicantType(e.target.value as 'UAE_NATIONAL' | 'EXPATRIATE')} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm"><option value="EXPATRIATE">Expatriate</option><option value="UAE_NATIONAL">UAE National</option></select>
                            <select value={purchaseType} onChange={(e) => setPurchaseType(e.target.value as 'FIRST_HOME' | 'SECONDARY_OR_INVESTMENT' | 'OFF_PLAN')} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm"><option value="FIRST_HOME">First Home</option><option value="SECONDARY_OR_INVESTMENT">Secondary / Investment</option><option value="OFF_PLAN">Off-Plan</option></select>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            <Stat label="Max Affordable Installment" value={formatCurrency(elig.maxEmi)} />
                            <Stat label="Eligible Mortgage" value={formatCurrency(elig.eligibleLoan)} tint="text-emerald-600" />
                            <Stat label="Applicable LTV Cap" value={`${(elig.ltvCap * 100).toFixed(0)}%`} />
                        </div>
                        <p className="text-[11px] text-muted">Indicative only: eligible loan at {rate || 8.5}% for {effectiveYears} years. Banks may apply a lower DBR/LTV or shorter tenor after underwriting.</p>
                    </div>
                </div>
            )}

            {/* 3. Yield & appreciation */}
            {tab === 'invest' && (
                <div className="space-y-4">
                    <div className="glass-card p-5 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground">Rental Yield</h2>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Property Value (AED)" value={ryValue} onChange={setRyValue} />
                            <Field label="Monthly Rent (AED)" value={rent} onChange={setRent} />
                            <Field label="Annual Expenses (AED)" value={expenses} onChange={setExpenses} />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <Stat label="Annual Rent" value={formatCurrency(ry.annualRent)} />
                            <Stat label="Gross Yield" value={`${ry.grossYieldPct}%`} tint="text-accent" />
                            <Stat label="Net Yield" value={`${ry.netYieldPct}%`} tint="text-emerald-600" />
                        </div>
                    </div>

                    <div className="glass-card p-5 space-y-3">
                        <h2 className="text-sm font-semibold text-foreground">Appreciation Projection</h2>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Current Value (AED)" value={ryValue} onChange={setRyValue} />
                            <Field label="Annual Growth (%)" value={growth} onChange={setGrowth} />
                            <Field label="Years" value={appYears} onChange={setAppYears} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Stat label={`Value after ${appYears || 0} yrs`} value={formatCurrency(app.futureValue)} tint="text-accent" />
                            <Stat label="Total Gain" value={formatCurrency(app.totalGain)} tint="text-emerald-600" />
                        </div>
                        {app.schedule.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {app.schedule.map((s) => (
                                    <span key={s.year} className="px-2 py-0.5 rounded-full text-xs bg-surface border border-border text-muted">Y{s.year}: <span className="text-foreground font-medium">{formatCurrency(s.value)}</span></span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 4. VAT */}
            {tab === 'vat' && (
                <div className="space-y-4">
                    <div className="glass-card p-5 grid gap-3 sm:grid-cols-2">
                        <Field label="Base Value (AED)" value={vatBase} onChange={setVatBase} />
                        <div>
                            <label className="block text-xs text-muted mb-1">Property Use</label>
                            <select value={propertyUse} onChange={(e) => setPropertyUse(e.target.value as 'Residential' | 'Commercial')} className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm">
                                <option value="Residential">Residential (0%)</option>
                                <option value="Commercial">Commercial (5%)</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <Stat label="VAT Rate" value={`${(vat.rate * 100).toFixed(0)}%`} />
                        <Stat label="VAT Amount" value={formatCurrency(vat.amount)} tint="text-accent" />
                        <Stat label="Total with VAT" value={formatCurrency(vat.total)} tint="text-emerald-600" />
                    </div>
                    <p className="text-[11px] text-muted">Residential transactions need zero-rated versus exempt accounting review; commercial property is modeled at the 5% standard VAT rate.</p>
                </div>
            )}
        </div>
    )
}
