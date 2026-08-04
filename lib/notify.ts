import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { normalizePhoneForMetaUae } from '@/lib/whatsapp/phone-utils'

// ─── TYPES ──────────────────────────────────────────

interface NotifyManagersOptions {
  type: 'stock_alert' | 'field_visit' | 'financial_alert' | 'lead_sla' | 'maintenance_alert'
  title: string
  subtitle: string
  href: string
  metadata?: Record<string, unknown>
  emailSubject: string
  emailHtml: string
  whatsappText: string
}

export type LeadCaptureChannel = 'WhatsApp' | 'Instagram' | 'Facebook'

/**
 * Create the lightweight in-app alert used for inbound lead capture.
 *
 * This deliberately does not send email or WhatsApp messages. Inbound
 * channels already produce their own conversation notifications, and sending
 * a second external alert for every message would be noisy. The CRM lead
 * check in each channel ensures this is emitted once per active lead.
 */
export async function notifyLeadCaptured(options: {
  channel: LeadCaptureChannel
  leadId: number
  contactName: string
  interest: string
  assignedToName?: string | null
}) {
  const assignment = options.assignedToName ? ` · Assigned to ${options.assignedToName}` : ''

  try {
    await prisma.notification.create({
      data: {
        type: 'lead_captured',
        title: `New ${options.channel} lead captured`,
        subtitle: `${options.contactName} · ${options.interest}${assignment}`,
        href: '/leads',
        metadata: {
          leadId: options.leadId,
          channel: options.channel,
        },
      },
    })
  } catch (error) {
    // Notification failure must never make a Meta webhook fail after the lead
    // has already been saved successfully.
    console.error('[notify] Failed to create lead capture notification:', error)
  }
}

// ─── SEND WHATSAPP (internal helper, no server action wrapper) ───

async function sendWhatsApp(phoneNumberId: string, apiToken: string, to: string, text: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      console.error(`[notify] WhatsApp send failed: ${err}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[notify] WhatsApp send error:', err)
    return false
  }
}

// ─── CORE: NOTIFY MANAGERS ──────────────────────────

export async function notifyManagers(options: NotifyManagersOptions) {
  const { type, title, subtitle, href, metadata, emailSubject, emailHtml, whatsappText } = options

  // 1. Create in-app notification
  try {
    await prisma.notification.create({
      data: { type, title, subtitle, href, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined },
    })
  } catch (err) {
    console.error('[notify] Failed to create in-app notification:', err)
  }

  // 2. Fetch managers/admins with contact info (via linked Staff record)
  let managers: { email: string; phone: string | null }[] = []
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'MANAGER'] } },
      select: {
        email: true,
        staff: { select: { phone: true, email: true } },
      },
    })
    managers = users.map(u => ({
      email: u.staff?.email || u.email,
      phone: u.staff?.phone || null,
    }))
  } catch (err) {
    console.error('[notify] Failed to fetch managers:', err)
    return
  }

  if (managers.length === 0) return

  // 3. Send emails (fire-and-forget)
  for (const mgr of managers) {
    if (mgr.email) {
      sendEmail({ to: mgr.email, subject: emailSubject, html: emailHtml }).catch(err =>
        console.error(`[notify] Email to ${mgr.email} failed:`, err)
      )
    }
  }

  // 4. Send WhatsApp messages (fire-and-forget)
  try {
    const waConfig = await prisma.channelConfig.findUnique({ where: { channel: 'WhatsApp' } })
    if (waConfig?.enabled) {
      const config = waConfig.config as Record<string, string>
      if (config.phoneNumberId && config.apiToken) {
        for (const mgr of managers) {
          if (mgr.phone) {
            // Normalize UAE mobile numbers to Meta's canonical digits-only form.
            const fullPhone = normalizePhoneForMetaUae(mgr.phone)
            if (!fullPhone) continue
            sendWhatsApp(config.phoneNumberId, config.apiToken, fullPhone, whatsappText).catch(err =>
              console.error(`[notify] WhatsApp to ${mgr.phone} failed:`, err)
            )
          }
        }
      }
    }
  } catch (err) {
    console.error('[notify] WhatsApp config fetch failed:', err)
  }
}
