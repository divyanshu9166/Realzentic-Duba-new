'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { z } from 'zod'
import { sendBulkEmails, replaceVariables, testSmtpConnection, sendTestEmail, getSmtpConfig } from '@/lib/email'
import type { SmtpConfig } from '@/lib/email'

// ─── VALIDATION SCHEMAS ─────────────────────────────

const templateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  category: z.string().default('Promotional'),
  variables: z.array(z.string()).default([]),
})

const campaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  templateId: z.number().optional(),
  audience: z.string().default('all'),
  audienceFilter: z.any().optional(),
  scheduledAt: z.string().optional(),
  isABTest: z.boolean().default(false),
  variantBSubject: z.string().optional(),
  variantBBody: z.string().optional(),
  abSplitPercent: z.number().min(10).max(90).default(50),
  isAutomated: z.boolean().default(false),
  triggerType: z.string().optional(),
  triggerDelay: z.number().optional(),
})

// ─── EMAIL TEMPLATES ────────────────────────────────

export async function getEmailTemplates() {
  const templates = await prisma.emailTemplate.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { campaigns: true } } },
  })

  return {
    success: true,
    data: templates.map(t => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      body: t.body,
      category: t.category,
      variables: t.variables,
      campaignCount: t._count.campaigns,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  }
}

export async function createEmailTemplate(data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const parsed = templateSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const template = await prisma.emailTemplate.create({ data: parsed.data })
  revalidatePath('/email-marketing')
  return { success: true, data: { id: template.id } }
}

export async function updateEmailTemplate(id: number, data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const parsed = templateSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  await prisma.emailTemplate.update({ where: { id }, data: parsed.data })
  revalidatePath('/email-marketing')
  return { success: true }
}

export async function deleteEmailTemplate(id: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const usedCount = await prisma.emailCampaign.count({ where: { templateId: id } })
  if (usedCount > 0) return { success: false, error: `Template is used by ${usedCount} campaign(s). Remove them first.` }

  await prisma.emailTemplate.delete({ where: { id } })
  revalidatePath('/email-marketing')
  return { success: true }
}

// ─── EMAIL CAMPAIGNS ────────────────────────────────

export async function getEmailCampaigns() {
  const campaigns = await prisma.emailCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      template: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  })

  return {
    success: true,
    data: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      body: c.body,
      templateName: c.template?.name || null,
      status: c.status,
      scheduledAt: c.scheduledAt?.toISOString() || null,
      sentAt: c.sentAt?.toISOString() || null,
      audience: c.audience,
      totalRecipients: c.totalRecipients,
      sent: c.sent,
      opened: c.opened,
      clicked: c.clicked,
      bounced: c.bounced,
      unsubscribed: c.unsubscribed,
      isABTest: c.isABTest,
      variantB: c.variantB as Record<string, string> | null,
      abSplitPercent: c.abSplitPercent,
      abWinner: c.abWinner,
      isAutomated: c.isAutomated,
      triggerType: c.triggerType,
      triggerDelay: c.triggerDelay,
      recipientCount: c._count.recipients,
      createdAt: c.createdAt.toISOString(),
    })),
  }
}

export async function createEmailCampaign(data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const parsed = campaignSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const campaign = await prisma.emailCampaign.create({
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      templateId: parsed.data.templateId,
      audience: parsed.data.audience,
      audienceFilter: parsed.data.audienceFilter || undefined,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      status: parsed.data.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      isABTest: parsed.data.isABTest,
      variantB: parsed.data.isABTest ? { subject: parsed.data.variantBSubject, body: parsed.data.variantBBody } : undefined,
      abSplitPercent: parsed.data.abSplitPercent,
      isAutomated: parsed.data.isAutomated,
      triggerType: parsed.data.triggerType,
      triggerDelay: parsed.data.triggerDelay,
    },
  })

  revalidatePath('/email-marketing')
  return { success: true, data: { id: campaign.id } }
}

export async function updateEmailCampaign(id: number, data: unknown) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  const parsed = campaignSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  await prisma.emailCampaign.update({
    where: { id },
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      templateId: parsed.data.templateId,
      audience: parsed.data.audience,
      audienceFilter: parsed.data.audienceFilter || undefined,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      isABTest: parsed.data.isABTest,
      variantB: parsed.data.isABTest ? { subject: parsed.data.variantBSubject, body: parsed.data.variantBBody } : undefined,
      abSplitPercent: parsed.data.abSplitPercent,
      isAutomated: parsed.data.isAutomated,
      triggerType: parsed.data.triggerType,
      triggerDelay: parsed.data.triggerDelay,
    },
  })

  revalidatePath('/email-marketing')
  return { success: true }
}

export async function deleteEmailCampaign(id: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }
  await prisma.emailCampaign.delete({ where: { id } })
  revalidatePath('/email-marketing')
  return { success: true }
}

// ─── AUDIENCE / RECIPIENTS ──────────────────────────

export async function getAudienceStats() {
  const [total, withEmail, subscribed, leads, customers] = await Promise.all([
    prisma.contact.count(),
    prisma.contact.count({ where: { email: { not: null } } }),
    prisma.contact.count({ where: { email: { not: null }, emailSubscribed: true } }),
    prisma.contact.count({ where: { email: { not: null }, emailSubscribed: true, leads: { some: {} } } }),
    prisma.contact.count({ where: { email: { not: null }, emailSubscribed: true, dailyPayments: { some: {} } } }),
  ])

  return {
    success: true,
    data: { total, withEmail, subscribed, leads, customers },
  }
}

export async function getAudiencePreview(audience: string) {
  const where: Record<string, unknown> = { email: { not: null }, emailSubscribed: true }

  if (audience === 'leads') {
    where.leads = { some: {} }
  } else if (audience === 'customers') {
    where.dailyPayments = { some: {} }
  }

  const contacts = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, email: true, source: true },
    orderBy: { name: 'asc' },
    take: 100,
  })

  const totalCount = await prisma.contact.count({ where })

  return {
    success: true,
    data: {
      contacts: contacts.map(c => ({ id: c.id, name: c.name, email: c.email!, source: c.source })),
      totalCount,
    },
  }
}

// ─── SEND CAMPAIGN (populate recipients + send emails) ────────────

export async function sendEmailCampaign(campaignId: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }

  // Check SMTP is configured first
  const smtpConfig = await getSmtpConfig()
  if (!smtpConfig) return { success: false, error: 'Email not configured. Go to Settings → Email Setup to configure SMTP.' }

  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) return { success: false, error: 'Campaign not found' }
  if (campaign.status === 'SENT' || campaign.status === 'SENDING') {
    return { success: false, error: 'Campaign already sent or sending' }
  }

  // Get store settings for template variables
  const storeSettings = await prisma.storeSettings.findFirst({ where: { id: 1 } })

  // Build audience query
  const where: Record<string, unknown> = { email: { not: null }, emailSubscribed: true }
  if (campaign.audience === 'leads') where.leads = { some: {} }
  else if (campaign.audience === 'customers') where.dailyPayments = { some: {} }

  const contacts = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, email: true },
  })

  if (contacts.length === 0) return { success: false, error: 'No eligible recipients found' }

  // Mark as SENDING
  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { status: 'SENDING' },
  })

  // Assign A/B variants and create recipient records
  const recipientData = contacts.map((c, i) => {
    let variant = 'A'
    if (campaign.isABTest) {
      const cutoff = Math.floor(contacts.length * (campaign.abSplitPercent / 100))
      variant = i < cutoff ? 'A' : 'B'
    }
    return {
      campaignId,
      contactId: c.id,
      email: c.email!,
      name: c.name,
      variant,
      status: 'queued' as const,
    }
  })

  // Clear previous recipients and create new ones
  await prisma.emailRecipient.deleteMany({ where: { campaignId } })
  await prisma.emailRecipient.createMany({ data: recipientData })

  // Fetch created recipients to get their IDs for tracking
  const recipients = await prisma.emailRecipient.findMany({
    where: { campaignId },
    select: { id: true, email: true, name: true, variant: true },
  })

  // Prepare common template variables
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const commonVars: Record<string, string> = {
    storeName: storeSettings?.storeName || 'Realzentic Dubai',
    storePhone: storeSettings?.phone || '',
    storeEmail: storeSettings?.email || '',
    storeAddress: storeSettings?.address || '',
    storeUrl: appUrl,
  }

  // Get variant B content if A/B test
  const variantB = campaign.variantB as Record<string, string> | null

  // Build email payloads
  const emailPayloads = recipients.map(r => {
    const isB = r.variant === 'B' && variantB
    const subject = isB ? (variantB.subject || campaign.subject) : campaign.subject
    const body = isB ? (variantB.body || campaign.body) : campaign.body

    const personalVars = { ...commonVars, customerName: r.name }
    return {
      to: r.email,
      subject: replaceVariables(subject, personalVars),
      html: replaceVariables(body, personalVars),
      recipientId: r.id,
    }
  })

  // Send all emails via SMTP with throttling
  const result = await sendBulkEmails(emailPayloads)

  // Update recipient statuses for sent ones
  const now = new Date()
  await prisma.emailRecipient.updateMany({
    where: { campaignId, status: 'queued' },
    data: { status: 'sent', sentAt: now },
  })

  // Update campaign with final stats
  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: {
      status: 'SENT',
      sentAt: now,
      totalRecipients: contacts.length,
      sent: result.sent,
    },
  })

  revalidatePath('/email-marketing')
  return {
    success: true,
    data: {
      recipientCount: contacts.length,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors,
    },
  }
}

// ─── SMTP TEST & CONFIG ACTIONS ─────────────────────

export async function testSmtp(config: {
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; smtpFromName: string; smtpSecure: boolean
}) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const result = await testSmtpConnection(config as SmtpConfig)
  return result
}

export async function sendSmtpTestEmail(config: {
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; smtpFromName: string; smtpSecure: boolean
}, toEmail: string) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const result = await sendTestEmail(config as SmtpConfig, toEmail)
  return result
}

export async function getEmailConfigStatus() {
  const config = await getSmtpConfig()
  return {
    success: true,
    configured: !!config,
    smtpHost: config?.smtpHost || null,
    smtpUser: config?.smtpUser || null,
    fromName: config?.smtpFromName || null,
  }
}

// ─── EVENT-DRIVEN AUTOMATED EMAILS ───────────────────

/**
 * Dispatch an automated campaign to one contact after a CRM event. This is
 * intentionally separate from sendEmailCampaign: automated campaigns must
 * target the event contact and must remain reusable for future events.
 */
export async function dispatchAutomatedEmailCampaign(triggerType: string, contactId: number) {
  try {
    const [contact, campaigns, smtp] = await Promise.all([
      prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true, email: true, emailSubscribed: true } }),
      prisma.emailCampaign.findMany({ where: { isAutomated: true, triggerType, status: { in: ['DRAFT', 'SCHEDULED'] } }, orderBy: { id: 'asc' } }),
      getSmtpConfig(),
    ])
    if (!contact?.email || !contact.emailSubscribed || campaigns.length === 0) return { success: true, data: { queued: 0, sent: 0 } }
    if (!smtp) return { success: false, error: 'Email automation skipped because SMTP is not configured' }
    let queued = 0; let sent = 0
    const storeSettings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
    for (const campaign of campaigns) {
      const alreadyQueued = await prisma.emailRecipient.findFirst({ where: { campaignId: campaign.id, contactId, status: { in: ['queued', 'sent'] } }, select: { id: true } })
      if (alreadyQueued) continue
      const delayMinutes = Math.max(0, (campaign.triggerDelay ?? 0) * 60)
      const scheduledAt = delayMinutes > 0 ? new Date(Date.now() + delayMinutes * 60_000) : null
      const useVariantB = campaign.isABTest && Boolean(campaign.variantB) && (contactId % 100) >= campaign.abSplitPercent
      const recipient = await prisma.emailRecipient.create({ data: { campaignId: campaign.id, contactId, email: contact.email, name: contact.name, variant: useVariantB ? 'B' : 'A', status: scheduledAt ? 'queued' : 'sending', scheduledAt } })
      queued++
      if (scheduledAt) continue
      const vars = { customerName: contact.name, storeName: storeSettings?.storeName || 'Realzentic Dubai', storePhone: storeSettings?.phone || '', storeEmail: storeSettings?.email || '', storeUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' }
      const variant = useVariantB ? campaign.variantB as Record<string, string> | null : null
      const response = await sendBulkEmails([{ to: contact.email, subject: replaceVariables(variant?.subject || campaign.subject, vars), html: replaceVariables(variant?.body || campaign.body, vars), recipientId: recipient.id }])
      const sentNow = response.sent > 0
      await prisma.emailRecipient.update({ where: { id: recipient.id }, data: { status: sentNow ? 'sent' : 'failed', sentAt: sentNow ? new Date() : null } })
      if (sentNow) { sent++; await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { sent: { increment: 1 } } }) }
    }
    return { success: true, data: { queued, sent } }
  } catch (error) {
    console.error('[email-campaigns] automated dispatch failed', error)
    return { success: false, error: 'Automated email dispatch failed' }
  }
}

/** Process delayed automated recipients from a cron/worker invocation. */
export async function processDueAutomatedEmailRecipients() {
  const due = await prisma.emailRecipient.findMany({ where: { status: 'queued', scheduledAt: { lte: new Date() }, campaign: { isAutomated: true } }, include: { campaign: true } , take: 100 })
  let sent = 0
  for (const recipient of due) {
    const contact = recipient.contactId ? await prisma.contact.findUnique({ where: { id: recipient.contactId }, select: { name: true, email: true, emailSubscribed: true } }) : null
    if (!contact?.email || !contact.emailSubscribed) { await prisma.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'unsubscribed' } }); continue }
    const variant = recipient.variant === 'B' ? recipient.campaign.variantB as Record<string, string> | null : null
    const response = await sendBulkEmails([{ to: contact.email, subject: replaceVariables(variant?.subject || recipient.campaign.subject, { customerName: contact.name }), html: replaceVariables(variant?.body || recipient.campaign.body, { customerName: contact.name }), recipientId: recipient.id }])
    const ok = response.sent > 0
    await prisma.emailRecipient.update({ where: { id: recipient.id }, data: { status: ok ? 'sent' : 'failed', sentAt: ok ? new Date() : null } })
    if (ok) { sent++; await prisma.emailCampaign.update({ where: { id: recipient.campaignId }, data: { sent: { increment: 1 } } }) }
  }
  return { processed: due.length, sent }
}

/** Queue abandoned-quote nurture only after a real inactivity window. */
export async function processAbandonedQuoteCampaigns() {
  const campaigns = await prisma.emailCampaign.count({ where: { isAutomated: true, triggerType: 'abandoned_quote', status: { in: ['DRAFT', 'SCHEDULED'] } } })
  if (campaigns === 0) return { scanned: 0, queued: 0 }
  const hours = Math.max(1, Number(process.env.ABANDONED_QUOTE_AFTER_HOURS ?? 24))
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
  const leads = await prisma.lead.findMany({ where: { status: 'QUOTATION', updatedAt: { lte: cutoff } }, select: { contactId: true }, distinct: ['contactId'], take: 250 })
  let queued = 0
  for (const lead of leads) {
    const result = await dispatchAutomatedEmailCampaign('abandoned_quote', lead.contactId)
    if (result.success && result.data) queued += result.data.queued
  }
  return { scanned: leads.length, queued }
}

// ─── CAMPAIGN ANALYTICS ─────────────────────────────

export async function getCampaignAnalytics(campaignId: number) {
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        orderBy: { sentAt: 'desc' },
        take: 200,
        select: {
          id: true,
          email: true,
          name: true,
          variant: true,
          status: true,
          sentAt: true,
          openedAt: true,
          clickedAt: true,
          opens: true,
          clicks: true,
        },
      },
    },
  })

  if (!campaign) return { success: false, error: 'Campaign not found' }

  // Aggregate events timeline (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const events = await prisma.emailEvent.findMany({
    where: {
      recipient: { campaignId },
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { type: true, createdAt: true, recipient: { select: { variant: true } } },
  })

  // A/B test breakdown
  type VariantStat = {
    sent: number
    opened: number
    clicked: number
    openRate: number
    clickRate: number
  }
  let abStats: { A: VariantStat; B: VariantStat } | null = null
  if (campaign.isABTest) {
    const variantA = campaign.recipients.filter(r => r.variant === 'A')
    const variantB = campaign.recipients.filter(r => r.variant === 'B')
    abStats = {
      A: {
        sent: variantA.length,
        opened: variantA.filter(r => r.openedAt).length,
        clicked: variantA.filter(r => r.clickedAt).length,
        openRate: variantA.length > 0 ? Math.round((variantA.filter(r => r.openedAt).length / variantA.length) * 100) : 0,
        clickRate: variantA.length > 0 ? Math.round((variantA.filter(r => r.clickedAt).length / variantA.length) * 100) : 0,
      },
      B: {
        sent: variantB.length,
        opened: variantB.filter(r => r.openedAt).length,
        clicked: variantB.filter(r => r.clickedAt).length,
        openRate: variantB.length > 0 ? Math.round((variantB.filter(r => r.openedAt).length / variantB.length) * 100) : 0,
        clickRate: variantB.length > 0 ? Math.round((variantB.filter(r => r.clickedAt).length / variantB.length) * 100) : 0,
      },
    }
  }

  // Build daily timeline
  const timeline: Record<string, { opens: number; clicks: number }> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().split('T')[0]
    timeline[key] = { opens: 0, clicks: 0 }
  }
  events.forEach(e => {
    const key = e.createdAt.toISOString().split('T')[0]
    if (timeline[key]) {
      if (e.type === 'open') timeline[key].opens++
      if (e.type === 'click') timeline[key].clicks++
    }
  })

  return {
    success: true,
    data: {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        status: campaign.status,
        totalRecipients: campaign.totalRecipients,
        sent: campaign.sent,
        opened: campaign.opened,
        clicked: campaign.clicked,
        bounced: campaign.bounced,
        unsubscribed: campaign.unsubscribed,
        openRate: campaign.sent > 0 ? Math.round((campaign.opened / campaign.sent) * 100) : 0,
        clickRate: campaign.sent > 0 ? Math.round((campaign.clicked / campaign.sent) * 100) : 0,
        bounceRate: campaign.sent > 0 ? Math.round((campaign.bounced / campaign.sent) * 100) : 0,
      },
      recipients: campaign.recipients.map(r => ({
        ...r,
        sentAt: r.sentAt?.toISOString() || null,
        openedAt: r.openedAt?.toISOString() || null,
        clickedAt: r.clickedAt?.toISOString() || null,
      })),
      abStats,
      timeline: Object.entries(timeline).map(([date, v]) => ({ date, ...v })),
    },
  }
}

// ─── RECORD TRACKING EVENT ──────────────────────────

export async function recordEmailEvent(recipientId: number, type: 'open' | 'click' | 'bounce' | 'unsubscribe', metadata?: Record<string, unknown>) {
  const recipient = await prisma.emailRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true },
  })
  if (!recipient) return { success: false }

  // Create event
  await prisma.emailEvent.create({
    data: { recipientId, type, metadata: (metadata || {}) as any },
  })

  // Update recipient stats
  const recipientUpdate: Record<string, unknown> = {}
  const campaignUpdate: Record<string, unknown> = {}

  if (type === 'open') {
    recipientUpdate.opens = { increment: 1 }
    if (!recipient.openedAt) {
      recipientUpdate.openedAt = new Date()
      recipientUpdate.status = 'opened'
      campaignUpdate.opened = { increment: 1 }
    }
  } else if (type === 'click') {
    recipientUpdate.clicks = { increment: 1 }
    if (!recipient.clickedAt) {
      recipientUpdate.clickedAt = new Date()
      recipientUpdate.status = 'clicked'
      campaignUpdate.clicked = { increment: 1 }
    }
  } else if (type === 'bounce') {
    recipientUpdate.status = 'bounced'
    recipientUpdate.bouncedAt = new Date()
    campaignUpdate.bounced = { increment: 1 }
  } else if (type === 'unsubscribe') {
    recipientUpdate.status = 'unsubscribed'
    campaignUpdate.unsubscribed = { increment: 1 }
    // Also update contact subscription
    if (recipient.contactId) {
      await prisma.contact.update({
        where: { id: recipient.contactId },
        data: { emailSubscribed: false },
      })
    }
  }

  await prisma.$transaction([
    prisma.emailRecipient.update({ where: { id: recipientId }, data: recipientUpdate }),
    prisma.emailCampaign.update({ where: { id: recipient.campaignId }, data: campaignUpdate }),
  ])

  return { success: true }
}

// ─── AUTOMATED CAMPAIGN HELPERS ─────────────────────

export async function getAutomatedCampaigns() {
  const campaigns = await prisma.emailCampaign.findMany({
    where: { isAutomated: true },
    orderBy: { createdAt: 'desc' },
  })

  return {
    success: true,
    data: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      triggerType: c.triggerType,
      triggerDelay: c.triggerDelay,
      status: c.status,
      sent: c.sent,
      opened: c.opened,
      clicked: c.clicked,
    })),
  }
}

export async function duplicateCampaign(campaignId: number) {
  try { await requireRole('ADMIN', 'MANAGER') } catch { return { success: false, error: 'Manager access required' } }

  const original = await prisma.emailCampaign.findUnique({ where: { id: campaignId } })
  if (!original) return { success: false, error: 'Campaign not found' }

  const copy = await prisma.emailCampaign.create({
    data: {
      name: `${original.name} (Copy)`,
      subject: original.subject,
      body: original.body,
      templateId: original.templateId,
      audience: original.audience,
      audienceFilter: original.audienceFilter || undefined,
      isABTest: original.isABTest,
      variantB: original.variantB || undefined,
      abSplitPercent: original.abSplitPercent,
      isAutomated: original.isAutomated,
      triggerType: original.triggerType,
      triggerDelay: original.triggerDelay,
    },
  })

  revalidatePath('/email-marketing')
  return { success: true, data: { id: copy.id } }
}
