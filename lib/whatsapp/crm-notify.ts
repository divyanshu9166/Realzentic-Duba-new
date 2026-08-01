/**
 * lib/whatsapp/crm-notify.ts
 *
 * Window-aware WhatsApp sender for CRM-side proactive notifications
 * (follow-up reminders, site-visit reminders, payment reminders, etc.).
 *
 * The hard constraint: Meta only permits free-form text within 24h of the
 * contact's last inbound message. Outside that window only an approved
 * template (HSM) may be sent. `sendCrmWhatsApp` resolves the contact's session
 * window and automatically:
 *   - sends free-form `text` when the window is OPEN, else
 *   - sends the supplied approved `template` when the window is CLOSED, else
 *   - skips gracefully (never throws) when closed with no template.
 *
 * Bridges a CRM Contact.phone to the WhatsApp side (WaContact / WaConversation)
 * so replies thread correctly and the outbound is logged. Templates can also
 * open a brand-new conversation for a prospect who never messaged before.
 */

import { prisma } from '@/lib/db'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
    normalizePhoneForMetaUae,
    isValidE164,
    phoneVariants,
    isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { isSessionWindowOpen } from '@/lib/whatsapp/session-window'

export interface CrmTemplate {
    /** Approved Meta template name. */
    name: string
    /** Template language code (default en_US). */
    language?: string
    /** Body variables ({{1}}, {{2}}, ...) in order. */
    params?: string[]
}

export interface CrmWhatsAppArgs {
    /** CRM contact phone in any format. */
    phone: string
    /** Free-form body sent when the 24h window is OPEN. */
    text: string
    /** Approved template sent when the window is CLOSED. */
    template?: CrmTemplate
    /** Used to name a newly-created WaContact when none exists yet. */
    contactName?: string | null
}

export type CrmWhatsAppResult =
    | { ok: true; channel: 'text' | 'template'; messageId: string }
    | { ok: false; skipped: true; reason: string }
    | { ok: false; error: string }

/**
 * Send a window-aware WhatsApp notification to a CRM contact's phone.
 * Never throws — always returns a structured result so cron loops are safe.
 */
export async function sendCrmWhatsApp(args: CrmWhatsAppArgs): Promise<CrmWhatsAppResult> {
    try {
        // ── 1. Resolve the (single) WhatsApp account config. ────────────────
        const config = await prisma.waWhatsappConfig.findFirst()
        if (!config) return { ok: false, error: 'WhatsApp is not configured' }

        const sanitized = normalizePhoneForMetaUae(args.phone)
        if (!isValidE164(sanitized)) {
            return { ok: false, error: `Invalid phone number: ${args.phone}` }
        }

        // ── 2. Find the WhatsApp contact + conversation for this phone. ─────
        const variants = phoneVariants(sanitized)
        let waContact = await prisma.waContact.findFirst({
            where: { user_id: config.user_id, phone: { in: variants } },
            select: { id: true },
        })

        let conversation = waContact
            ? await prisma.waConversation.findFirst({
                where: { contact_id: waContact.id },
                orderBy: { updated_at: 'desc' },
                select: { id: true },
            })
            : null

        // ── 3. Determine the session window from the last INBOUND message. ──
        let lastInboundMs: number | null = null
        if (conversation) {
            const lastInbound = await prisma.waMessage.findFirst({
                where: { conversation_id: conversation.id, sender_type: 'customer' },
                orderBy: { created_at: 'desc' },
                select: { created_at: true },
            })
            lastInboundMs = lastInbound ? lastInbound.created_at.getTime() : null
        }

        const windowOpen = isSessionWindowOpen(lastInboundMs, Date.now())

        // ── 4. Decide channel and guard the closed-window case. ─────────────
        if (!windowOpen && !args.template) {
            return {
                ok: false,
                skipped: true,
                reason: 'Outside the 24h window and no approved template configured',
            }
        }

        const accessToken = decrypt(config.access_token)

        const attempt = async (phone: string): Promise<{ id: string; channel: 'text' | 'template' }> => {
            if (windowOpen) {
                const r = await sendTextMessage({
                    phoneNumberId: config.phone_number_id,
                    accessToken,
                    to: phone,
                    text: args.text,
                })
                return { id: r.messageId, channel: 'text' }
            }
            const tpl = args.template!
            const r = await sendTemplateMessage({
                phoneNumberId: config.phone_number_id,
                accessToken,
                to: phone,
                templateName: tpl.name,
                language: tpl.language,
                params: tpl.params,
            })
            return { id: r.messageId, channel: 'template' }
        }

        // ── 5. Send with the same phone-variant retry used elsewhere. ───────
        let sent: { id: string; channel: 'text' | 'template' } | null = null
        let workingPhone = sanitized
        let lastError: unknown = null
        for (const v of variants) {
            try {
                sent = await attempt(v)
                workingPhone = v
                lastError = null
                break
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (!isRecipientNotAllowedError(msg)) {
                    return { ok: false, error: msg }
                }
                lastError = err
            }
        }
        if (!sent) {
            const msg = lastError instanceof Error ? lastError.message : 'Send failed'
            return { ok: false, error: msg }
        }

        // ── 6. Best-effort: thread + log the outbound message. ──────────────
        // Failure to persist must not fail an already-sent message.
        try {
            if (!waContact) {
                waContact = await prisma.waContact.create({
                    data: {
                        user_id: config.user_id,
                        phone: workingPhone,
                        name: args.contactName ?? null,
                    },
                    select: { id: true },
                })
            }
            if (!conversation) {
                conversation = await prisma.waConversation.findFirst({
                    where: { user_id: config.user_id, contact_id: waContact.id },
                    select: { id: true },
                })
                if (!conversation) {
                    conversation = await prisma.waConversation.create({
                        data: { user_id: config.user_id, contact_id: waContact.id },
                        select: { id: true },
                    })
                }
            }

            await prisma.waMessage.create({
                data: {
                    conversation_id: conversation.id,
                    sender_type: 'bot',
                    content_type: sent.channel === 'template' ? 'template' : 'text',
                    content_text: sent.channel === 'text' ? args.text : null,
                    template_name: sent.channel === 'template' ? args.template!.name : null,
                    message_id: sent.id,
                    status: 'sent',
                },
            })
            await prisma.waConversation.update({
                where: { id: conversation.id },
                data: {
                    last_message_text:
                        sent.channel === 'template' ? `[template:${args.template!.name}]` : args.text,
                    last_message_at: new Date(),
                },
            })
        } catch (logErr) {
            console.warn('[crm-notify] sent but failed to log message:', logErr)
        }

        return { ok: true, channel: sent.channel, messageId: sent.id }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send WhatsApp notification'
        console.error('[crm-notify] error:', err)
        return { ok: false, error: message }
    }
}
