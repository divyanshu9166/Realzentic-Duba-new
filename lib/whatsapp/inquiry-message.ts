/**
 * lib/whatsapp/inquiry-message.ts
 *
 * Sends the automated 3-button inquiry welcome message to a new WhatsApp contact.
 *
 * Triggered when:
 *   - A new contact sends their FIRST WhatsApp message
 *
 * The message uses WhatsApp interactive buttons (works within 24-hour window).
 * The customer's own first message opens the window, so this reply is always valid.
 *
 * Buttons:
 *   1. 🏙️ Property Details  → id: "INFO_PROPERTIES"
 *   2. 📍 Contact Details   → id: "INFO_ADDRESS"
 *   3. 📅 Schedule Viewing  → id: "SCHEDULE_APPOINTMENT"
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendInteractiveButtonMessage, sendTextMessage } from '@/lib/whatsapp/meta-api'

interface InquirySendOptions {
  userId: string
  contactPhone: string
  contactName: string
  conversationId: string
  /** Meta message ID of the incoming message — used for DB logging */
  incomingMessageId: string
}

/**
 * Send the 3-button inquiry welcome message via WhatsApp.
 * Silently swallows errors — a failed welcome must never break the main flow.
 */
export async function sendInquiryWelcomeMessage(opts: InquirySendOptions): Promise<void> {
  const { userId, contactPhone, contactName, conversationId, incomingMessageId } = opts

  try {
    const waConfig = await prisma.waWhatsappConfig.findUnique({
      where: { user_id: userId },
    })
    if (!waConfig) return

    const accessToken = decrypt(waConfig.access_token)
    const phoneNumberId = waConfig.phone_number_id

    const firstName = contactName?.split(' ')[0] || 'there'

    const bodyText =
      `Hello *${firstName}*! 👋\n\n` +
      `Welcome to *Realzentic Dubai*. We can help with Dubai property sales, rentals, off-plan opportunities, and viewings.\n\n` +
      `How may we assist you today?`

    let metaMessageId: string | undefined

    try {
      // Try sending interactive buttons (works in 24h window — customer just messaged us)
      const result = await sendInteractiveButtonMessage({
        phoneNumberId,
        accessToken,
        to: contactPhone,
        headerText: '🏙️ Realzentic Dubai',
        bodyText,
        footerText: 'Dubai real-estate enquiries and property viewings',
        buttons: [
          { id: 'INFO_PROPERTIES', title: '🏙️ Property Details' },
          { id: 'INFO_ADDRESS', title: '📍 Contact Details' },
          { id: 'SCHEDULE_APPOINTMENT', title: '📅 Schedule Viewing' },
        ],
      })
      metaMessageId = result.messageId
    } catch (interactiveErr) {
      console.warn('[inquiry-message] Interactive message failed, falling back to text:', interactiveErr)
      // Fallback to plain text if interactive fails
      const fallbackText =
        `Hello *${firstName}*! Welcome to *Realzentic Dubai*.\n\n` +
        `Reply with:\n` +
        `• *properties* — property types and services\n` +
        `• *contact* — our contact details\n` +
        `• *viewing* — schedule a property viewing`
      const result = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactPhone,
        text: fallbackText,
      })
      metaMessageId = result.messageId
    }

    if (!metaMessageId) return

    // Save welcome message to DB
    await prisma.waMessage.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: bodyText,
        message_id: metaMessageId,
        status: 'sent',
      },
    })

    await prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        last_message_text: bodyText,
        last_message_at: new Date(),
      },
    })

    console.log(`[inquiry-message] Welcome message sent to ${contactPhone} (conv: ${conversationId})`)
  } catch (err) {
    // Non-critical — log and move on
    console.error('[inquiry-message] Failed to send welcome message:', err)
  }
}

/**
 * Handle "INFO_PROPERTIES" button click — send property details text.
 */
export async function sendPropertyInfoMessage(
  userId: string,
  contactPhone: string,
  conversationId: string,
): Promise<void> {
  try {
    const waConfig = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
    if (!waConfig) return

    const accessToken = decrypt(waConfig.access_token)
    const text =
      `🏙️ *Realzentic Dubai — Property Services*\n\n` +
      `We can assist with:\n\n` +
      `🏠 *Residential*\n` +
      `  • Apartments, penthouses, villas, townhouses, and off-plan homes\n\n` +
      `🏢 *Commercial*\n` +
      `  • Retail, offices, warehouses, and investment opportunities\n\n` +
      `📅 *Property Viewings*\n` +
      `  • We will arrange a viewing once a consultant confirms availability.\n\n` +
      `Please share the location, property type, and your AED budget.`

    const result = await sendTextMessage({
      phoneNumberId: waConfig.phone_number_id,
      accessToken,
      to: contactPhone,
      text,
    })

    await prisma.waMessage.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: conversationId },
      data: { last_message_text: text, last_message_at: new Date() },
    })
  } catch (err) {
    console.error('[inquiry-message] sendPropertyInfoMessage failed:', err)
  }
}

/**
 * Handle "INFO_ADDRESS" button click — send address/location info.
 */
export async function sendAddressMessage(
  userId: string,
  contactPhone: string,
  conversationId: string,
): Promise<void> {
  try {
    const waConfig = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
    if (!waConfig) return

    const accessToken = decrypt(waConfig.access_token)
    const settings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
    const text =
      `📍 *Realzentic Dubai — Contact Details*\n\n` +
      `${settings?.storeName || 'Realzentic Dubai'}\n` +
      `${settings?.address || 'Dubai, United Arab Emirates'}\n\n` +
      `${settings?.phone ? `📞 *Phone:* ${settings.phone}\n` : ''}` +
      `${settings?.email ? `📧 *Email:* ${settings.email}\n` : ''}` +
      `\nReply *viewing* to request a property viewing. Our team will confirm the location and time.`

    const result = await sendTextMessage({
      phoneNumberId: waConfig.phone_number_id,
      accessToken,
      to: contactPhone,
      text,
    })

    await prisma.waMessage.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: conversationId },
      data: { last_message_text: text, last_message_at: new Date() },
    })
  } catch (err) {
    console.error('[inquiry-message] sendAddressMessage failed:', err)
  }
}
