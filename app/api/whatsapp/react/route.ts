import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { sendReactionMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhoneForMetaUae } from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const { message_id, emoji } = body as {
      message_id?: string
      emoji?: string
    }

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 }
      )
    }

    const targetMessage = await prisma.waMessage.findFirst({
      where: { id: message_id },
      select: { id: true, message_id: true, conversation_id: true },
    })

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (!targetMessage.message_id) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 }
      )
    }

    const conversation = await prisma.waConversation.findFirst({
      where: { id: targetMessage.conversation_id, user_id: userId },
      include: { contact: { select: { phone: true } } },
    })

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact

    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    const config = await prisma.waWhatsappConfig.findFirst({
      where: { user_id: userId },
      select: { phone_number_id: true, access_token: true },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 }
      )
    }

    try {
      await sendReactionMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
        to: normalizePhoneForMetaUae(contact.phone),
        targetMessageId: targetMessage.message_id,
        emoji,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/react] Meta send failed:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      )
    }

    if (emoji === '') {
      const result = await prisma.waMessageReaction.deleteMany({
        where: {
          message_id: targetMessage.id,
          actor_type: 'agent',
          actor_id: userId,
        },
      })

      if (result.count === 0) {
        return NextResponse.json({ success: true })
      }
    } else {
      await prisma.waMessageReaction.upsert({
        where: {
          message_id_actor_type_actor_id: {
            message_id: targetMessage.id,
            actor_type: 'agent',
            actor_id: userId,
          },
        },
        update: { emoji },
        create: {
          message_id: targetMessage.id,
          conversation_id: targetMessage.conversation_id,
          actor_type: 'agent',
          actor_id: userId,
          emoji,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error)
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 }
    )
  }
}
