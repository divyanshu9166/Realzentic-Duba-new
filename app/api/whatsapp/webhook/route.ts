import { NextResponse } from 'next/server'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyWhatsAppWebhookSignature } from '@/lib/whatsapp/webhook-secret'
import { runAutomationsForTrigger, hasMatchingKeywordAutomation } from '@/lib/automations/engine'
import { prisma } from '@/lib/db'
import { publishEvent } from '@/lib/redis'
import { getAutomationQueue, getAiAgentQueue } from '@/lib/queues/jobs'
import { WHATSAPP_INQUIRY_SOURCE } from '@/lib/lead-sources'
import {
  sendInquiryWelcomeMessage,
  sendPropertyInfoMessage,
  sendAddressMessage,
} from '@/lib/whatsapp/inquiry-message'
import { autoQualifyLeadFromWhatsApp } from '@/app/actions/lead-qualification'
import { notifyLeadCaptured } from '@/lib/notify'
import {
  getBotState,
  startAppointmentBot,
  handleAppointmentBotMessage,
} from '@/lib/whatsapp/appointment-bot'

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  context?: { id: string }
  /** Interactive button/list reply from the customer */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    const configs = await prisma.waWhatsappConfig.findMany({
      select: { id: true, verify_token: true },
    })

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void prisma.waWhatsappConfig
          .update({
            where: { id: matchedConfig.id },
            data: { verify_token: encrypt(verifyToken) },
          })
          .catch((error) => {
            console.warn(
              '[webhook] verify_token GCM upgrade failed:',
              error instanceof Error ? error.message : error,
            )
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!(await verifyWhatsAppWebhookSignature(rawBody, signature))) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhook(body).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id
      const config = await prisma.waWhatsappConfig.findFirst({
        where: { phone_number_id: phoneNumberId },
      })

      if (!config) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.user_id,
          decryptedAccessToken
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status.
  try {
    await prisma.waMessage.updateMany({
      where: { message_id: status.id },
      data: { status: status.status },
    })
  } catch (error) {
    console.error('Error updating message status:', error)
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id, then
  //    recompute the parent broadcast's aggregate counts directly in
  //    application code. We do NOT rely on a Postgres trigger here so
  //    counts stay correct even if the DB migration that installs the
  //    trigger hasn't been applied to the live database.
  const tsDate = new Date(parseInt(status.timestamp) * 1000)

  let recipient: { id: string; status: string; broadcast_id: string } | null = null

  try {
    recipient = await prisma.waBroadcastRecipient.findFirst({
      where: { whatsapp_message_id: status.id },
      select: { id: true, status: true, broadcast_id: true },
    })
  } catch (error) {
    console.error('Error fetching broadcast recipient:', error)
    return
  }

  if (!recipient) return // message wasn't part of a broadcast — fine

  // Guard transitions — forward-only on the success ladder, and
  // `failed` only from pre-delivered states.
  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent') update.sent_at = tsDate
  if (status.status === 'delivered') update.delivered_at = tsDate
  if (status.status === 'read') update.read_at = tsDate

  try {
    await prisma.waBroadcastRecipient.update({
      where: { id: recipient.id },
      data: update,
    })
  } catch (error) {
    console.error('Error updating broadcast recipient status:', error)
    return
  }

  // Recompute aggregate counts on the parent broadcast from the
  // current state of all its recipients. This is a cheap indexed
  // GROUP BY and ensures the analytics cards on the broadcast detail
  // page stay accurate without requiring a DB-level trigger.
  try {
    const broadcastId = recipient.broadcast_id
    const agg = await prisma.waBroadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcast_id: broadcastId },
      _count: { status: true },
    })

    const countByStatus: Record<string, number> = {}
    for (const row of agg) {
      countByStatus[row.status] = row._count.status
    }

    const s = (k: string) => countByStatus[k] ?? 0
    const sent_count = s('sent') + s('delivered') + s('read') + s('replied')
    const delivered_count = s('delivered') + s('read') + s('replied')
    const read_count = s('read') + s('replied')
    const replied_count = s('replied')
    const failed_count = s('failed')

    await prisma.waBroadcast.update({
      where: { id: broadcastId },
      data: { sent_count, delivered_count, read_count, replied_count, failed_count },
    })
  } catch (error) {
    console.error('Error recomputing broadcast aggregate counts:', error)
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    // Most recent outbound broadcast that hasn't been replied to yet.
    const row = await prisma.waBroadcastRecipient.findFirst({
      where: {
        contact_id: contactId,
        status: { in: ['sent', 'delivered', 'read'] },
        broadcast: { user_id: userId },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, broadcast_id: true },
    })

    if (!row) return

    await prisma.waBroadcastRecipient.update({
      where: { id: row.id },
      data: { status: 'replied', replied_at: new Date() },
    })

    // Recompute the parent broadcast aggregate counts now that this
    // recipient moved to 'replied'. Same pattern as handleStatusUpdate —
    // avoids relying on the DB trigger so counts stay correct regardless
    // of whether the migration has been applied to the live DB.
    const broadcastId = row.broadcast_id
    const agg = await prisma.waBroadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcast_id: broadcastId },
      _count: { status: true },
    })
    const countByStatus: Record<string, number> = {}
    for (const r of agg) { countByStatus[r.status] = r._count.status }
    const s = (k: string) => countByStatus[k] ?? 0
    await prisma.waBroadcast.update({
      where: { id: broadcastId },
      data: {
        sent_count: s('sent') + s('delivered') + s('read') + s('replied'),
        delivered_count: s('delivered') + s('read') + s('replied'),
        read_count: s('read') + s('replied'),
        replied_count: s('replied'),
        failed_count: s('failed'),
      },
    })
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  try {
    const row = await prisma.waMessage.findFirst({
      where: { message_id: metaId, conversation_id: conversationId },
      select: { id: true },
    })

    return row?.id ?? null
  } catch (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error)
    return null
  }
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )

  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  if (!reaction.emoji) {
    try {
      await prisma.waMessageReaction.deleteMany({
        where: {
          message_id: targetInternalId,
          actor_type: 'customer',
          actor_id: contactId,
        },
      })
    } catch (error) {
      console.error('[webhook] reaction delete failed:', error)
    }
    return
  }

  try {
    await prisma.waMessageReaction.upsert({
      where: {
        message_id_actor_type_actor_id: {
          message_id: targetInternalId,
          actor_type: 'customer',
          actor_id: contactId,
        },
      },
      update: { emoji: reaction.emoji },
      create: {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
    })
  } catch (error) {
    console.error('[webhook] reaction upsert failed:', error)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    userId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    userId,
    contactRecord.id
  )
  if (!conversation) return

  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // ── Interactive button reply handling ───────────────────────────────────
  // Customer clicked one of our quick-reply buttons (inquiry welcome / slot picker).
  if (message.type === 'interactive' && message.interactive?.button_reply) {
    const buttonId = message.interactive.button_reply.id
    const buttonTitle = message.interactive.button_reply.title
    const waConfigRow = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
    if (waConfigRow) {
      const waConfig = { phoneNumberId: waConfigRow.phone_number_id, accessToken: decrypt(waConfigRow.access_token) }
      if (buttonId === 'SCHEDULE_APPOINTMENT') {
        await startAppointmentBot({ conversationId: conversation.id, contactId: contactRecord.id, contactPhone: senderPhone, contactName: contactName || senderPhone, userId }, waConfig)
        return
      }
      if (buttonId === 'INFO_PROPERTIES') {
        await sendPropertyInfoMessage(userId, senderPhone, conversation.id)
        return
      }
      if (buttonId === 'INFO_ADDRESS') {
        await sendAddressMessage(userId, senderPhone, conversation.id)
        return
      }
      if (buttonId.startsWith('SLOT_')) {
        const handled = await handleAppointmentBotMessage({ conversationId: conversation.id, contactId: contactRecord.id, contactPhone: senderPhone, contactName: contactName || senderPhone, userId, incomingText: buttonTitle, buttonReplyId: buttonId }, waConfig)
        if (handled) return
      }
    }
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType } = await parseMessageContent(
    message,
    accessToken
  )
  const inboundText = contentText ?? message.text?.body ?? ''

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )

    if (!replyToInternalId) {
      console.warn('[webhook] reply context parent not found:', message.context.id)
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, template_name, message_id, status, created_at
  // `mediaType` is intentionally unused — the schema has no media_type
  // column; the MIME type is only used to construct the proxy URL during
  // parseMessageContent. Silence the unused-var warning:
  void mediaType

  // The messages.content_type CHECK constraint only allows:
  //   text, image, document, audio, video, location, template
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'template',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'   // stickers are images
      : 'text'    // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const priorCustomerMsgCount = await prisma.waMessage.count({
    where: { conversation_id: conversation.id, sender_type: 'customer' },
  })
  const isFirstInboundMessage = priorCustomerMsgCount === 0

  let createdMessage: any = null

  try {
    createdMessage = await prisma.waMessage.create({
      data: {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.id,
        status: 'delivered',
        created_at: new Date(parseInt(message.timestamp) * 1000),
        reply_to_message_id: replyToInternalId,
      },
    })
  } catch (error) {
    console.error('Error inserting message:', error)
    return
  }

  await syncInboundInquiryToCrm({
    phone: senderPhone,
    name: contactName,
    messageText: inboundText,
  })

  // ── Send 3-button inquiry welcome to brand-new contacts ─────────────────
  // isFirstInboundMessage is true when the contact has NEVER messaged us.
  // We reply with the welcome menu — the AI agent is skipped for this message.
  if (isFirstInboundMessage) {
    sendInquiryWelcomeMessage({
      userId,
      contactPhone: senderPhone,
      contactName: contactName || senderPhone,
      conversationId: conversation.id,
      incomingMessageId: message.id,
    }).catch((err) => console.error('[webhook] sendInquiryWelcomeMessage failed:', err))

    // Auto-qualify the lead from their first message (fire-and-forget)
    if (inboundText) {
      autoQualifyLeadFromWhatsApp(contactRecord.id, inboundText)
        .catch((err) => console.error('[webhook] lead qualification failed:', err))
    }
  }

  // Update conversation and capture the result for the publish event
  let updatedConversation: any = null
  try {
    updatedConversation = await prisma.waConversation.update({
      where: { id: conversation.id },
      data: {
        last_message_text: contentText || `[${message.type}]`,
        last_message_at: new Date(),
        unread_count: { increment: 1 },
      },
      select: {
        id: true,
        last_message_text: true,
        last_message_at: true,
        unread_count: true,
      },
    })
  } catch (error) {
    console.error('Error updating conversation:', error)
  }

  // ── Real-time: publish UI events to Redis Pub/Sub ────────────────────────
  // These are fire-and-forget: a dropped event only means the browser
  // doesn't update until the next poll — the message is already in DB.
  if (createdMessage) {
    await publishEvent('chat_events', {
      type: 'new_message',
      userId,
      conversationId: conversation.id,
      payload: {
        message: {
          id: createdMessage.id,
          conversation_id: createdMessage.conversation_id,
          sender_type: createdMessage.sender_type,
          content_type: createdMessage.content_type,
          content_text: createdMessage.content_text,
          media_url: createdMessage.media_url,
          message_id: createdMessage.message_id,
          status: createdMessage.status,
          created_at: createdMessage.created_at.toISOString(),
          reply_to_message_id: createdMessage.reply_to_message_id,
        },
      },
    })
  }

  if (updatedConversation) {
    await publishEvent('chat_events', {
      type: 'conversation_update',
      userId,
      conversationId: conversation.id,
      payload: {
        // Send absolute values (not deltas) — the frontend merges them
        // directly into the conversation object.
        last_message_text: updatedConversation.last_message_text,
        last_message_at: updatedConversation.last_message_at.toISOString(),
        unread_count: updatedConversation.unread_count,
      },
    })
  }

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(userId, contactRecord.id)

  // ── BullMQ: enqueue automation triggers (durable, retryable) ───────────
  // Using BullMQ instead of fire-and-forget so a transient failure (e.g.
  // automation engine timeout) doesn't silently drop triggers. BullMQ
  // persists jobs in Redis and retries with exponential backoff.
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = ['new_message_received', 'keyword_match']
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    getAutomationQueue()
      .add(
        triggerType,
        {
          userId,
          triggerType,
          contactId: contactRecord.id,
          context: {
            message_text: inboundText,
            conversation_id: conversation.id,
          },
        },
        // Unique job key per (contact × trigger × message) prevents duplicate
        // processing if Meta re-delivers the same webhook event.
        {
          jobId: `${triggerType}:${contactRecord.id}:${message.id}`,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      )
      .catch((err) => console.error('[queues] automationQueue.add failed:', err))
  }

  // ── BullMQ: enqueue AI agent job (if agent is enabled + conversation is open)
  // Only process text messages — skip media/stickers/locations.
  // Also skip for first-inbound-message contacts — the welcome menu IS the reply.
  if (!isFirstInboundMessage && message.type === 'text' && inboundText && conversation.status === 'open') {
    // ── Appointment bot takes priority over AI agent ───────────────────────
    const activeBotState = await getBotState(conversation.id).catch(() => null)
    if (activeBotState) {
      const waConfigRow = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
      if (waConfigRow) {
        const waConfig = { phoneNumberId: waConfigRow.phone_number_id, accessToken: decrypt(waConfigRow.access_token) }
        const handled = await handleAppointmentBotMessage({ conversationId: conversation.id, contactId: contactRecord.id, contactPhone: senderPhone, contactName: contactName || senderPhone, userId, incomingText: inboundText }, waConfig).catch(() => false)
        if (handled) {
          console.log(`[webhook] msg ${message.id} handled by appointment bot`)
          return
        }
      }
    }

    // PREVENT CONFLICT: if a keyword automation matched, skip the AI entirely
    const willBeHandledByAutomation = await hasMatchingKeywordAutomation(userId, inboundText)

    if (!willBeHandledByAutomation) {
      getAiAgentQueue()
        .add(
          'handle_message',
          {
            userId,
            conversationId: conversation.id,
            contactId: contactRecord.id,
            contactPhone: senderPhone,
            messageText: inboundText,
            incomingMessageId: message.id,
          },
          {
            jobId: `ai-agent:${contactRecord.id}:${message.id}`,
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
          },
        )
        .catch((err) => console.error('[queues] aiAgentQueue.add failed:', err))
    } else {
      console.log(`[webhook] skipped AI agent for msg ${message.id} (keyword automation match)`)
    }
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  switch (message.type) {
    case 'text':
      return {
        contentText: message.text?.body || null,
        mediaUrl: null,
        mediaType: null,
      }

    case 'image':
      if (message.image?.id) {
        return {
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'video':
      if (message.video?.id) {
        return {
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'document':
      if (message.document?.id) {
        return {
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'audio':
      if (message.audio?.id) {
        return {
          contentText: null,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          contentText: null,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return {
          contentText: locationText,
          mediaUrl: null,
          mediaType: null,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'reaction':
      return {
        contentText: message.reaction?.emoji || null,
        mediaUrl: null,
        mediaType: null,
      }

    default:
      return {
        contentText: `[Unsupported message type: ${message.type}]`,
        mediaUrl: null,
        mediaType: null,
      }
  }
}

type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  userId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Look up existing contacts for this user
  let contacts: ContactRow[] = []

  try {
    contacts = await prisma.waContact.findMany({
      where: { user_id: userId },
    })
  } catch (error) {
    console.error('Error fetching contacts:', error)
    return null
  }

  // Use phonesMatch for flexible matching
  const existingContact = contacts?.find((c: ContactRow) => phonesMatch(c.phone, phone))

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      try {
        await prisma.waContact.update({
          where: { id: existingContact.id },
          data: { name },
        })
      } catch (error) {
        console.error('Error updating contact name:', error)
      }
    }
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact
  let newContact: ContactRow

  try {
    newContact = await prisma.waContact.create({
      data: {
        user_id: userId,
        phone,
        name: name || phone,
      },
    })
  } catch (error) {
    console.error('Error creating contact:', error)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  // Look for existing conversation
  try {
    const existing = await prisma.waConversation.findFirst({
      where: { user_id: userId, contact_id: contactId },
    })

    if (existing) return existing
  } catch (error) {
    console.error('Error fetching conversation:', error)
  }

  // Create new conversation
  try {
    return await prisma.waConversation.create({
      data: { user_id: userId, contact_id: contactId },
    })
  } catch (error) {
    console.error('Error creating conversation:', error)
    return null
  }
}

async function syncInboundInquiryToCrm({
  phone,
  name,
  messageText,
}: {
  phone: string
  name: string
  messageText: string
}) {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) return

  const last10 = normalizedPhone.slice(-10)
  const contactName = name?.trim() || normalizedPhone

  try {
    const candidates = await prisma.contact.findMany({
      where: last10
        ? {
          OR: [
            { phone: normalizedPhone },
            { phone: { contains: last10 } },
          ],
        }
        : { phone: normalizedPhone },
      select: { id: true, phone: true, name: true, source: true },
      take: 10,
    })

    let crmContact = candidates.find((c) => phonesMatch(c.phone, normalizedPhone))

    if (!crmContact) {
      crmContact = await prisma.contact.create({
        data: {
          name: contactName,
          phone: normalizedPhone,
          source: WHATSAPP_INQUIRY_SOURCE,
          notes: 'Auto-captured from incoming WhatsApp inquiry.',
        },
        select: { id: true, phone: true, name: true, source: true },
      })
    } else {
      const update: { name?: string; source?: string } = {}
      if ((!crmContact.name || crmContact.name === crmContact.phone) && contactName) {
        update.name = contactName
      }
      if (!crmContact.source) {
        update.source = WHATSAPP_INQUIRY_SOURCE
      }

      if (Object.keys(update).length > 0) {
        crmContact = await prisma.contact.update({
          where: { id: crmContact.id },
          data: update,
          select: { id: true, phone: true, name: true, source: true },
        })
      }
    }

    const existingLead = await prisma.lead.findFirst({
      where: {
        contactId: crmContact.id,
        source: WHATSAPP_INQUIRY_SOURCE,
        status: { notIn: ['WON', 'LOST'] },
      },
      select: { id: true },
    })

    if (existingLead) return

    const trimmedMessage = messageText.trim()
    const interest = trimmedMessage
      ? trimmedMessage.slice(0, 120)
      : 'WhatsApp inquiry'

    const createdLead = await prisma.lead.create({
      data: {
        contactId: crmContact.id,
        source: WHATSAPP_INQUIRY_SOURCE,
        interest,
        status: 'NEW',
        notes: trimmedMessage
          ? `Auto-created from incoming WhatsApp message: ${trimmedMessage.slice(0, 500)}`
          : 'Auto-created from incoming WhatsApp message.',
      },
    })

    await notifyLeadCaptured({
      channel: 'WhatsApp',
      leadId: createdLead.id,
      contactName: crmContact.name,
      interest,
    })
  } catch (error) {
    console.error('[webhook] failed to sync inbound inquiry to CRM:', error)
  }
}
