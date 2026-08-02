import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { agentLocationRetentionCutoff } from '@/lib/agent-location'
import { processAbandonedQuoteCampaigns, processDueAutomatedEmailRecipients } from '@/app/actions/email-campaigns'

export async function GET(request: Request) {
  try {
    // Cleanup contains employee GPS data, so this endpoint must never be
    // callable without a configured secret, including by accident in production.
    const authHeader = request.headers.get('authorization')
    const secret = process.env.CRON_SECRET

    if (!secret) {
      console.error('[cron] CRON_SECRET is not configured')
      return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // 1. Delete messages older than 30 days (even if the conversation is still active)
    const deletedMessages = await prisma.waMessage.deleteMany({
      where: {
        created_at: {
          lt: thirtyDaysAgo
        }
      }
    })

    // 2. Delete empty/stale conversations
    // (Created > 30 days ago AND last message was > 30 days ago, or never had a message)
    const deletedConversations = await prisma.waConversation.deleteMany({
      where: {
        AND: [
          { created_at: { lt: thirtyDaysAgo } },
          {
            OR: [
              { last_message_at: { lt: thirtyDaysAgo } },
              { last_message_at: null }
            ]
          }
        ]
      }
    })

    // 3. GPS pings are operational data, not permanent employee history.
    // Keep a short audit window for route/visit review, then remove them.
    const deletedAgentLocations = await prisma.agentLocation.deleteMany({
      where: {
        recordedAt: {
          lt: agentLocationRetentionCutoff()
        }
      }
    })

    // 4. Deliver delayed event-driven email campaigns. This is idempotent at
    // recipient level and skips contacts who unsubscribed after queueing.
    const processedAutomatedEmails = await processDueAutomatedEmailRecipients()
    const processedAbandonedQuotes = await processAbandonedQuoteCampaigns()
    return NextResponse.json({
      success: true,
      message: 'Retention cleanup complete',
      deletedMessages: deletedMessages.count,
      deletedConversations: deletedConversations.count,
      deletedAgentLocations: deletedAgentLocations.count,
      processedAutomatedEmails,
      processedAbandonedQuotes,
    })
  } catch (error) {
    console.error('[cron] cleanup error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
