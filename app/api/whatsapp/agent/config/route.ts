import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai-agent/system-prompt'

/**
 * GET /api/whatsapp/agent/config
 * Returns the current user's AI agent configuration.
 * If no config exists, returns defaults.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)
    const config = await prisma.waAgentConfig.findUnique({ where: { user_id: userId } })

    if (!config) {
      // Return defaults so the UI can show something sensible on first load
      return NextResponse.json({
        enabled: false,
        agent_name: 'Assistant',
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        fallback_message: "Let me connect you with our team.",
        confidence_threshold: 0.45,
        max_response_tokens: 300,
        response_delay_ms: 1500,
        languages: ['en'],
      })
    }

    return NextResponse.json({
      id: config.id,
      enabled: config.enabled,
      agent_name: config.agent_name,
      system_prompt: config.system_prompt,
      fallback_message: config.fallback_message,
      confidence_threshold: config.confidence_threshold,
      max_response_tokens: config.max_response_tokens,
      response_delay_ms: config.response_delay_ms,
      languages: config.languages,
      created_at: config.created_at.toISOString(),
      updated_at: config.updated_at.toISOString(),
    })
  } catch (error) {
    console.error('[agent/config GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/agent/config
 * Create or update the AI agent configuration for the current user.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    let body: {
      enabled?: boolean
      agent_name?: string
      system_prompt?: string
      fallback_message?: string
      confidence_threshold?: number
      max_response_tokens?: number
      response_delay_ms?: number
      languages?: string[]
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const data = {
      enabled:              body.enabled              ?? false,
      agent_name:           body.agent_name           ?? 'Assistant',
      system_prompt:        body.system_prompt        ?? DEFAULT_SYSTEM_PROMPT,
      fallback_message:     body.fallback_message     ?? "Let me connect you with our team.",
      confidence_threshold: body.confidence_threshold ?? 0.45,
      max_response_tokens:  body.max_response_tokens  ?? 300,
      response_delay_ms:    body.response_delay_ms    ?? 1500,
      languages:            body.languages            ?? ['en'],
    }

    const config = await prisma.waAgentConfig.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...data },
      update: data,
    })

    return NextResponse.json({ success: true, id: config.id })
  } catch (error) {
    console.error('[agent/config POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
