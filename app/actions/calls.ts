'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createCallLogSchema } from '@/lib/validations/call'
import type { CallDirection, CallStatus } from '@prisma/client'

export async function getCallLogs() {
  const calls = await prisma.callLog.findMany({
    include: { contact: true, transcript: true },
    orderBy: { date: 'desc' },
  })

  return {
    success: true,
    data: calls.map(c => ({
      id: c.id,
      customer: c.customerName,
      phone: c.phone,
      direction: c.direction === 'INBOUND' ? 'Inbound' : 'Outbound',
      status: c.status.charAt(0) + c.status.slice(1).toLowerCase().replace('_', ' '),
      duration: c.duration,
      durationSec: c.durationSec,
      agent: c.agent,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(c.date),
      time: c.date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }),
      purpose: c.purpose,
      outcome: c.outcome,
      notes: c.notes,
      recording: c.recording,
      aiHandled: c.aiHandled,
      callType: c.callType,
      transcript: c.transcript ? {
        summary: c.transcript.summary,
        sentiment: c.transcript.sentiment,
        messages: c.transcript.messages,
      } : null,
    })),
  }
}

export async function createCallLog(data: unknown) {
  const parsed = createCallLogSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { customerName, phone, direction, status, duration, durationSec, agent, purpose, outcome, notes, recording } = parsed.data

  // Try to link to existing contact
  const contact = await prisma.contact.findFirst({ where: { phone } })

  const now = new Date()
  const callLog = await prisma.callLog.create({
    data: {
      contactId: contact?.id,
      customerName,
      phone,
      direction: direction as CallDirection,
      status: status as CallStatus,
      duration,
      durationSec,
      agent,
      date: now,
      time: now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }),
      purpose,
      outcome,
      notes,
      recording,
    },
  })

  revalidatePath('/calls')
  return { success: true, data: callLog }
}

export async function getCallStats() {
  const [total, completed, missed, totalDuration, aiHandled] = await Promise.all([
    prisma.callLog.count(),
    prisma.callLog.count({ where: { status: 'COMPLETED' } }),
    prisma.callLog.count({ where: { status: 'MISSED' } }),
    prisma.callLog.aggregate({ _sum: { durationSec: true } }),
    prisma.callLog.count({ where: { aiHandled: true } }),
  ])

  return {
    success: true,
    data: {
      total,
      completed,
      missed,
      aiHandled,
      avgDuration: total > 0 ? Math.round((totalDuration._sum.durationSec || 0) / total) : 0,
    },
  }
}

export async function initiateAICall(phoneNumber: string, reason: string, customerName: string = '') {
  try {
    const LIVEKIT_URL = process.env.LIVEKIT_URL
    const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY
    const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return { success: false, error: 'LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in .env' }
    }

    const { createRoom, dispatchAgent } = await import('@/lib/livekit')
    const roomName = `outbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await createRoom(roomName)
    await dispatchAgent(roomName, {
      call_type: 'outbound',
      phone_number: phoneNumber,
      reason: reason || 'Follow-up call',
      customer_name: customerName || '',
    })

    revalidatePath('/calls')
    return { success: true, data: { roomName, message: `Call initiated to ${phoneNumber}` } }
  } catch (error: any) {
    console.error('Failed to initiate AI call:', error)
    return { success: false, error: error?.message || 'Failed to initiate call' }
  }
}

export async function getAIAgentStatus() {
  const livekitConfigured = !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)
  const hasDeepgram = !!process.env.DEEPGRAM_API_KEY
  const hasGroq = !!process.env.GROQ_API_KEY
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  const hasLlm = hasGroq || hasOpenAI
  const hasSipTrunk = !!process.env.OUTBOUND_SIP_TRUNK_ID
  const configured = livekitConfigured && hasDeepgram && hasLlm

  return {
    success: true,
    data: {
      configured,
      agentName: process.env.AI_AGENT_NAME || 'Maya',
      livekitUrl: livekitConfigured ? process.env.LIVEKIT_URL : null,
      hasLiveKit: livekitConfigured,
      hasDeepgram,
      hasGroq,
      hasOpenAI,
      hasLlm,
      hasVobiz: !!process.env.VOBIZ_SIP_DOMAIN || hasSipTrunk,
      hasSipTrunk,
    },
  }
}
