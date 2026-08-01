import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyManagers } from '@/lib/notify'

// ─── Financial Alerts Cron (Real Estate Edition) ─────────────────────────────
// Legacy retail invoice models are not used. This cron monitors payment-based financial health signals that
// are relevant for a real estate agency.

type FinancialSignal = {
  alertKey: string
  title: string
  subtitle: string
  severity: 'high' | 'medium'
}

function formatAed(value: number) {
  return `AED ${Math.round(value).toLocaleString('en-AE')}`
}

function toStartOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function toEndOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export async function GET(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const recent = await prisma.notification.findMany({
      where: { type: 'financial_alert', createdAt: { gte: oneDayAgo } },
      select: { metadata: true },
    })
    const recentKeys = new Set(
      recent
        .map(n => (n.metadata as Record<string, unknown> | null)?.alertKey)
        .filter(Boolean)
        .map(String)
    )

    const signals: FinancialSignal[] = []

    const currentTo = toEndOfDay(now)
    const currentFrom = toStartOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000))
    const prevTo = toEndOfDay(new Date(currentFrom.getTime() - 24 * 60 * 60 * 1000))
    const prevFrom = toStartOfDay(new Date(prevTo.getTime() - 29 * 24 * 60 * 60 * 1000))

    // 1) Check if payment inflows dropped significantly vs prior 30d
    const [currInflow, prevInflow] = await Promise.all([
      prisma.dailyPayment.aggregate({
        where: { type: 'IN', isReversal: false, date: { gte: currentFrom, lte: currentTo } },
        _sum: { amount: true },
      }),
      prisma.dailyPayment.aggregate({
        where: { type: 'IN', isReversal: false, date: { gte: prevFrom, lte: prevTo } },
        _sum: { amount: true },
      }),
    ])

    const curr = currInflow._sum.amount || 0
    const prev = prevInflow._sum.amount || 0
    const dropPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0

    if (dropPct <= -30 && !recentKeys.has('payment_inflow_drop')) {
      signals.push({
        alertKey: 'payment_inflow_drop',
        title: 'Financial Alert: Payment Inflow Drop',
        subtitle: `Collections fell from ${formatAed(prev)} to ${formatAed(curr)} (${dropPct.toFixed(1)}% vs prior 30d)`,
        severity: 'high',
      })
    }

    // 2) High bounced cheque rate
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [bouncedCheques, totalCheques] = await Promise.all([
      prisma.dailyPayment.count({ where: { method: 'Cheque', chequeBounced: true, date: { gte: monthStart, lte: currentTo } } }),
      prisma.dailyPayment.count({ where: { method: 'Cheque', date: { gte: monthStart, lte: currentTo } } }),
    ])

    const bounceRate = totalCheques > 0 ? (bouncedCheques / totalCheques) * 100 : 0

    if (bounceRate >= 20 && !recentKeys.has('high_cheque_bounce_rate')) {
      signals.push({
        alertKey: 'high_cheque_bounce_rate',
        title: 'Financial Alert: High Cheque Bounce Rate',
        subtitle: `${bouncedCheques} of ${totalCheques} cheques bounced this month (${bounceRate.toFixed(1)}%)`,
        severity: 'medium',
      })
    }

    if (signals.length === 0) {
      return NextResponse.json({ success: true, alertsSent: 0, message: 'No new financial anomalies' })
    }

    for (const sig of signals) {
      await notifyManagers({
        type: 'financial_alert',
        title: sig.title,
        subtitle: sig.subtitle,
        href: '/financials',
        metadata: { alertKey: sig.alertKey, severity: sig.severity },
        emailSubject: `⚠️ ${sig.title}`,
        emailHtml: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;"><h2 style="margin:0 0 8px;color:#b45309;">${sig.title}</h2><p style="font-size:14px;color:#111827;">${sig.subtitle}</p><p style="font-size:12px;color:#6b7280;">Open Financials dashboard to review payment trends.</p></div>`,
        whatsappText: `⚠️ ${sig.title}\n${sig.subtitle}\nReview: /financials`,
      })
    }

    return NextResponse.json({
      success: true,
      alertsSent: signals.length,
      alerts: signals.map(s => ({ key: s.alertKey, title: s.title, severity: s.severity })),
    })
  } catch (err) {
    console.error('[financial-alerts] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
