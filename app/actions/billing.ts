'use server'

import { jsPDF } from 'jspdf'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { uploadFile } from '@/lib/r2'
import { contractSchema, commissionSchema, invoicePaymentSchema, invoiceSchema } from '@/lib/validations/billing'
import { vendorBillPaymentSchema, vendorBillSchema } from '@/lib/validations/vendor-bill'

function displayId(prefix: string) {
  return `${prefix}-DXB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

async function nextInvoiceDisplayId(tx: any) {
  const settings = await tx.storeSettings.findFirst({ select: { invoicePrefix: true, invoicePadding: true } })
  const sequence = await tx.invoiceNumberSequence.upsert({ where: { id: 1 }, update: { nextNumber: { increment: 1 } }, create: { id: 1, nextNumber: 2 } })
  const number = Math.max(1, sequence.nextNumber - 1)
  const prefix = (settings?.invoicePrefix?.trim() || 'INV').replace(/-+$/, '')
  const padding = Math.max(1, Math.min(12, settings?.invoicePadding ?? 6))
  return `${prefix}-DXB-${new Date().getFullYear()}-${String(number).padStart(padding, '0')}`
}

function dateOrNull(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function mapInvoice(invoice: any) {
  return {
    id: invoice.id, displayId: invoice.displayId, contactId: invoice.contactId, contactName: invoice.contact?.name ?? null,
    dealId: invoice.dealId, rentalDealId: invoice.rentalDealId, leaseId: invoice.leaseId, type: invoice.type,
    status: invoice.status, issueDate: invoice.issueDate.toISOString(), dueDate: invoice.dueDate?.toISOString() ?? null,
    subtotal: invoice.subtotal, vatAmount: invoice.vatAmount, total: invoice.total, balanceDue: invoice.balanceDue,
    lineItems: invoice.lineItems, notes: invoice.notes, fileUrl: invoice.fileUrl,
  }
}

function mapContract(contract: any) {
  return {
    id: contract.id, displayId: contract.displayId, title: contract.title, type: contract.type, status: contract.status,
    contactId: contract.contactId, contactName: contract.contact?.name ?? null, dealId: contract.dealId,
    rentalDealId: contract.rentalDealId, leaseId: contract.leaseId, invoiceId: contract.invoiceId,
    fileUrl: contract.fileUrl, signedFileUrl: contract.signedFileUrl, signedAt: contract.signedAt?.toISOString() ?? null,
    expiresAt: contract.expiresAt?.toISOString() ?? null, notes: contract.notes,
  }
}

function mapCommission(commission: any) {
  return {
    id: commission.id, displayId: commission.displayId, beneficiaryType: commission.beneficiaryType,
    staffId: commission.staffId, staffName: commission.staff?.name ?? null, dealId: commission.dealId,
    rentalDealId: commission.rentalDealId, invoiceId: commission.invoiceId, basisAmount: commission.basisAmount,
    rate: commission.rate, amount: commission.amount, status: commission.status,
    approvedAt: commission.approvedAt?.toISOString() ?? null, paidAt: commission.paidAt?.toISOString() ?? null,
    paymentReference: commission.paymentReference, notes: commission.notes, sourceKey: commission.sourceKey ?? null,
    reversalOfId: commission.reversalOfId ?? null,
    splits: (commission.splits ?? []).map((split: any) => ({ id: split.id, beneficiaryType: split.beneficiaryType, staffId: split.staffId, amount: split.amount, rate: split.rate, notes: split.notes })),
  }
}

function mapVendorBill(bill: any) {
  return { id: bill.id, displayId: bill.displayId, vendorId: bill.vendorId ?? null, vendorName: bill.vendor?.name ?? bill.vendorName, vendorPhone: bill.vendor?.phone ?? bill.vendorPhone, description: bill.description, category: bill.category, issueDate: bill.issueDate.toISOString(), dueDate: bill.dueDate?.toISOString() ?? null, status: bill.status, subtotal: bill.subtotal, vatAmount: bill.vatAmount, total: bill.total, balanceDue: bill.balanceDue, notes: bill.notes }
}

const invoiceInclude = { contact: { select: { name: true } } } as const
const contractInclude = { contact: { select: { name: true } } } as const
const commissionInclude = { staff: { select: { name: true } }, splits: true } as const
const vendorBillInclude = { vendor: { select: { id: true, name: true, phone: true } } } as const

async function validateInvoiceReferences(input: { contactId?: number | null; dealId?: number | null; rentalDealId?: number | null; leaseId?: number | null }) {
  if (input.contactId != null && !(await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) return 'Contact not found'
  if (input.dealId != null && !(await prisma.deal.findUnique({ where: { id: input.dealId }, select: { id: true } }))) return 'Sale deal not found'
  if (input.rentalDealId != null && !(await prisma.rentalDeal.findUnique({ where: { id: input.rentalDealId }, select: { id: true } }))) return 'Rental deal not found'
  if (input.leaseId != null && !(await prisma.lease.findUnique({ where: { id: input.leaseId }, select: { id: true } }))) return 'Lease not found'
  return null
}

export async function getBillingWorkspace() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const [invoices, contracts, commissions, vendorBills, contacts, staff, vendors] = await Promise.all([
      prisma.invoice.findMany({ include: invoiceInclude, orderBy: { issueDate: 'desc' }, take: 500 }),
      prisma.contract.findMany({ include: contractInclude, orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.commissionLedger.findMany({ include: commissionInclude, orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.vendorBill.findMany({ include: vendorBillInclude, orderBy: { issueDate: 'desc' }, take: 500 }),
      prisma.contact.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' }, take: 1000 }),
      prisma.staff.findMany({ where: { status: { not: 'Inactive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.maintenanceVendor.findMany({ where: { active: true }, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } }),
    ])
    return { success: true, data: { invoices: invoices.map(mapInvoice), contracts: contracts.map(mapContract), commissions: commissions.map(mapCommission), vendorBills: vendorBills.map(mapVendorBill), contacts, staff, vendors } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function createVendorBill(data: unknown) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER')
    const parsed = vendorBillSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid vendor bill' }
    const input = parsed.data; const dueDate = dateOrNull(input.dueDate)
    if (input.dueDate && !dueDate) return { success: false, error: 'Due date is invalid' }
    const subtotal = Math.round(input.amount); const vatAmount = Math.round(subtotal * input.vatRate / 100); const total = subtotal + vatAmount
    if (input.vendorId && !(await prisma.maintenanceVendor.findFirst({ where: { id: input.vendorId, active: true }, select: { id: true } }))) return { success: false, error: 'Vendor not found' }
    const bill = await prisma.vendorBill.create({ data: { displayId: displayId('BILL'), vendorId: input.vendorId ?? null, vendorName: input.vendorName, vendorPhone: input.vendorPhone || null, description: input.description, category: input.category || null, dueDate, status: input.status, subtotal, vatAmount, total, balanceDue: total, notes: input.notes || null, createdById: Number(session.user.id) }, include: vendorBillInclude })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapVendorBill(bill) }
  } catch (error) { console.error('[billing] create vendor bill failed', error); return { success: false, error: 'Could not create vendor bill' } }
}

export async function recordVendorBillPayment(data: unknown) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER')
    const parsed = vendorBillPaymentSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid bill payment' }
    const input = parsed.data; const paymentDate = dateOrNull(input.date) ?? new Date()
    const result = await prisma.$transaction(async tx => {
      const bill = await tx.vendorBill.findUnique({ where: { id: input.vendorBillId } })
      if (!bill) throw new Error('Vendor bill not found')
      if (bill.status === 'VOID') throw new Error('Void bills cannot receive payments')
      if (input.amount > bill.balanceDue) throw new Error(`Payment exceeds the outstanding balance of AED ${bill.balanceDue}`)
      const payment = await tx.dailyPayment.create({ data: { displayId: displayId('PAY'), amount: input.amount, vatAmount: 0, type: 'OUT', method: input.method, reference: input.reference || null, date: paymentDate, status: 'Reconciled', receivedByStaffId: session.user.staffId ?? null, vendorBillId: bill.id, reconciled: true, reconciledDate: new Date() } })
      const balanceDue = bill.balanceDue - input.amount
      const updatedBill = await tx.vendorBill.update({ where: { id: bill.id }, data: { balanceDue, status: balanceDue === 0 ? 'PAID' : 'PARTIALLY_PAID' } })
      return { paymentId: payment.id, bill: updatedBill }
    })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: { paymentId: result.paymentId, bill: mapVendorBill(result.bill) } }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not record vendor bill payment' } }
}

export async function updateVendorBillStatus(id: number, status: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['DRAFT', 'ISSUED', 'OVERDUE', 'VOID']
    if (!Number.isInteger(id) || id <= 0 || !allowed.includes(status)) return { success: false, error: 'Invalid vendor bill status' }
    const bill = await prisma.vendorBill.update({ where: { id }, data: { status } })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapVendorBill(bill) }
  } catch { return { success: false, error: 'Could not update vendor bill status' } }
}

export async function createInvoice(data: unknown) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER')
    const parsed = invoiceSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid invoice' }
    const input = parsed.data
    const referenceError = await validateInvoiceReferences(input); if (referenceError) return { success: false, error: referenceError }
    const dueDate = dateOrNull(input.dueDate)
    if (input.dueDate && !dueDate) return { success: false, error: 'Due date is invalid' }
    const lineItems = input.lineItems.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: Math.round(item.quantity * item.unitPrice) }))
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const vatAmount = Math.round(subtotal * input.vatRate / 100)
    const total = subtotal + vatAmount
    const invoice = await prisma.$transaction(async tx => tx.invoice.create({ data: {
      displayId: await nextInvoiceDisplayId(tx), contactId: input.contactId ?? null, dealId: input.dealId ?? null, rentalDealId: input.rentalDealId ?? null,
      leaseId: input.leaseId ?? null, type: input.type, status: input.status, dueDate, subtotal, vatAmount, total, balanceDue: total,
      lineItems, notes: input.notes || null, createdById: Number(session.user.id),
    }, include: invoiceInclude }))
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapInvoice(invoice) }
  } catch (error) { console.error('[billing] create invoice failed', error); return { success: false, error: 'Could not create invoice' } }
}

export async function recordInvoicePayment(data: unknown) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER')
    const parsed = invoicePaymentSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payment' }
    const input = parsed.data; const paymentDate = dateOrNull(input.date) ?? new Date()
    if (input.date && !paymentDate) return { success: false, error: 'Payment date is invalid' }
    const result = await prisma.$transaction(async tx => {
      const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } })
      if (!invoice) throw new Error('Invoice not found')
      if (invoice.status === 'VOID') throw new Error('Void invoices cannot receive payments')
      if (input.amount > invoice.balanceDue) throw new Error(`Payment exceeds the outstanding balance of AED ${invoice.balanceDue}`)
      const payment = await tx.dailyPayment.create({ data: {
        displayId: displayId('PAY'), amount: input.amount, vatAmount: 0, type: 'IN', method: input.method,
        reference: input.reference || null, date: paymentDate, status: 'Reconciled', receivedByStaffId: session.user.staffId ?? null,
        contactId: invoice.contactId, invoiceId: invoice.id, customerName: null, reconciled: true, reconciledDate: new Date(),
      } })
      const balanceDue = invoice.balanceDue - input.amount
      const updatedInvoice = await tx.invoice.update({ where: { id: invoice.id }, data: { balanceDue, status: balanceDue === 0 ? 'PAID' : 'PARTIALLY_PAID' }, include: invoiceInclude })
      return { payment, invoice: updatedInvoice }
    })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: { invoice: mapInvoice(result.invoice), paymentId: result.payment.id } }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not record payment' } }
}

export async function updateInvoiceStatus(id: number, status: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['DRAFT', 'ISSUED', 'OVERDUE', 'VOID']
    if (!Number.isInteger(id) || id <= 0 || !allowed.includes(status)) return { success: false, error: 'Invalid invoice status' }
    const invoice = await prisma.invoice.update({ where: { id }, data: { status }, include: invoiceInclude })
    revalidatePath('/billing'); return { success: true, data: mapInvoice(invoice) }
  } catch { return { success: false, error: 'Could not update invoice status' } }
}

export async function generateInvoiceDocument(invoiceId: number, kind: 'invoice' | 'receipt' = 'invoice') {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: invoiceInclude })
    if (!invoice) return { success: false, error: 'Invoice not found' }
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    doc.setFontSize(18); doc.text(kind === 'receipt' ? 'PAYMENT RECEIPT' : 'TAX INVOICE', 20, 22)
    doc.setFontSize(10); doc.text(invoice.displayId, 20, 30); doc.text(`Issue date: ${invoice.issueDate.toISOString().slice(0, 10)}`, 20, 36)
    if (invoice.contact?.name) doc.text(`Customer: ${invoice.contact.name}`, 20, 42)
    let y = 56; doc.setFontSize(11)
    for (const item of invoice.lineItems as Array<{ description: string; quantity: number; unitPrice: number; amount: number }>) {
      doc.text(`${item.description} x ${item.quantity}`, 20, y); doc.text(`AED ${item.amount.toLocaleString()}`, 155, y); y += 7
    }
    y += 5; doc.text(`Subtotal: AED ${invoice.subtotal.toLocaleString()}`, 130, y); y += 7
    doc.text(`VAT: AED ${invoice.vatAmount.toLocaleString()}`, 130, y); y += 7
    doc.setFontSize(13); doc.text(`Total: AED ${invoice.total.toLocaleString()}`, 130, y); y += 7
    doc.setFontSize(10); doc.text(`Balance due: AED ${invoice.balanceDue.toLocaleString()}`, 130, y)
    const buffer = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
    const fileUrl = await uploadFile(buffer, `${invoice.displayId}-${kind}.pdf`, 'application/pdf', 'billing')
    await prisma.invoice.update({ where: { id: invoice.id }, data: { fileUrl } })
    revalidatePath('/billing'); return { success: true, data: { fileUrl } }
  } catch (error) { console.error('[billing] PDF generation failed', error); return { success: false, error: 'Could not generate billing document' } }
}

export async function createContract(data: unknown) {
  try {
    const session = await requireRole('ADMIN', 'MANAGER')
    const parsed = contractSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid contract' }
    const input = parsed.data; const expiresAt = dateOrNull(input.expiresAt)
    if (input.expiresAt && !expiresAt) return { success: false, error: 'Expiry date is invalid' }
    const refs = await validateInvoiceReferences(input); if (refs) return { success: false, error: refs }
    const contract = await prisma.contract.create({ data: {
      displayId: displayId('CTR'), title: input.title, type: input.type, status: input.status,
      contactId: input.contactId ?? null, dealId: input.dealId ?? null, rentalDealId: input.rentalDealId ?? null, leaseId: input.leaseId ?? null,
      invoiceId: input.invoiceId ?? null, fileUrl: input.fileUrl || null, expiresAt, notes: input.notes || null, createdById: Number(session.user.id),
    }, include: contractInclude })
    revalidatePath('/billing'); revalidatePath('/documents'); return { success: true, data: mapContract(contract) }
  } catch { return { success: false, error: 'Could not create contract record' } }
}

/** Generate a dedicated contract PDF and attach it to the billing contract. */
export async function generateContractDocument(contractId: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { contact: { select: { name: true, email: true, phone: true } }, lease: { select: { contractNumber: true, annualRent: true, startDate: true, endDate: true, ejariNumber: true } } } })
    if (!contract) return { success: false, error: 'Contract not found' }
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    doc.setFontSize(18); doc.text('REALZENTIC DUBAI — CONTRACT', 20, 22)
    doc.setFontSize(10); doc.text(contract.displayId, 20, 30); doc.text(`Created: ${contract.createdAt.toISOString().slice(0, 10)}`, 20, 36)
    doc.setFontSize(13); doc.text(contract.title, 20, 50)
    doc.setFontSize(10); doc.text(`Type: ${contract.type}`, 20, 58); doc.text(`Status: ${contract.status}`, 20, 64)
    let y = 76
    if (contract.contact) { doc.text(`Customer: ${contract.contact.name}`, 20, y); y += 6; if (contract.contact.email) { doc.text(`Email: ${contract.contact.email}`, 20, y); y += 6 } if (contract.contact.phone) { doc.text(`Phone: ${contract.contact.phone}`, 20, y); y += 6 } }
    if (contract.lease) { y += 4; doc.text(`Lease: ${contract.lease.contractNumber}`, 20, y); y += 6; doc.text(`Term: ${contract.lease.startDate.toISOString().slice(0, 10)} to ${contract.lease.endDate.toISOString().slice(0, 10)}`, 20, y); y += 6; doc.text(`Annual rent: AED ${contract.lease.annualRent.toLocaleString()}`, 20, y); y += 6; if (contract.lease.ejariNumber) { doc.text(`Ejari: ${contract.lease.ejariNumber}`, 20, y); y += 6 } }
    y += 8; doc.text('Notes / commercial terms:', 20, y); y += 7
    const lines = doc.splitTextToSize(contract.notes || 'No additional terms recorded.', 170) as string[]
    doc.text(lines, 20, y)
    const buffer = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
    const fileUrl = await uploadFile(buffer, `${contract.displayId}.pdf`, 'application/pdf', 'billing/contracts')
    await prisma.contract.update({ where: { id: contract.id }, data: { fileUrl } })
    revalidatePath('/billing'); revalidatePath('/documents')
    return { success: true, data: { fileUrl } }
  } catch (error) { console.error('[billing] contract PDF generation failed', error); return { success: false, error: 'Could not generate contract document' } }
}

export async function updateContractStatus(id: number, status: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED']
    if (!Number.isInteger(id) || id <= 0 || !allowed.includes(status)) return { success: false, error: 'Invalid contract status' }
    const contract = await prisma.contract.update({ where: { id }, data: { status, signedAt: status === 'SIGNED' ? new Date() : undefined }, include: contractInclude })
    revalidatePath('/billing'); return { success: true, data: mapContract(contract) }
  } catch { return { success: false, error: 'Could not update contract status' } }
}

export async function createCommission(data: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = commissionSchema.safeParse(data)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid commission' }
    const input = parsed.data
    if (input.beneficiaryType === 'AGENT' && !input.staffId) return { success: false, error: 'An agent is required for an agent commission' }
    if (Math.abs(input.amount - Math.round(input.basisAmount * input.rate / 100)) > 1) return { success: false, error: 'Commission amount must equal basis amount multiplied by rate' }
    if (input.staffId && !(await prisma.staff.findFirst({ where: { id: input.staffId, status: { not: 'Inactive' } }, select: { id: true } }))) return { success: false, error: 'Staff member not found' }
    const splitTotal = input.splits.reduce((sum, split) => sum + split.amount, 0)
    if (input.splits.length > 0 && splitTotal !== input.amount) return { success: false, error: 'Commission splits must add up to the ledger amount' }
    for (const split of input.splits) {
      if (split.beneficiaryType === 'AGENT' && !split.staffId) return { success: false, error: 'Every agent split needs a staff member' }
      if (split.staffId && !(await prisma.staff.findFirst({ where: { id: split.staffId, status: { not: 'Inactive' } }, select: { id: true } }))) return { success: false, error: 'Commission split staff member not found' }
    }
    const commission = await prisma.commissionLedger.create({ data: {
      displayId: displayId('COM'), beneficiaryType: input.beneficiaryType, staffId: input.beneficiaryType === 'AGENT' ? input.staffId : null,
      dealId: input.dealId ?? null, rentalDealId: input.rentalDealId ?? null, invoiceId: input.invoiceId ?? null,
      basisAmount: input.basisAmount, rate: input.rate, amount: input.amount, status: 'PENDING', notes: input.notes || null,
      splits: input.splits.length > 0 ? { create: input.splits.map(split => ({ beneficiaryType: split.beneficiaryType, staffId: split.beneficiaryType === 'AGENT' ? split.staffId : null, amount: split.amount, rate: split.rate, notes: split.notes || null })) } : undefined,
    }, include: commissionInclude })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapCommission(commission) }
  } catch { return { success: false, error: 'Could not create commission' } }
}

export async function updateCommissionStatus(id: number, status: string, paymentReference?: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const allowed = ['PENDING', 'APPROVED', 'PAID', 'VOID']
    if (!Number.isInteger(id) || !allowed.includes(status)) return { success: false, error: 'Invalid commission status' }
    const commission = await prisma.commissionLedger.update({ where: { id }, data: {
      status, approvedAt: status === 'APPROVED' ? new Date() : undefined, paidAt: status === 'PAID' ? new Date() : undefined,
      paymentReference: paymentReference?.trim() || undefined,
    }, include: commissionInclude })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapCommission(commission) }
  } catch { return { success: false, error: 'Could not update commission status' } }
}

/** Create a linked negative ledger entry instead of mutating paid history. */
export async function createCommissionClawback(id: number, notes?: string) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Invalid commission id' }
    const result = await prisma.$transaction(async tx => {
      const original = await tx.commissionLedger.findUnique({ where: { id }, include: commissionInclude })
      if (!original) throw new Error('Commission not found')
      if (original.status === 'VOID' || original.status === 'CLAWBACK') throw new Error('This commission cannot be clawed back')
      return tx.commissionLedger.upsert({ where: { sourceKey: `CLAWBACK:${original.id}` }, update: {}, create: {
        displayId: displayId('COM'), beneficiaryType: original.beneficiaryType, staffId: original.staffId, dealId: original.dealId,
        rentalDealId: original.rentalDealId, invoiceId: original.invoiceId, basisAmount: -original.basisAmount, rate: original.rate,
        amount: -original.amount, status: 'CLAWBACK', reversalOfId: original.id, sourceKey: `CLAWBACK:${original.id}`,
        notes: notes?.trim() || `Clawback of ${original.displayId}`,
      }, include: commissionInclude })
    })
    revalidatePath('/billing'); revalidatePath('/financials'); return { success: true, data: mapCommission(result) }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not create commission clawback' } }
}
