'use client'

/**
 * EMI & Affordability Calculator (Module 7 / Requirement 10).
 *
 * Client-side tool that composes the PURE compute functions from `lib/emi.ts`
 * (`computeEmi`, `amortizationSchedule`, `totalInterest`, `validateDownPayment`)
 * with UI. It covers:
 *  - Inputs (property value, down payment, tenure, interest rate) + results
 *    (monthly EMI, total interest, total payment, amortization schedule) — Req 10.1
 *  - Bank-rate comparison for SBI/HDFC/ICICI/Axis/Kotak/PNB — Req 10.2
 *  - Save-to-deal, storing the calculation as JSON in `Deal.metadata` — Req 10.4
 *  - Shareable link + WhatsApp share action — Req 10.5
 *  - Down-payment validation error (down payment >= property value) — Req 10.6
 */

import { Suspense, useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
    Calculator, Share2, Save, Link2, ChevronDown, ChevronUp,
    Loader2, CheckCircle, AlertCircle, MessageCircle, Landmark,
} from 'lucide-react'
import {
    computeEmi, amortizationSchedule, totalInterest, validateDownPayment,
} from '@/lib/emi'
import { listDealsForCalculator, saveEmiCalculationToDeal } from '@/app/actions/deals'
import Modal from '@/components/Modal'

// Bank-rate comparison config constant (Req 10.2). Representative indicative
// rates; the comparison recomputes the EMI for each rate at the same principal
// and tenure so agents can show buyers how lenders stack up.
const BANK_RATES = [
    { bank: 'SBI', rate: 8.5 },
    { bank: 'HDFC', rate: 8.75 },
    { bank: 'ICICI', rate: 8.9 },
    { bank: 'Axis', rate: 9.0 },
    { bank: 'Kotak', rate: 8.7 },
    { bank: 'PNB', rate: 8.6 },
]

const fmt = (v) => `AED ${(Number(v) || 0).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`

// Shared Tailwind class strings (the app has no shared btn/input utilities;
// these mirror the inline styles used across the other dashboard pages).
const INPUT_CLS = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground'
const BTN_SECONDARY = 'px-4 py-2 bg-surface border border-border text-sm text-foreground rounded-lg hover:bg-surface-hover flex items-center gap-2'
const BTN_PRIMARY = 'px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2'
const BTN_GHOST = 'px-4 py-2 text-sm text-muted rounded-lg hover:bg-surface-hover'

export default function EmiCalculatorPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
        }>
            <EmiCalculatorContent />
        </Suspense>
    )
}

function EmiCalculatorContent() {
    const searchParams = useSearchParams()

    // ── Inputs (prefilled from a shareable link when present) ──────────
    const [propertyValue, setPropertyValue] = useState('5000000')
    const [downPayment, setDownPayment] = useState('1000000')
    const [tenureYears, setTenureYears] = useState('20')
    const [interestRate, setInterestRate] = useState('8.5')

    // Prefill from the shareable link's query params on first mount (Req 10.5).
    useEffect(() => {
        const pv = searchParams.get('pv')
        const dp = searchParams.get('dp')
        const ty = searchParams.get('ty')
        const rate = searchParams.get('rate')
        if (pv !== null) setPropertyValue(pv)
        if (dp !== null) setDownPayment(dp)
        if (ty !== null) setTenureYears(ty)
        if (rate !== null) setInterestRate(rate)
    }, [searchParams])

    const [showSchedule, setShowSchedule] = useState(false)

    // ── Save-to-deal state ─────────────────────────────────────────────
    const [showSaveModal, setShowSaveModal] = useState(false)
    const [deals, setDeals] = useState([])
    const [dealsLoading, setDealsLoading] = useState(false)
    const [selectedDealId, setSelectedDealId] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState(null)

    // ── Share state ────────────────────────────────────────────────────
    const [copied, setCopied] = useState(false)

    // Parse the raw inputs into numbers once for reuse.
    const pv = Number(propertyValue)
    const dp = Number(downPayment)
    const years = Number(tenureYears)
    const rate = Number(interestRate)
    const tenureMonths = Number.isFinite(years) ? Math.round(years * 12) : 0
    const principal = pv - dp

    // ── Core computation (Req 10.1 / 10.6) ─────────────────────────────
    // Returns either a validation error or the full result set. Memoized so it
    // only recomputes when an input actually changes.
    const result = useMemo(() => {
        if (!Number.isFinite(pv) || pv <= 0) {
            return { error: 'Enter a valid property value greater than 0.' }
        }
        if (!Number.isFinite(dp) || dp < 0) {
            return { error: 'Enter a valid down payment of 0 or more.' }
        }
        // Down-payment guard (Req 10.6): reject down payment >= property value and
        // do NOT compute an EMI.
        if (!validateDownPayment(pv, dp)) {
            return { error: 'Down payment must be less than the property value.' }
        }
        if (!Number.isFinite(rate) || rate < 0) {
            return { error: 'Enter a valid interest rate of 0 or more.' }
        }
        if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
            return { error: 'Enter a valid loan tenure of at least 1 month.' }
        }
        try {
            const emi = computeEmi(principal, rate, tenureMonths)
            const interest = totalInterest(principal, rate, tenureMonths)
            const schedule = amortizationSchedule(principal, rate, tenureMonths)
            return {
                emi,
                interest,
                totalPayment: interest + principal, // principal + total interest
                schedule,
            }
        } catch (e) {
            return { error: e?.message || 'Unable to compute EMI for these inputs.' }
        }
    }, [pv, dp, rate, tenureMonths, principal])

    // Bank-rate comparison (Req 10.2): same principal + tenure, each lender rate.
    const bankComparison = useMemo(() => {
        if (result.error) return []
        return BANK_RATES.map(({ bank, rate: bankRate }) => {
            try {
                const emi = computeEmi(principal, bankRate, tenureMonths)
                const interest = totalInterest(principal, bankRate, tenureMonths)
                return { bank, rate: bankRate, emi, interest }
            } catch {
                return { bank, rate: bankRate, emi: null, interest: null }
            }
        })
    }, [result.error, principal, tenureMonths])

    // ── Shareable link (Req 10.5) ──────────────────────────────────────
    const shareUrl = useMemo(() => {
        if (typeof window === 'undefined') return ''
        const params = new URLSearchParams({
            pv: String(propertyValue),
            dp: String(downPayment),
            ty: String(tenureYears),
            rate: String(interestRate),
        })
        return `${window.location.origin}${window.location.pathname}?${params.toString()}`
    }, [propertyValue, downPayment, tenureYears, interestRate])

    const handleCopyLink = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard may be unavailable; surface the link so it can be copied manually.
            window.prompt('Copy this shareable link:', shareUrl)
        }
    }, [shareUrl])

    const whatsappUrl = useMemo(() => {
        if (result.error) return ''
        const lines = [
            '*EMI Calculation*',
            `Property Value: ${fmt(pv)}`,
            `Down Payment: ${fmt(dp)}`,
            `Loan Amount: ${fmt(principal)}`,
            `Tenure: ${tenureYears} years @ ${interestRate}%`,
            `Monthly EMI: ${fmt(result.emi)}`,
            `Total Interest: ${fmt(result.interest)}`,
            '',
            shareUrl,
        ]
        return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
    }, [result, pv, dp, principal, tenureYears, interestRate, shareUrl])

    // ── Save to deal (Req 10.4) ────────────────────────────────────────
    const openSaveModal = useCallback(() => {
        setSaveMessage(null)
        setShowSaveModal(true)
        setDealsLoading(true)
        listDealsForCalculator().then((res) => {
            if (res.success) setDeals(res.data)
            setDealsLoading(false)
        })
    }, [])

    const handleSaveToDeal = useCallback(async () => {
        if (!selectedDealId) {
            setSaveMessage({ type: 'error', text: 'Select a deal to save this calculation.' })
            return
        }
        if (result.error) {
            setSaveMessage({ type: 'error', text: 'Fix the calculation before saving.' })
            return
        }
        setSaving(true)
        const calculation = {
            propertyValue: pv,
            downPayment: dp,
            loanAmount: principal,
            tenureMonths,
            tenureYears: years,
            interestRate: rate,
            monthlyEmi: result.emi,
            totalInterest: result.interest,
            totalPayment: result.totalPayment,
        }
        const res = await saveEmiCalculationToDeal(Number(selectedDealId), calculation)
        setSaving(false)
        if (res.success) {
            setSaveMessage({ type: 'success', text: 'Calculation saved to the deal.' })
            setTimeout(() => setShowSaveModal(false), 1200)
        } else {
            setSaveMessage({ type: 'error', text: res.error || 'Failed to save calculation.' })
        }
    }, [selectedDealId, result, pv, dp, principal, tenureMonths, years, rate])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-accent/10 text-accent">
                    <Calculator className="w-6 h-6" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-foreground">EMI &amp; Affordability Calculator</h1>
                    <p className="text-sm text-muted">Compute home-loan EMIs, compare bank rates, and share with buyers.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Inputs ─────────────────────────────────────────── */}
                <div className="glass-card p-5 space-y-4">
                    <h2 className="text-sm font-bold text-muted uppercase tracking-wider">Inputs</h2>

                    <Field label="Property Value (AED )">
                        <input
                            type="number" min="0" value={propertyValue}
                            onChange={(e) => setPropertyValue(e.target.value)}
                            className={INPUT_CLS} placeholder="e.g. 5000000"
                        />
                    </Field>

                    <Field label="Down Payment (AED )">
                        <input
                            type="number" min="0" value={downPayment}
                            onChange={(e) => setDownPayment(e.target.value)}
                            className={INPUT_CLS} placeholder="e.g. 1000000"
                        />
                    </Field>

                    <Field label="Loan Tenure (years)">
                        <input
                            type="number" min="0" step="0.5" value={tenureYears}
                            onChange={(e) => setTenureYears(e.target.value)}
                            className={INPUT_CLS} placeholder="e.g. 20"
                        />
                    </Field>

                    <Field label="Interest Rate (% per annum)">
                        <input
                            type="number" min="0" step="0.05" value={interestRate}
                            onChange={(e) => setInterestRate(e.target.value)}
                            className={INPUT_CLS} placeholder="e.g. 8.5"
                        />
                    </Field>

                    {/* Down-payment / input validation error (Req 10.6) */}
                    {result.error && (
                        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span>{result.error}</span>
                        </div>
                    )}

                    {!result.error && (
                        <p className="text-xs text-muted">
                            Loan amount (financed): <span className="text-foreground font-medium">{fmt(principal)}</span>
                        </p>
                    )}
                </div>

                {/* ── Results ────────────────────────────────────────── */}
                <div className="lg:col-span-2 space-y-6">
                    {!result.error && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <ResultCard label="Monthly EMI" value={fmt(result.emi)} color="text-accent" />
                                <ResultCard label="Total Interest" value={fmt(result.interest)} color="text-amber-400" />
                                <ResultCard label="Total Payment" value={fmt(result.totalPayment)} color="text-emerald-400" />
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap gap-3">
                                <button onClick={openSaveModal} className={BTN_SECONDARY}>
                                    <Save className="w-4 h-4" /> Save to Deal
                                </button>
                                <button onClick={handleCopyLink} className={BTN_SECONDARY}>
                                    {copied ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Link2 className="w-4 h-4" />}
                                    {copied ? 'Link Copied' : 'Copy Shareable Link'}
                                </button>
                                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                                    <MessageCircle className="w-4 h-4 text-emerald-400" /> Share on WhatsApp
                                </a>
                            </div>

                            {/* Bank-rate comparison (Req 10.2) */}
                            <div className="glass-card p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <Landmark className="w-4 h-4 text-muted" />
                                    <h2 className="text-sm font-bold text-foreground">Bank Rate Comparison</h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                                                <th className="text-left py-2 font-semibold">Bank</th>
                                                <th className="text-right py-2 font-semibold">Rate</th>
                                                <th className="text-right py-2 font-semibold">Monthly EMI</th>
                                                <th className="text-right py-2 font-semibold">Total Interest</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bankComparison.map((row) => (
                                                <tr key={row.bank} className="border-b border-border/50">
                                                    <td className="py-2 text-foreground font-medium">{row.bank}</td>
                                                    <td className="py-2 text-right text-muted">{row.rate}%</td>
                                                    <td className="py-2 text-right text-foreground">{row.emi != null ? fmt(row.emi) : '—'}</td>
                                                    <td className="py-2 text-right text-muted">{row.interest != null ? fmt(row.interest) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Amortization schedule (Req 10.1) */}
                            <div className="glass-card p-5">
                                <button
                                    onClick={() => setShowSchedule((s) => !s)}
                                    className="flex items-center justify-between w-full text-left"
                                >
                                    <h2 className="text-sm font-bold text-foreground">Amortization Schedule</h2>
                                    {showSchedule ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
                                </button>
                                {showSchedule && (
                                    <div className="overflow-x-auto mt-3 max-h-96 overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-surface">
                                                <tr className="text-xs text-muted uppercase tracking-wider border-b border-border">
                                                    <th className="text-left py-2 font-semibold">Month</th>
                                                    <th className="text-right py-2 font-semibold">Payment</th>
                                                    <th className="text-right py-2 font-semibold">Principal</th>
                                                    <th className="text-right py-2 font-semibold">Interest</th>
                                                    <th className="text-right py-2 font-semibold">Balance</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.schedule.map((row) => (
                                                    <tr key={row.month} className="border-b border-border/30">
                                                        <td className="py-1.5 text-muted">{row.month}</td>
                                                        <td className="py-1.5 text-right text-foreground">{fmt(row.payment)}</td>
                                                        <td className="py-1.5 text-right text-emerald-400">{fmt(row.principal)}</td>
                                                        <td className="py-1.5 text-right text-amber-400">{fmt(row.interest)}</td>
                                                        <td className="py-1.5 text-right text-muted">{fmt(row.balance)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {result.error && (
                        <div className="glass-card p-8 flex flex-col items-center justify-center text-center text-muted">
                            <AlertCircle className="w-8 h-8 mb-2 text-red-400" />
                            <p className="text-sm">{result.error}</p>
                            <p className="text-xs mt-1">Adjust the inputs to see the EMI, schedule, and bank comparison.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Save-to-deal modal (Req 10.4) ──────────────────────── */}
            <Modal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} title="Save Calculation to Deal">
                <div className="p-5 space-y-4">
                    <p className="text-sm text-muted">
                        The calculation is stored as JSON on the selected deal&apos;s record.
                    </p>
                    <Field label="Deal">
                        {dealsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted py-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading deals…
                            </div>
                        ) : (
                            <select
                                value={selectedDealId}
                                onChange={(e) => setSelectedDealId(e.target.value)}
                                className={INPUT_CLS}
                            >
                                <option value="">Select a deal…</option>
                                {deals.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        #{d.id} · {d.contactName} · {fmt(d.value)}{d.stageName ? ` · ${d.stageName}` : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>

                    {!dealsLoading && deals.length === 0 && (
                        <p className="text-xs text-amber-400">No deals available to attach this calculation to.</p>
                    )}

                    {saveMessage && (
                        <div className={`flex items-start gap-2 text-sm rounded-lg p-3 ${saveMessage.type === 'success'
                            ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                            : 'text-red-400 bg-red-500/10 border border-red-500/20'
                            }`}>
                            {saveMessage.type === 'success' ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
                            <span>{saveMessage.text}</span>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={() => setShowSaveModal(false)} className={BTN_GHOST}>Cancel</button>
                        <button onClick={handleSaveToDeal} disabled={saving || !selectedDealId} className={BTN_PRIMARY}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

// Small presentational helpers ------------------------------------------------

function Field({ label, children }) {
    return (
        <label className="block">
            <span className="text-xs text-muted mb-1 block">{label}</span>
            {children}
        </label>
    )
}

function ResultCard({ label, value, color }) {
    return (
        <div className="glass-card p-4">
            <p className="text-xs text-muted mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
    )
}
