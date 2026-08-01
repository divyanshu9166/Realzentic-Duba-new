'use server';

import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

// Helper: Generate hash for duplicate detection
const generateReferenceHash = (method, reference) => {
  if (!reference || method === 'Cash') return null; // Cash doesn't need unique reference
  const normalizedMethod = String(method).trim().toLowerCase();
  const normalizedReference = String(reference).trim().toLowerCase();
  return crypto.createHash('md5').update(`${normalizedMethod}:${normalizedReference}`).digest('hex');
};

export async function getDailyPayments(filters = {}) {
  try {
    const { startDate, endDate, method, type, search, status, reconciled } = filters;
    const where = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      where.date = {
        gte: start,
        lte: end,
      };
    } else if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      where.date = { gte: start };
    }

    if (method && method !== 'All') where.method = method;
    if (type && type !== 'All') where.type = type;

    if (status && status !== 'All') where.status = status;
    if (reconciled !== undefined) where.reconciled = reconciled === true;
    if (filters.includeReversals !== true) where.isReversal = false;

    if (search) {
      where.OR = [
        { displayId: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const payments = await prisma.dailyPayment.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        receivedByStaff: { select: { id: true, name: true, email: true } },
      },
      orderBy: { date: 'desc' },
    });

    return { success: true, data: payments };
  } catch (error) {
    console.error('Error fetching daily payments:', error);
    return { success: false, error: 'Failed to fetch payments' };
  }
}

export async function createDailyPayment(data) {
  try {
    // Validation: Amount must be positive integer
    const amount = parseInt(data.amount);
    if (!amount || amount <= 0) return { success: false, error: 'Invalid amount. Must be greater than 0.' };

    // Validation: Payment method is required
    if (!data.method) return { success: false, error: 'Payment method is required.' };

    // Validation: For cheques, cheque number is mandatory
    if (data.method === 'Cheque' && !data.chequeNumber) {
      return { success: false, error: 'Cheque number is mandatory for cheque payments.' };
    }

    // Validation: Reference uniqueness (prevent duplicates for non-cash payments)
    if (data.reference && data.method !== 'Cash') {
      const hash = generateReferenceHash(data.method, data.reference);
      const duplicate = await prisma.dailyPayment.findFirst({
        where: {
          referenceHash: hash,
          isReversal: false,
        }
      });

      if (duplicate) {
        return {
          success: false,
          error: `A payment with ${data.method} reference "${data.reference}" already exists. Please use a different reference or mark as duplicate.`
        };
      }
    }

    // Validation: Cheque-specific validations
    if (data.method === 'Cheque') {
      if (data.chequeDate && new Date(data.chequeDate) < new Date()) {
        // Allow post-dated cheques
      }
      // Check for duplicate cheque numbers from same drawer
      const duplicateCheque = await prisma.dailyPayment.findFirst({
        where: {
          chequeNumber: data.chequeNumber,
          contactId: data.contactId,
          method: 'Cheque',
          isReversal: false,
        }
      });
      if (duplicateCheque) {
        return { success: false, error: 'Cheque number already exists for this contact.' };
      }
    }

    // Generate payment ID
    const count = await prisma.dailyPayment.count();
    const now = new Date();
    const displayId = `PAY-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}-${(count + 1).toString().padStart(4, '0')}`;

    let parsedDate = now;
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) parsedDate = d;
    }

    const referenceHash = generateReferenceHash(data.method, data.reference);

    // Create payment
    const payment = await prisma.dailyPayment.create({
      data: {
        displayId,
        amount,
        vatAmount: parseInt(data.vatAmount || 0),
        type: data.type || 'IN',
        method: data.method,
        reference: data.reference || null,
        referenceHash: referenceHash,
        date: parsedDate,
        status: 'Pending', // New payments start as Pending
        receivedByStaffId: data.receivedByStaffId ? parseInt(data.receivedByStaffId) : null,
        chequeNumber: data.chequeNumber || null,
        chequeDate: data.chequeDate ? new Date(data.chequeDate) : null,
        customerName: data.customerName || null,
        contactId: data.contactId ? parseInt(data.contactId) : null,
        // Plain Int references (no FK) — for future property/deal linking
        orderId: data.orderId ? parseInt(data.orderId) : null,
        invoiceId: data.invoiceId ? parseInt(data.invoiceId) : null,
        customOrderId: data.customOrderId ? parseInt(data.customOrderId) : null,
        notes: data.notes || null,
        attachment: data.attachment || null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        receivedByStaff: { select: { id: true, name: true, email: true } },
      }
    });

    revalidatePath('/payments');
    return { success: true, data: payment };
  } catch (error) {
    console.error('Error creating payment:', error.message, error.code);
    let errorMessage = 'Failed to create payment';
    if (error.code === 'P2003') {
      errorMessage = 'The Customer ID or Staff ID does not exist.';
    } else if (error.code === 'P2002') {
      errorMessage = 'A unique constraint was violated. This reference may already exist.';
    }
    return { success: false, error: errorMessage };
  }
}


export async function deleteDailyPayment(id) {
  try {
    await prisma.dailyPayment.delete({ where: { id: parseInt(id) } });
    revalidatePath('/payments');
    return { success: true };
  } catch (error) {
    console.error('Error deleting payment:', error);
    return { success: false, error: 'Failed to delete payment' };
  }
}

// NEW: Reverse a payment (creates audit trail)
export async function reversePayment(id, reason = '') {
  try {
    const original = await prisma.dailyPayment.findUnique({ where: { id: parseInt(id) } });
    if (!original) return { success: false, error: 'Payment not found' };
    if (original.isReversal) return { success: false, error: 'Cannot reverse an already reversed payment' };

    const count = await prisma.dailyPayment.count();
    const now = new Date();
    const displayId = `PAY-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}-${(count + 1).toString().padStart(4, '0')}`;

    // Create reversal entry (negative of original)
    const reversal = await prisma.dailyPayment.create({
      data: {
        displayId,
        amount: original.amount,
        vatAmount: original.vatAmount,
        type: original.type === 'IN' ? 'OUT' : 'IN', // Reverse the type
        method: original.method,
        reference: `REVERSAL-${original.reference || original.id}`,
        date: now,
        status: 'Reversed',
        reversalId: parseInt(id),
        isReversal: true,
        reversalReason: reason,
        customerName: original.customerName,
        contactId: original.contactId,
        notes: `Reversal of ${original.displayId}: ${reason}`,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        receivedByStaff: { select: { id: true, name: true, email: true } },
      }
    });

    // Mark original as reversed
    await prisma.dailyPayment.update({
      where: { id: parseInt(id) },
      data: { status: 'Reversed' }
    });

    revalidatePath('/payments');
    return { success: true, data: reversal };
  } catch (error) {
    console.error('Error reversing payment:', error);
    return { success: false, error: 'Failed to reverse payment' };
  }
}

// NEW: Mark cheque as bounced
export async function markChequeBounced(id, bounceReason = '') {
  try {
    const payment = await prisma.dailyPayment.findUnique({ where: { id: parseInt(id) } });
    if (!payment) return { success: false, error: 'Payment not found' };
    if (payment.method !== 'Cheque') return { success: false, error: 'Only cheque payments can be marked as bounced' };

    const updated = await prisma.dailyPayment.update({
      where: { id: parseInt(id) },
      data: {
        chequeBounced: true,
        bounceReason: bounceReason,
        status: 'Bounced',
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        receivedByStaff: { select: { id: true, name: true, email: true } },
      }
    });

    revalidatePath('/payments');
    return { success: true, data: updated };
  } catch (error) {
    console.error('Error marking cheque as bounced:', error);
    return { success: false, error: 'Failed to update cheque status' };
  }
}

// NEW: Reconcile payments (batch mark as reconciled)
export async function reconcilePayments(paymentIds, bankRefNumbers = {}) {
  try {
    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
      return { success: false, error: 'No payments selected for reconciliation' };
    }

    const updates = await Promise.all(
      paymentIds.map(id =>
        prisma.dailyPayment.update({
          where: { id: parseInt(id) },
          data: {
            reconciled: true,
            reconciledDate: new Date(),
            bankRefNumber: bankRefNumbers[id] || null,
            status: 'Reconciled'
          }
        })
      )
    );

    revalidatePath('/payments');
    return { success: true, count: updates.length };
  } catch (error) {
    console.error('Error reconciling payments:', error);
    return { success: false, error: 'Failed to reconcile payments' };
  }
}

// NEW: Get payment reconciliation summary
export async function getReconciliationSummary(filters = {}) {
  try {
    const { startDate, endDate, method } = filters;
    const where = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    if (method && method !== 'All') where.method = method;

    const unreconciled = await prisma.dailyPayment.findMany({
      where: { ...where, reconciled: false, isReversal: false },
      include: { contact: { select: { name: true } } }
    });

    const reconciled = await prisma.dailyPayment.findMany({
      where: { ...where, reconciled: true, isReversal: false },
      include: { contact: { select: { name: true } } }
    });

    const bouncedCheques = await prisma.dailyPayment.findMany({
      where: { ...where, chequeBounced: true },
      include: { contact: { select: { name: true } } }
    });

    return {
      success: true,
      data: {
        unreconciledCount: unreconciled.length,
        unreconciledAmount: unreconciled.reduce((s, p) => s + p.amount, 0),
        unreconciledList: unreconciled,
        reconciledCount: reconciled.length,
        reconciledAmount: reconciled.reduce((s, p) => s + p.amount, 0),
        bouncedChequeCount: bouncedCheques.length,
        bouncedChequeAmount: bouncedCheques.reduce((s, p) => s + p.amount, 0),
        bouncedCheques,
      }
    };
  } catch (error) {
    console.error('Error getting reconciliation summary:', error);
    return {
      success: true,
      data: {
        unreconciledCount: 0,
        unreconciledAmount: 0,
        unreconciledList: [],
        reconciledCount: 0,
        reconciledAmount: 0,
        bouncedChequeCount: 0,
        bouncedChequeAmount: 0,
        bouncedCheques: [],
      }
    };
  }
}

export async function getDailyCashRegister(date) {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let register = await prisma.dailyCashRegister.findUnique({
      where: { date: startOfDay },
    });

    if (!register) {
      register = await prisma.dailyCashRegister.create({
        data: {
          date: startOfDay,
          openingCash: 0,
        },
      });
    }

    // Recalculate cashIn / cashOut from DailyPayment and Expenses
    const payments = await prisma.dailyPayment.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay },
        method: 'Cash',
        isReversal: false,
        chequeBounced: false
      },
    });
    const cashIn = payments.filter(p => p.type === 'IN').reduce((sum, p) => sum + p.amount, 0);

    // For cashOut we also include Cash expenses from Expense model
    const cashPaymentsOut = payments.filter(p => p.type === 'OUT').reduce((sum, p) => sum + p.amount, 0);
    let totalCashOut = cashPaymentsOut;

    try {
      const cashExpenses = await prisma.expense.findMany({
        where: { date: { gte: startOfDay, lte: endOfDay }, paymentMode: 'Cash', status: 'Approved' },
      });
      totalCashOut += cashExpenses.reduce((sum, e) => sum + e.amount, 0);
    } catch (e) {
      // Expense model error, continue with just payments
    }

    register = await prisma.dailyCashRegister.update({
      where: { id: register.id },
      data: {
        cashIn,
        cashOut: totalCashOut
      },
    });

    return { success: true, data: register };
  } catch (error) {
    console.error('Error fetching cash register:', error);
    return { success: false, error: 'Failed to fetch cash register' };
  }
}

export async function updateOpeningCash(date, openingCash) {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const register = await prisma.dailyCashRegister.upsert({
      where: { date: startOfDay },
      update: { openingCash: parseInt(openingCash) },
      create: { date: startOfDay, openingCash: parseInt(openingCash) },
    });

    revalidatePath('/payments');
    return { success: true, data: register };
  } catch (error) {
    console.error('Error updating opening cash:', error);
    return { success: false, error: 'Failed to update opening cash' };
  }
}
