'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { encrypt } from '@/lib/whatsapp/encryption'
import type { Contact } from '@prisma/client'

// Instagram & Facebook are handled by the unified Meta Messenger webhook
// (/api/social/webhook) and surfaced in the modern social inbox. Their
// credentials are stored in the dedicated ig_config / fb_config tables.
const SOCIAL_WEBHOOK_CHANNELS = new Set(['Instagram', 'Facebook'])

// ─── GET ALL CHANNEL CONFIGS ────────────────────────

export async function getChannelConfigs() {
  const configs = await prisma.channelConfig.findMany({
    orderBy: { channel: 'asc' },
  })
  return {
    success: true,
    data: configs.map(c => ({
      id: c.id,
      channel: c.channel,
      enabled: c.enabled,
      config: c.config as Record<string, string>,
      webhookUrl: c.webhookUrl,
    })),
  }
}

// ─── UPSERT CHANNEL CONFIG ─────────────────────────

export async function upsertChannelConfig(data: {
  channel: string
  enabled: boolean
  config: Record<string, string>
}) {
  let session
  try { session = await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const { channel, enabled, config } = data

  // Generate webhook URL based on channel.
  // Instagram & Facebook share the unified Meta Messenger webhook used by the
  // modern social inbox; other channels keep their dedicated endpoint.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookUrl = SOCIAL_WEBHOOK_CHANNELS.has(channel)
    ? `${baseUrl}/api/social/webhook`
    : `${baseUrl}/api/webhooks/${channel.toLowerCase().replace(/\s+/g, '')}`

  // For IG/FB, mirror the credentials into the dedicated config tables that the
  // unified webhook + inbox read. Do this before saving ChannelConfig so a
  // validation error (e.g. missing token) surfaces to the user.
  if (SOCIAL_WEBHOOK_CHANNELS.has(channel) && enabled) {
    const syncError = await syncSocialConfig(channel, enabled, config, String(session.user.id))
    if (syncError) return { success: false, error: syncError }
  } else if (SOCIAL_WEBHOOK_CHANNELS.has(channel) && !enabled) {
    // Disconnect: flip status in the dedicated table too.
    await disconnectSocialConfig(channel, String(session.user.id))
  }

  const result = await prisma.channelConfig.upsert({
    where: { channel },
    create: {
      channel,
      enabled,
      config,
      webhookUrl,
    },
    update: {
      enabled,
      config,
      webhookUrl,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/conversations')
  revalidatePath('/social-inbox')
  return { success: true, data: { id: result.id, webhookUrl: result.webhookUrl } }
}

// ─── SYNC SOCIAL CONFIG (Instagram / Facebook) ─────
// Writes the IG/FB credentials into ig_config / fb_config (tokens encrypted) so
// /api/social/webhook and the social inbox use them. Returns an error string on
// validation failure, or null on success.
async function syncSocialConfig(
  channel: string,
  enabled: boolean,
  config: Record<string, string>,
  userId: string,
): Promise<string | null> {
  const accessToken = config.accessToken?.trim()
  const verifyToken = config.verifyToken?.trim() || null
  const appSecret = config.appSecret?.trim()
  const encryptedSecret = appSecret ? encrypt(appSecret) : null
  const status = enabled ? 'connected' : 'disconnected'
  const connectedAt = enabled ? new Date() : null

  if (channel === 'Facebook') {
    const pageId = config.pageId?.trim()
    if (!pageId) return 'Facebook Page ID is required'
    if (!accessToken) return 'Page Access Token is required'
    const encryptedToken = encrypt(accessToken)
    await prisma.fbConfig.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        page_id: pageId,
        page_access_token: encryptedToken,
        app_secret: encryptedSecret,
        verify_token: verifyToken,
        status,
        connected_at: connectedAt,
      },
      update: {
        page_id: pageId,
        page_access_token: encryptedToken,
        // Only overwrite the stored secret when a new one was provided.
        ...(encryptedSecret ? { app_secret: encryptedSecret } : {}),
        verify_token: verifyToken,
        status,
        connected_at: connectedAt,
      },
    })
    return null
  }

  if (channel === 'Instagram') {
    const igAccountId = config.igAccountId?.trim()
    const linkedPageId = config.pageId?.trim()
    if (!igAccountId) return 'Instagram Business Account ID is required'
    if (!linkedPageId) return 'Linked Facebook Page ID is required'
    if (!accessToken) return 'Page Access Token is required'
    const encryptedToken = encrypt(accessToken)
    await prisma.igConfig.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        ig_account_id: igAccountId,
        page_id: linkedPageId,
        page_access_token: encryptedToken,
        app_secret: encryptedSecret,
        verify_token: verifyToken,
        status,
        connected_at: connectedAt,
      },
      update: {
        ig_account_id: igAccountId,
        page_id: linkedPageId,
        page_access_token: encryptedToken,
        ...(encryptedSecret ? { app_secret: encryptedSecret } : {}),
        verify_token: verifyToken,
        status,
        connected_at: connectedAt,
      },
    })
    return null
  }

  return null
}

async function disconnectSocialConfig(channel: string, userId: string) {
  if (channel === 'Facebook') {
    await prisma.fbConfig.updateMany({
      where: { user_id: userId },
      data: { status: 'disconnected', connected_at: null },
    })
  } else if (channel === 'Instagram') {
    await prisma.igConfig.updateMany({
      where: { user_id: userId },
      data: { status: 'disconnected', connected_at: null },
    })
  }
}

// ─── TOGGLE CHANNEL ────────────────────────────────

export async function toggleChannel(channel: string, enabled: boolean) {
  const existing = await prisma.channelConfig.findUnique({ where: { channel } })
  if (!existing) return { success: false, error: 'Channel not configured yet. Save settings first.' }

  await prisma.channelConfig.update({
    where: { channel },
    data: { enabled },
  })

  revalidatePath('/settings')
  revalidatePath('/conversations')
  return { success: true }
}

// ─── GET CHANNEL CONFIG (for webhook routes) ───────

export async function getChannelConfig(channel: string) {
  const config = await prisma.channelConfig.findUnique({ where: { channel } })
  if (!config || !config.enabled) return null
  return {
    id: config.id,
    channel: config.channel,
    enabled: config.enabled,
    config: config.config as Record<string, string>,
    webhookUrl: config.webhookUrl,
  }
}

// ─── CREATE CONVERSATION FROM WEBHOOK ──────────────

export async function createOrUpdateConversation(data: {
  channel: string
  externalId: string
  customerName: string
  customerPhone?: string
  message: string
}) {
  const { channel, externalId, customerName, customerPhone, message } = data
  const now = new Date()
  const time = now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true })

  // Find existing conversation by externalId + channel
  const existing = await prisma.conversation.findFirst({
    where: { externalId, channel },
  })

  if (existing) {
    const messages = (existing.messages as any[]) || []
    messages.push({ from: 'customer', text: message, time })

    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        messages,
        lastMessage: message,
        unread: existing.unread + 1,
        date: now,
      },
    })

    revalidatePath('/conversations')
    return { success: true, conversationId: existing.id, isNew: false }
  }

  // Find or create contact
  let contact: Contact | null = null
  if (customerPhone) {
    contact = await prisma.contact.findFirst({ where: { phone: customerPhone } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: customerName,
          phone: customerPhone,
          source: channel,
          address: '',
        },
      })
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      customerName,
      channel,
      externalId,
      contactId: contact?.id || null,
      status: 'AI_HANDLED',
      lastMessage: message,
      unread: 1,
      date: now,
      messages: [{ from: 'customer', text: message, time }],
    },
  })

  revalidatePath('/conversations')
  return { success: true, conversationId: conversation.id, isNew: true }
}

// ─── SEND OUTBOUND MESSAGE ─────────────────────────

export async function sendOutboundMessage(conversationId: number, text: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } })
  if (!conversation) return { success: false, error: 'Conversation not found' }

  const channelConfig = await prisma.channelConfig.findUnique({ where: { channel: conversation.channel } })
  const config = channelConfig?.config as Record<string, string> | null

  // Send to external platform
  let platformResult = { sent: false, error: '' }

  if (conversation.channel === 'WhatsApp' && config?.apiToken && conversation.externalId) {
    platformResult = await sendWhatsAppMessage(config, conversation.externalId, text)
  } else if (conversation.channel === 'Instagram' && config?.accessToken && conversation.externalId) {
    platformResult = await sendInstagramMessage(config, conversation.externalId, text)
  } else if (conversation.channel === 'Facebook' && config?.accessToken && conversation.externalId) {
    platformResult = await sendFacebookMessage(config, conversation.externalId, text)
  } else if (conversation.channel === 'Website') {
    // Website messages don't need external sending — they're served via polling/SSE
    platformResult = { sent: true, error: '' }
  } else {
    platformResult = { sent: true, error: '' } // Fallback: store locally even if no config
  }

  // Always save the message locally regardless of platform delivery
  const now = new Date()
  const time = now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true })
  const messages = (conversation.messages as any[]) || []
  messages.push({ from: 'staff', text, time })

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      messages,
      lastMessage: text,
      date: now,
    },
  })

  revalidatePath('/conversations')
  return {
    success: true,
    platformDelivered: platformResult.sent,
    platformError: platformResult.error || undefined,
  }
}

// ─── PLATFORM SEND HELPERS ─────────────────────────

async function sendWhatsAppMessage(config: Record<string, string>, to: string, text: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
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
      return { sent: false, error: `WhatsApp API error: ${err}` }
    }
    return { sent: true, error: '' }
  } catch (err: any) {
    return { sent: false, error: err.message }
  }
}

async function sendInstagramMessage(config: Record<string, string>, recipientId: string, text: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.pageId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      return { sent: false, error: `Instagram API error: ${err}` }
    }
    return { sent: true, error: '' }
  } catch (err: any) {
    return { sent: false, error: err.message }
  }
}

async function sendFacebookMessage(config: Record<string, string>, recipientId: string, text: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.pageId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      return { sent: false, error: `Facebook API error: ${err}` }
    }
    return { sent: true, error: '' }
  } catch (err: any) {
    return { sent: false, error: err.message }
  }
}
