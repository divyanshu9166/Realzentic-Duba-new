'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Banknote, FileText, Plus, Receipt, RefreshCw } from 'lucide-react'
import {
  createCommission, createContract, createInvoice, createInvoiceCreditNote, createVendorBill,
  generateContractDocument, generateInvoiceDocument, getBillingWorkspace, recordInvoicePayment,
  recordVendorBillPayment, updateCommissionStatus, updateContractStatus, updateInvoiceStatus,
  updateVendorBillStatus,
} from '@/app/actions/billing'
import ESignatureModal from '@/app/(dashboard)/documents/ESignatureModal'

const TAX_OPTIONS = [
  ['STANDARD_5', 'Standard-rated VAT (5%)'],
  ['ZERO_RATED', 'Zero-rated (0%)'],
  ['EXEMPT', 'VAT exempt'],
  ['OUT_OF_SCOPE', 'Out of scope'],
] as const

const money = (value: unknown) => `AED ${Number(value ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function BillingClient() {
  const [data, setData] = useState<any>({ invoices: [], contracts: [], commissions: [], vendorBills: [], contacts: [], staff: [], vendors: [] })
  const [tab, setTab] = useState('invoices')
  const [message, setMessage] = useState('')
  const [invoice, setInvoice] = useState<any>({ contactId: '', type: 'SERVICE', taxTreatment: 'STANDARD_5', supplyDate: '', dueDate: '', description: '', amount: '' })
  const [payment, setPayment] = useState<any>({ invoiceId: '', amount: '', method: 'Bank Transfer', reference: '' })
  const [contract, setContract] = useState<any>({ title: '', type: 'SERVICE', contactId: '', status: 'DRAFT', notes: '' })
  const [commission, setCommission] = useState<any>({ beneficiaryType: 'AGENT', staffId: '', basisAmount: '', rate: '', amount: '', brokerageAgreementRef: '', dldRegistrationDate: '', payoutEligibleAt: '', eligibilityNote: '', notes: '' })
  const [signingContract, setSigningContract] = useState<any>(null)
  const [bill, setBill] = useState<any>({ vendorId: '', vendorName: '', vendorPhone: '', description: '', category: 'Operations', amount: '', vatRate: 5, dueDate: '', notes: '' })
  const [billPayment, setBillPayment] = useState<any>({ vendorBillId: '', amount: '', method: 'Bank Transfer', reference: '' })

  const load = useCallback(async () => {
    const result = await getBillingWorkspace()
    if (result.success) setData(result.data)
    else setMessage(result.error ?? 'Could not load billing workspace')
  }, [])

  // Initial data hydration intentionally crosses the server-action boundary.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function createInv(event: FormEvent) {
    event.preventDefault()
    const result = await createInvoice({
      contactId: invoice.contactId ? Number(invoice.contactId) : null,
      type: invoice.type,
      taxTreatment: invoice.taxTreatment,
      vatRate: invoice.taxTreatment === 'STANDARD_5' ? 5 : 0,
      supplyDate: invoice.supplyDate,
      dueDate: invoice.dueDate,
      lineItems: [{ description: invoice.description, quantity: 1, unitPrice: Number(invoice.amount) }],
    })
    setMessage(result.success ? 'Invoice created with UAE VAT treatment.' : result.error ?? 'Could not create invoice')
    if (result.success) { setInvoice({ ...invoice, description: '', amount: '' }); await load() }
  }

  async function creditInvoice(id: number) {
    const reason = window.prompt('Reason for issuing the tax credit note')
    if (!reason?.trim()) return
    const result = await createInvoiceCreditNote(id, reason)
    setMessage(result.success ? 'Tax credit note issued.' : result.error ?? 'Could not issue credit note')
    if (result.success) await load()
  }

  async function pay(event: FormEvent) {
    event.preventDefault()
    const result = await recordInvoicePayment({ ...payment, invoiceId: Number(payment.invoiceId), amount: Number(payment.amount) })
    setMessage(result.success ? 'Payment recorded and invoice balance updated.' : result.error ?? 'Could not record payment')
    if (result.success) { setPayment({ ...payment, amount: '', reference: '' }); await load() }
  }

  async function createCtr(event: FormEvent) {
    event.preventDefault()
    const result = await createContract({ ...contract, contactId: contract.contactId ? Number(contract.contactId) : null })
    setMessage(result.success ? 'Contract record created.' : result.error ?? 'Could not create contract')
    if (result.success) { setContract({ ...contract, title: '', notes: '' }); await load() }
  }

  async function createCom(event: FormEvent) {
    event.preventDefault()
    const result = await createCommission({
      ...commission,
      staffId: commission.beneficiaryType === 'AGENT' ? Number(commission.staffId) : null,
      basisAmount: Number(commission.basisAmount), rate: Number(commission.rate), amount: Number(commission.amount),
    })
    setMessage(result.success ? 'Commission ledger entry created.' : result.error ?? 'Could not create commission')
    if (result.success) await load()
  }

  async function createBill(event: FormEvent) {
    event.preventDefault()
    const result = await createVendorBill({ ...bill, vendorId: bill.vendorId ? Number(bill.vendorId) : null, amount: Number(bill.amount), vatRate: Number(bill.vatRate) })
    setMessage(result.success ? 'Vendor bill created.' : result.error ?? 'Could not create vendor bill')
    if (result.success) { setBill({ ...bill, vendorId: '', vendorName: '', vendorPhone: '', description: '', amount: '' }); await load() }
  }

  async function payBill(event: FormEvent) {
    event.preventDefault()
    const result = await recordVendorBillPayment({ ...billPayment, vendorBillId: Number(billPayment.vendorBillId), amount: Number(billPayment.amount) })
    setMessage(result.success ? 'Supplier payment recorded.' : result.error ?? 'Could not record supplier payment')
    if (result.success) { setBillPayment({ ...billPayment, amount: '', reference: '' }); await load() }
  }

  async function action(result: Promise<any>, success: string) {
    const response = await result
    setMessage(response.success ? success : response.error ?? 'Request failed')
    await load()
  }

  return <main className="space-y-6 p-4 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-500">Finance operations</p><h1 className="mt-1 text-3xl font-semibold">Billing &amp; Commissions</h1><p className="mt-2 text-sm text-muted">UAE-ready tax treatment, invoice evidence, payment reconciliation, and commission controls.</p></div><button onClick={() => void load()} className="rounded-lg border border-border p-2" aria-label="Refresh billing"><RefreshCw className="h-4 w-4" /></button></div>
    {message && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">{message}</div>}
    <div className="flex flex-wrap gap-2">{[['invoices', 'Invoices', Receipt], ['contracts', 'Contracts', FileText], ['commissions', 'Commissions', Banknote], ['bills', 'Vendor Bills', FileText]].map(([key, label, Icon]: any) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${tab === key ? 'bg-indigo-600 text-white' : 'border border-border'}`}><Icon className="h-4 w-4" />{label}</button>)}</div>

    {tab === 'invoices' && <><section className="grid gap-6 xl:grid-cols-2"><form onSubmit={createInv} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Plus className="h-5 w-5 text-indigo-500" /> Issue tax invoice</h2><p className="text-xs text-muted">Commercial/brokerage services are normally standard-rated. Select exempt or zero-rated only when the underlying supply qualifies.</p><div className="grid gap-3 sm:grid-cols-2"><select value={invoice.contactId} onChange={e => setInvoice({ ...invoice, contactId: e.target.value })} className="field"><option value="">Customer (optional)</option>{data.contacts.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={invoice.type} onChange={e => setInvoice({ ...invoice, type: e.target.value })} className="field"><option value="SERVICE">Service</option><option value="RENT">Rent</option><option value="SECURITY_DEPOSIT">Security deposit</option><option value="COMMISSION">Commission</option></select><select value={invoice.taxTreatment} onChange={e => setInvoice({ ...invoice, taxTreatment: e.target.value })} className="field sm:col-span-2">{TAX_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input required placeholder="Line item" value={invoice.description} onChange={e => setInvoice({ ...invoice, description: e.target.value })} className="field" /><input required type="number" min="1" step="1" placeholder="Amount (AED)" value={invoice.amount} onChange={e => setInvoice({ ...invoice, amount: e.target.value })} className="field" /><input type="date" value={invoice.supplyDate} onChange={e => setInvoice({ ...invoice, supplyDate: e.target.value })} className="field" /><input type="date" value={invoice.dueDate} onChange={e => setInvoice({ ...invoice, dueDate: e.target.value })} className="field" /></div><button className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white">Create invoice</button></form><form onSubmit={pay} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Record payment / receipt</h2><select required value={payment.invoiceId} onChange={e => { const selected = data.invoices.find((item: any) => String(item.id) === e.target.value); setPayment({ ...payment, invoiceId: e.target.value, amount: selected?.balanceDue ?? '' }) }} className="field"><option value="">Select issued invoice</option>{data.invoices.filter((item: any) => Number(item.balanceDue) > 0 && ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'].includes(item.status)).map((item: any) => <option key={item.id} value={item.id}>{item.displayId} · {money(item.balanceDue)} due</option>)}</select><div className="grid gap-3 sm:grid-cols-2"><input required type="number" min="1" step="1" placeholder="Payment (AED)" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} className="field" /><select value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })} className="field"><option>Bank Transfer</option><option>Cash</option><option>Card</option><option>Cheque</option><option>PDC</option></select></div><input placeholder="Bank / receipt reference" value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} className="field" /><button className="rounded-lg border border-border px-4 py-2.5 text-sm">Record payment</button></form></section><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">Invoice register</h2><div className="space-y-3">{data.invoices.map((item: any) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"><div><p className="font-medium">{item.displayId} · {item.contactName ?? 'Unassigned customer'}</p><p className="mt-1 text-xs text-muted">{item.type} · {item.taxLabel} · Total {money(item.total)} · Balance {money(item.balanceDue)}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{item.status}</span><button onClick={() => void action(generateInvoiceDocument(item.id, 'invoice'), 'Invoice PDF generated.')} className="rounded-md border border-border px-3 py-1.5 text-xs">PDF</button>{item.type !== 'CREDIT_NOTE' && item.status !== 'VOID' && <button onClick={() => void creditInvoice(item.id)} className="rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-700">Credit note</button>}{item.status !== 'PAID' && item.status !== 'VOID' && item.type !== 'CREDIT_NOTE' && <button onClick={() => void action(updateInvoiceStatus(item.id, 'VOID'), 'Invoice voided.')} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600">Void</button>}</div></div>)}{data.invoices.length === 0 && <p className="text-sm text-muted">No invoices yet.</p>}</div></section></>}

    {tab === 'contracts' && <><form onSubmit={createCtr} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Plus className="h-5 w-5 text-indigo-500" /> Create contract record</h2><div className="grid gap-3 md:grid-cols-4"><input required placeholder="Contract title" value={contract.title} onChange={e => setContract({ ...contract, title: e.target.value })} className="field" /><select value={contract.type} onChange={e => setContract({ ...contract, type: e.target.value })} className="field"><option>SERVICE</option><option>SALE</option><option>LEASE</option><option>RENEWAL</option></select><select value={contract.contactId} onChange={e => setContract({ ...contract, contactId: e.target.value })} className="field"><option value="">Customer</option>{data.contacts.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input placeholder="Notes" value={contract.notes} onChange={e => setContract({ ...contract, notes: e.target.value })} className="field" /></div><button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white">Create contract</button></form><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">Contract register</h2><div className="space-y-3">{data.contracts.map((item: any) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"><div><p className="font-medium">{item.displayId} · {item.title}</p><p className="text-xs text-muted">{item.type} · {item.contactName ?? 'No customer linked'}{item.fileUrl ? ' · PDF ready' : ''}{item.status === 'SIGNED' ? ' · Signed' : ''}</p></div><div className="flex flex-wrap items-center gap-2"><button onClick={() => void action(generateContractDocument(item.id), 'Contract PDF generated.')} className="rounded-md border border-border px-3 py-1.5 text-xs">Generate PDF</button>{item.status !== 'SIGNED' && item.contactId && <button onClick={() => setSigningContract(item)} className="rounded-md border border-indigo-200 px-3 py-1.5 text-xs text-indigo-700">Capture signature</button>}<select value={item.status} onChange={e => void action(updateContractStatus(item.id, e.target.value), 'Contract status updated.')} className="field max-w-[160px]"><option>DRAFT</option><option>SENT</option><option>SIGNED</option><option>EXPIRED</option><option>CANCELLED</option></select></div></div>)}</div></section></>}

    {tab === 'commissions' && <><form onSubmit={createCom} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Plus className="h-5 w-5 text-indigo-500" /> Add commission ledger entry</h2><p className="text-xs text-muted">DLD/RERA evidence is recorded before an agent commission can be marked paid. The brokerage agreement should state the rate and parties.</p><div className="grid gap-3 md:grid-cols-4"><select value={commission.beneficiaryType} onChange={e => setCommission({ ...commission, beneficiaryType: e.target.value })} className="field"><option>AGENT</option><option>COMPANY</option></select><select value={commission.staffId} disabled={commission.beneficiaryType === 'COMPANY'} onChange={e => setCommission({ ...commission, staffId: e.target.value })} className="field"><option value="">Agent</option>{data.staff.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input required type="number" min="1" step="1" placeholder="Basis AED" value={commission.basisAmount} onChange={e => setCommission({ ...commission, basisAmount: e.target.value })} className="field" /><input required type="number" min="0" max="100" step="0.01" placeholder="Rate %" value={commission.rate} onChange={e => setCommission({ ...commission, rate: e.target.value, amount: commission.basisAmount ? Math.round(Number(commission.basisAmount) * Number(e.target.value) / 100) : '' })} className="field" /><input required type="number" min="1" step="1" placeholder="Amount AED" value={commission.amount} onChange={e => setCommission({ ...commission, amount: e.target.value })} className="field" /><input placeholder="Signed brokerage agreement ref" value={commission.brokerageAgreementRef} onChange={e => setCommission({ ...commission, brokerageAgreementRef: e.target.value })} className="field" /><input type="date" placeholder="DLD registration date" value={commission.dldRegistrationDate} onChange={e => setCommission({ ...commission, dldRegistrationDate: e.target.value })} className="field" /><input type="date" placeholder="Approved payout date" value={commission.payoutEligibleAt} onChange={e => setCommission({ ...commission, payoutEligibleAt: e.target.value })} className="field" /></div><input placeholder="Compliance note" value={commission.eligibilityNote} onChange={e => setCommission({ ...commission, eligibilityNote: e.target.value })} className="field" /><button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white">Create commission</button></form><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">Commission ledger</h2><div className="space-y-3">{data.commissions.map((item: any) => <div key={item.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{item.displayId} · {item.beneficiaryType === 'AGENT' ? item.staffName : 'Company'}</p><p className="text-xs text-muted">{money(item.amount)} · {item.rate}% of {money(item.basisAmount)} · {item.eligibilityStatus}</p>{item.brokerageAgreementRef && <p className="text-xs text-muted">Agreement: {item.brokerageAgreementRef}{item.dldRegistrationDate ? ` · DLD registered ${item.dldRegistrationDate.slice(0, 10)}` : ''}</p>}</div><select value={item.status} onChange={e => void action(updateCommissionStatus(item.id, e.target.value), 'Commission status updated.')} className="field max-w-[150px]"><option>PENDING</option><option>APPROVED</option><option>PAID</option><option>VOID</option></select></div></div>)}</div></section></>}

    {tab === 'bills' && <><section className="grid gap-6 xl:grid-cols-2"><form onSubmit={createBill} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Record vendor bill</h2><div className="grid gap-3 sm:grid-cols-2"><select value={bill.vendorId} onChange={e => { const selected = data.vendors.find((item: any) => String(item.id) === e.target.value); setBill({ ...bill, vendorId: e.target.value, vendorName: selected?.name ?? bill.vendorName, vendorPhone: selected?.phone ?? bill.vendorPhone }) }} className="field sm:col-span-2"><option value="">Select registered vendor (optional)</option>{data.vendors.map((item: any) => <option key={item.id} value={item.id}>{item.name}{item.phone ? ` · ${item.phone}` : ''}</option>)}</select><input required placeholder="Vendor / supplier" value={bill.vendorName} onChange={e => setBill({ ...bill, vendorName: e.target.value, vendorId: '' })} className="field" /><input placeholder="Vendor phone" value={bill.vendorPhone} onChange={e => setBill({ ...bill, vendorPhone: e.target.value })} className="field" /><input required placeholder="Description" value={bill.description} onChange={e => setBill({ ...bill, description: e.target.value })} className="field sm:col-span-2" /><input required type="number" min="0.01" step="0.01" placeholder="Subtotal (AED)" value={bill.amount} onChange={e => setBill({ ...bill, amount: e.target.value })} className="field" /><input type="number" min="0" max="100" step="0.01" value={bill.vatRate} onChange={e => setBill({ ...bill, vatRate: e.target.value })} className="field" /><input type="date" value={bill.dueDate} onChange={e => setBill({ ...bill, dueDate: e.target.value })} className="field" /></div><button className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white">Create vendor bill</button></form><form onSubmit={payBill} className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Record supplier payment</h2><select required value={billPayment.vendorBillId} onChange={e => { const selected = data.vendorBills.find((item: any) => String(item.id) === e.target.value); setBillPayment({ ...billPayment, vendorBillId: e.target.value, amount: selected?.balanceDue ?? '' }) }} className="field"><option value="">Select outstanding bill</option>{data.vendorBills.filter((item: any) => Number(item.balanceDue) > 0 && item.status !== 'VOID').map((item: any) => <option key={item.id} value={item.id}>{item.displayId} · {item.vendorName} · {money(item.balanceDue)}</option>)}</select><div className="grid gap-3 sm:grid-cols-2"><input required type="number" min="0.01" step="0.01" placeholder="Payment (AED)" value={billPayment.amount} onChange={e => setBillPayment({ ...billPayment, amount: e.target.value })} className="field" /><select value={billPayment.method} onChange={e => setBillPayment({ ...billPayment, method: e.target.value })} className="field"><option>Bank Transfer</option><option>Cash</option><option>Card</option><option>Cheque</option></select></div><input placeholder="Bank / supplier reference" value={billPayment.reference} onChange={e => setBillPayment({ ...billPayment, reference: e.target.value })} className="field" /><button className="rounded-lg border border-border px-4 py-2.5 text-sm">Record payment</button></form></section><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">Accounts payable register</h2><div className="space-y-3">{data.vendorBills.map((item: any) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"><div><p className="font-medium">{item.displayId} · {item.vendorName}</p><p className="text-xs text-muted">{item.description} · Total {money(item.total)} · Balance {money(item.balanceDue)}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{item.status}</span>{item.status !== 'PAID' && item.status !== 'VOID' && <button onClick={() => void action(updateVendorBillStatus(item.id, 'VOID'), 'Vendor bill voided.')} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600">Void</button>}</div></article>)}{data.vendorBills.length === 0 && <p className="text-sm text-muted">No vendor bills recorded yet.</p>}</div></section></>}

    <ESignatureModal isOpen={Boolean(signingContract)} onClose={() => setSigningContract(null)} contractId={signingContract?.id} contactId={signingContract?.contactId ?? undefined} signerName={signingContract?.contactName ?? ''} onSigned={() => { setMessage('Contract signed and linked successfully.'); setSigningContract(null); void load() }} />
  </main>
}
