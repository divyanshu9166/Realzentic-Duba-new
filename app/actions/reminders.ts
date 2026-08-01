'use server'

/**
 * app/actions/reminders.ts
 *
 * Proactive, 24h-window-aware WhatsApp reminders for CRM events:
 *   - runFollowUpReminders   — nudge prospects whose follow-up is due/overdue,
 *                              and optionally ping the assigned agent.
 *   - runSiteVisitReminders  — remind buyers of an upcoming scheduled visit.
 *   - runPostVisitFeedback   — request feedback after a completed visit.
 *   - runPaymentReminders    — remind buyers of an upcoming payment milestone.
 *
 * Every send goes through `sendCrmWhatsApp`, which automatically sends a
 * free-form message inside the 24h window or the configured approved template
 * outside it (and skips gracefully when closed with no template).
 *
 * A per-day `ReminderLog` row makes each runner idempotent: re-running the same
 * day never double-sends, even under concurrent cron hits (unique constraint).
 */

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { sendCrmWhatsApp, type CrmTemplate } from '@/lib/whatsapp/crm-notify'

// ─── Config (singleton id=1) ───────────────────────────────────────────────────

export interface ReminderConfigView {
    followUpEnabled: boolean
    followUpTemplate: string | null
    notifyAgentOnFollowUp: boolean
    agentFollowUpTemplate: string | null
    siteVisitEnabled: boolean
    siteVisitTemplate: string | null
    siteVisitLeadHours: number
    postVisitEnabled: boolean
    postVisitTemplate: string | null
    paymentEnabled: boolean
    paymentTemplate: string | null
    paymentLeadDays: number
    taskEnabled: boolean
    taskTemplate: string | null
}

const DEFAULT_CONFIG: ReminderConfigView = {
    followUpEnabled: false,
    followUpTemplate: null,
    notifyAgentOnFollowUp: true,
    agentFollowUpTemplate: null,
    siteVisitEnabled: false,
    siteVisitTemplate: null,
    siteVisitLeadHours: 24,
    postVisitEnabled: false,
    postVisitTemplate: null,
    paymentEnabled: false,
    paymentTemplate: null,
    paymentLeadDays: 3,
    taskEnabled: false,
    taskTemplate: null,
}

async function loadConfig(): Promise<ReminderConfigView> {
    const row = await prisma.waReminderConfig.findUnique({ where: { id: 1 } })
    if (!row) return DEFAULT_CONFIG
    return {
        followUpEnabled: row.followUpEnabled,
        followUpTemplate: row.followUpTemplate,
        notifyAgentOnFollowUp: row.notifyAgentOnFollowUp,
        agentFollowUpTemplate: row.agentFollowUpTemplate,
        siteVisitEnabled: row.siteVisitEnabled,
        siteVisitTemplate: row.siteVisitTemplate,
        siteVisitLeadHours: row.siteVisitLeadHours,
        postVisitEnabled: row.postVisitEnabled,
        postVisitTemplate: row.postVisitTemplate,
        paymentEnabled: row.paymentEnabled,
        paymentTemplate: row.paymentTemplate,
        paymentLeadDays: row.paymentLeadDays,
        taskEnabled: row.taskEnabled,
        taskTemplate: row.taskTemplate,
    }
}

export async function getReminderConfig() {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false as const, error: 'Forbidden' }
    }
    return { success: true as const, data: await loadConfig() }
}

export async function saveReminderConfig(input: Partial<ReminderConfigView>) {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false as const, error: 'Forbidden' }
    }

    const clean = {
        followUpEnabled: Boolean(input.followUpEnabled),
        followUpTemplate: input.followUpTemplate?.trim() || null,
        notifyAgentOnFollowUp: Boolean(input.notifyAgentOnFollowUp),
        agentFollowUpTemplate: input.agentFollowUpTemplate?.trim() || null,
        siteVisitEnabled: Boolean(input.siteVisitEnabled),
        siteVisitTemplate: input.siteVisitTemplate?.trim() || null,
        siteVisitLeadHours: clampInt(input.siteVisitLeadHours, 1, 168, 24),
        postVisitEnabled: Boolean(input.postVisitEnabled),
        postVisitTemplate: input.postVisitTemplate?.trim() || null,
        paymentEnabled: Boolean(input.paymentEnabled),
        paymentTemplate: input.paymentTemplate?.trim() || null,
        paymentLeadDays: clampInt(input.paymentLeadDays, 1, 60, 3),
        taskEnabled: Boolean(input.taskEnabled),
        taskTemplate: input.taskTemplate?.trim() || null,
    }

    try {
        await prisma.waReminderConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...clean },
            update: clean,
        })
        revalidatePath('/whatsapp-marketing')
        return { success: true as const }
    } catch (error) {
        console.error('Error saving reminder config:', error)
        return { success: false as const, error: 'Failed to save reminder settings' }
    }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : dflt
    return Math.min(hi, Math.max(lo, n))
}

// ─── Idempotency ─────────────────────────────────────────────────────────────────

type ReminderKind = 'follow_up' | 'site_visit' | 'post_visit' | 'payment' | 'task'

function todayBucket(now = new Date()): string {
    return now.toISOString().split('T')[0]
}

async function alreadyReminded(kind: ReminderKind, refId: number, sentOn: string): Promise<boolean> {
    const existing = await prisma.reminderLog.findUnique({
        where: { kind_refId_sentOn: { kind, refId, sentOn } },
    })
    return existing != null
}

async function logReminder(
    kind: ReminderKind,
    refId: number,
    sentOn: string,
    channel: string,
    detail?: string,
): Promise<void> {
    try {
        await prisma.reminderLog.create({ data: { kind, refId, sentOn, channel, detail } })
    } catch {
        // Unique-constraint race: another worker logged it first — safe to ignore.
    }
}

interface RunSummary {
    success: true
    considered: number
    sent: number
    skipped: number
    failed: number
}

function aed(amount: number): string {
    return `AED ${Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(amount)}`
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── 1. Follow-up reminders ───────────────────────────────────────────────────────

export async function runFollowUpReminders(): Promise<RunSummary | { success: false; error: string }> {
    const cfg = await loadConfig()
    if (!cfg.followUpEnabled) return { success: true, considered: 0, sent: 0, skipped: 0, failed: 0 }

    const sentOn = todayBucket()
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    const entries = await prisma.followUpEntry.findMany({
        where: { status: 'PENDING', followUpDate: { lte: endOfToday } },
        include: { contact: true, assignedTo: { select: { name: true, phone: true } } },
        orderBy: { followUpDate: 'asc' },
        take: 500,
    })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const e of entries) {
        if (await alreadyReminded('follow_up', e.id, sentOn)) {
            skipped++
            continue
        }

        const name = e.contact.name
        const text = `Hi ${name}, just following up regarding your interest in ${e.interest}. Whenever you're ready to take this forward, we're here to help. Would you like to revisit it?`
        const template: CrmTemplate | undefined = cfg.followUpTemplate
            ? { name: cfg.followUpTemplate, params: [name, e.interest] }
            : undefined

        const res = await sendCrmWhatsApp({ phone: e.contact.phone, text, template, contactName: name })

        if (res.ok) {
            sent++
            await logReminder('follow_up', e.id, sentOn, res.channel)
            // Fire exactly once: move out of PENDING so it is never reminded
            // again. The contact's reply (if any) is handled by the chatbot /
            // agent; the admin resolves it to Converted / Lost from there.
            await prisma.followUpEntry.update({
                where: { id: e.id },
                data: { status: 'REMINDED', lastContactedAt: new Date() },
            }).catch(() => { })
        } else if ('skipped' in res) {
            // Not actually contacted (e.g. no template configured yet). Leave it
            // PENDING so it sends once the template is set — don't burn the send.
            skipped++
            await logReminder('follow_up', e.id, sentOn, 'skipped', res.reason)
        } else {
            failed++
        }

        // Optional: ping the assigned agent about the due follow-up.
        if (cfg.notifyAgentOnFollowUp && e.assignedTo?.phone) {
            const agentText = `Reminder: follow-up due with ${name} (${e.contact.phone}) about ${e.interest}.`
            const agentTemplate: CrmTemplate | undefined = cfg.agentFollowUpTemplate
                ? { name: cfg.agentFollowUpTemplate, params: [e.assignedTo.name, name, e.interest] }
                : undefined
            await sendCrmWhatsApp({ phone: e.assignedTo.phone, text: agentText, template: agentTemplate })
        }
    }

    return { success: true, considered: entries.length, sent, skipped, failed }
}

// ─── 2. Site-visit reminders ────────────────────────────────────────────────────────

export async function runSiteVisitReminders(): Promise<RunSummary | { success: false; error: string }> {
    const cfg = await loadConfig()
    if (!cfg.siteVisitEnabled) return { success: true, considered: 0, sent: 0, skipped: 0, failed: 0 }

    const sentOn = todayBucket()
    const now = new Date()
    const horizon = new Date(now.getTime() + cfg.siteVisitLeadHours * 3_600_000)

    const visits = await prisma.fieldVisit.findMany({
        where: {
            status: 'Scheduled',
            scheduledDate: { gte: now, lte: horizon },
            buyerPhone: { not: null },
        },
        take: 500,
    })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const v of visits) {
        if (!v.buyerPhone) { skipped++; continue }
        if (await alreadyReminded('site_visit', v.id, sentOn)) { skipped++; continue }

        const when = v.scheduledDate ? fmtDate(v.scheduledDate) : fmtDate(v.date)
        const slot = v.scheduledTime || v.time || ''
        const text = `Hi ${v.customer}, this is a reminder for your property site visit on ${when}${slot ? ` at ${slot}` : ''} — ${v.address}. See you there!`
        const template: CrmTemplate | undefined = cfg.siteVisitTemplate
            ? { name: cfg.siteVisitTemplate, params: [v.customer, when, slot || when, v.address] }
            : undefined

        const res = await sendCrmWhatsApp({ phone: v.buyerPhone, text, template, contactName: v.customer })
        if (res.ok) { sent++; await logReminder('site_visit', v.id, sentOn, res.channel) }
        else if ('skipped' in res) { skipped++; await logReminder('site_visit', v.id, sentOn, 'skipped', res.reason) }
        else failed++
    }

    return { success: true, considered: visits.length, sent, skipped, failed }
}

// ─── 3. Post-visit feedback request ──────────────────────────────────────────────────

export async function runPostVisitFeedback(): Promise<RunSummary | { success: false; error: string }> {
    const cfg = await loadConfig()
    if (!cfg.postVisitEnabled) return { success: true, considered: 0, sent: 0, skipped: 0, failed: 0 }

    const sentOn = todayBucket()
    const since = new Date(Date.now() - 24 * 3_600_000)

    const visits = await prisma.fieldVisit.findMany({
        where: {
            status: 'Completed',
            completedAt: { gte: since },
            buyerRating: null, // only ask when we don't already have feedback
            buyerPhone: { not: null },
        },
        take: 500,
    })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const v of visits) {
        if (!v.buyerPhone) { skipped++; continue }
        if (await alreadyReminded('post_visit', v.id, sentOn)) { skipped++; continue }

        const text = `Hi ${v.customer}, thank you for visiting ${v.address}. How was your experience? Your feedback helps us serve you better — just reply here.`
        const template: CrmTemplate | undefined = cfg.postVisitTemplate
            ? { name: cfg.postVisitTemplate, params: [v.customer, v.address] }
            : undefined

        const res = await sendCrmWhatsApp({ phone: v.buyerPhone, text, template, contactName: v.customer })
        if (res.ok) { sent++; await logReminder('post_visit', v.id, sentOn, res.channel) }
        else if ('skipped' in res) { skipped++; await logReminder('post_visit', v.id, sentOn, 'skipped', res.reason) }
        else failed++
    }

    return { success: true, considered: visits.length, sent, skipped, failed }
}

// ─── 4. Payment milestone reminders ───────────────────────────────────────────────────

export async function runPaymentReminders(): Promise<RunSummary | { success: false; error: string }> {
    const cfg = await loadConfig()
    if (!cfg.paymentEnabled) return { success: true, considered: 0, sent: 0, skipped: 0, failed: 0 }

    const sentOn = todayBucket()
    const now = new Date()
    const horizon = new Date(now.getTime() + cfg.paymentLeadDays * 86_400_000)

    const milestones = await prisma.bookingMilestone.findMany({
        where: {
            status: { in: ['Upcoming', 'Due', 'Overdue', 'Partially_Paid'] },
            dueDate: { lte: horizon },
        },
        include: { booking: { include: { contact: true } } },
        take: 500,
    })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const m of milestones) {
        const contact = m.booking?.contact
        if (!contact?.phone) { skipped++; continue }

        const due = Number(m.amount) - Number(m.paidAmount)
        if (due <= 0) { skipped++; continue }
        if (await alreadyReminded('payment', m.id, sentOn)) { skipped++; continue }

        const dueStr = aed(due)
        const when = fmtDate(m.dueDate)
        const text = `Hi ${contact.name}, a gentle reminder: your payment "${m.name}" of ${dueStr} is due on ${when}. Please reach out if you need any assistance.`
        const template: CrmTemplate | undefined = cfg.paymentTemplate
            ? { name: cfg.paymentTemplate, params: [contact.name, m.name, dueStr, when] }
            : undefined

        const res = await sendCrmWhatsApp({ phone: contact.phone, text, template, contactName: contact.name })
        if (res.ok) { sent++; await logReminder('payment', m.id, sentOn, res.channel) }
        else if ('skipped' in res) { skipped++; await logReminder('payment', m.id, sentOn, 'skipped', res.reason) }
        else failed++
    }

    return { success: true, considered: milestones.length, sent, skipped, failed }
}

// ─── 5. Task due reminders (notify the assigned agent) ───────────────────────────────

export async function runTaskReminders(): Promise<RunSummary | { success: false; error: string }> {
    const cfg = await loadConfig()
    if (!cfg.taskEnabled) return { success: true, considered: 0, sent: 0, skipped: 0, failed: 0 }

    const sentOn = todayBucket()
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    const tasks = await prisma.task.findMany({
        where: {
            status: 'Open',
            dueDate: { lte: endOfToday },
            assignedToId: { not: null },
        },
        include: { assignedTo: { select: { name: true, phone: true } } },
        orderBy: { dueDate: 'asc' },
        take: 500,
    })

    let sent = 0
    let skipped = 0
    let failed = 0

    for (const t of tasks) {
        const agent = t.assignedTo
        if (!agent?.phone) { skipped++; continue }
        if (await alreadyReminded('task', t.id, sentOn)) { skipped++; continue }

        const due = fmtDate(t.dueDate)
        const text = `Task reminder: "${t.title}" (${t.type}) is due ${due}. Open Realzentic to action it.`
        const template: CrmTemplate | undefined = cfg.taskTemplate
            ? { name: cfg.taskTemplate, params: [agent.name, t.title, due] }
            : undefined

        const res = await sendCrmWhatsApp({ phone: agent.phone, text, template, contactName: agent.name })
        if (res.ok) { sent++; await logReminder('task', t.id, sentOn, res.channel) }
        else if ('skipped' in res) { skipped++; await logReminder('task', t.id, sentOn, 'skipped', res.reason) }
        else failed++
    }

    return { success: true, considered: tasks.length, sent, skipped, failed }
}

// ─── Manual trigger (UI "Run now") ─────────────────────────────────────────────────

/**
 * Run every enabled reminder job immediately. ADMIN/MANAGER only — used by the
 * settings UI so operators can test their template configuration on demand.
 */
export async function runRemindersNow() {
    try {
        await requireRole('ADMIN', 'MANAGER')
    } catch {
        return { success: false as const, error: 'Forbidden' }
    }
    const followUps = await runFollowUpReminders()
    const siteVisits = await runSiteVisitReminders()
    const postVisits = await runPostVisitFeedback()
    const payments = await runPaymentReminders()
    const tasks = await runTaskReminders()
    return { success: true as const, data: { followUps, siteVisits, postVisits, payments, tasks } }
}
