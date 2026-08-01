import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * POST /api/calls/schedule-callback
 * Called by the AI agent when a customer requests a callback.
 * Creates a call log entry with the callback details.
 */
export async function POST(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { customerName, phone, preferredTime, reason } = await req.json()

    // Try to link to existing contact
    const contact = phone ? await prisma.contact.findFirst({ where: { phone } }) : null

    const now = new Date()

    const callLog = await prisma.callLog.create({
      data: {
        contactId: contact?.id,
        customerName: customerName || 'Unknown',
        phone: phone || 'Unknown',
        direction: 'OUTBOUND',
        status: 'COMPLETED',
        duration: '0:00',
        durationSec: 0,
        agent: 'AI Agent - Anushka',
        date: now,
        time: now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }),
        purpose: `Callback requested: ${reason || 'General'}`,
        outcome: 'Callback Scheduled',
        notes: `Customer requested callback at ${preferredTime}. Reason: ${reason}`,
        recording: false,
        callType: 'ai_inbound',
        aiHandled: true,
      },
    })

    return NextResponse.json({ success: true, data: { id: callLog.id } })
  } catch (error) {
    console.error('Failed to schedule callback:', error)
    return NextResponse.json({ error: 'Failed to schedule callback' }, { status: 500 })
  }
}
