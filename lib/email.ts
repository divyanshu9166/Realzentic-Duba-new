import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'

export interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpFromName: string
  smtpSecure: boolean
}

// ─── GET SMTP CONFIG FROM DB ────────────────────────

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const settings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
  if (!settings?.smtpHost || !settings?.smtpUser || !settings?.smtpPass) return null

  return {
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort || 587,
    smtpUser: settings.smtpUser,
    smtpPass: settings.smtpPass,
    smtpFromName: settings.smtpFromName || settings.storeName || 'Realzentic Dubai',
    smtpSecure: settings.smtpSecure,
  }
}

// ─── CREATE TRANSPORTER ─────────────────────────────

export function createTransporter(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    // Timeouts for reliability
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  })
}

// ─── SEND SINGLE EMAIL ──────────────────────────────

export async function sendEmail(options: {
  to: string
  subject: string
  html: string
  recipientId?: number // for tracking pixel injection
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const config = await getSmtpConfig()
  if (!config) return { success: false, error: 'SMTP not configured. Go to Settings → Email Setup.' }

  const transporter = createTransporter(config)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  // Inject tracking pixel if recipientId provided
  let html = options.html
  if (options.recipientId) {
    const trackPixel = `<img src="${appUrl}/api/email-track?rid=${options.recipientId}&t=open" width="1" height="1" style="display:none;" alt="" />`
    // Add unsubscribe link
    const unsubLink = `<div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;">
      <a href="${appUrl}/api/email-track?rid=${options.recipientId}&t=click&url=${encodeURIComponent(appUrl + '/unsubscribe?rid=' + options.recipientId)}" style="color:#999;">Unsubscribe</a>
    </div>`
    html = html + unsubLink + trackPixel
  }

  try {
    const result = await transporter.sendMail({
      from: `"${config.smtpFromName}" <${config.smtpUser}>`,
      to: options.to,
      subject: options.subject,
      html,
    })

    return { success: true, messageId: result.messageId }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send email' }
  }
}

// ─── SEND BULK EMAILS (with throttling) ─────────────

export async function sendBulkEmails(emails: {
  to: string
  subject: string
  html: string
  recipientId: number
}[]): Promise<{ sent: number; failed: number; errors: string[] }> {
  const config = await getSmtpConfig()
  if (!config) return { sent: 0, failed: emails.length, errors: ['SMTP not configured'] }

  const transporter = createTransporter(config)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  let sent = 0
  let failed = 0
  const errors: string[] = []

  // Send in batches of 5 with 1 second delay between batches
  const batchSize = 5
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (email) => {
        // Inject tracking pixel and unsubscribe link
        const trackPixel = `<img src="${appUrl}/api/email-track?rid=${email.recipientId}&t=open" width="1" height="1" style="display:none;" alt="" />`
        const unsubLink = `<div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;">
          <a href="${appUrl}/api/email-track?rid=${email.recipientId}&t=click&url=${encodeURIComponent(appUrl + '/unsubscribe?rid=' + email.recipientId)}" style="color:#999;">Unsubscribe</a>
        </div>`
        const html = email.html + unsubLink + trackPixel

        return transporter.sendMail({
          from: `"${config.smtpFromName}" <${config.smtpUser}>`,
          to: email.to,
          subject: email.subject,
          html,
        })
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sent++
      } else {
        failed++
        errors.push(result.reason?.message || 'Unknown error')
      }
    }

    // Throttle: wait 1 second between batches to avoid rate limits
    if (i + batchSize < emails.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  return { sent, failed, errors: [...new Set(errors)] }
}

// ─── TEST SMTP CONNECTION ───────────────────────────

export async function testSmtpConnection(config: SmtpConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransporter(config)
    await transporter.verify()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection failed' }
  }
}

// ─── SEND TEST EMAIL ────────────────────────────────

export async function sendTestEmail(config: SmtpConfig, to: string): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransporter(config)
    await transporter.sendMail({
      from: `"${config.smtpFromName}" <${config.smtpUser}>`,
      to,
      subject: 'Test Email from Realzentic Dubai',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 30px;">
          <h2 style="color: #1a1a1a;">Email Setup Successful!</h2>
          <p style="color: #555;">Your Realzentic Dubai email is configured and working correctly.</p>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="color: #166534; margin: 0; font-weight: 600;">SMTP Host: ${config.smtpHost}</p>
            <p style="color: #166534; margin: 4px 0 0;">From: ${config.smtpUser}</p>
          </div>
          <p style="color: #888; font-size: 13px;">You can now send email campaigns to your customers.</p>
        </div>
      `,
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send test email' }
  }
}

// ─── REPLACE TEMPLATE VARIABLES ─────────────────────

export function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}
