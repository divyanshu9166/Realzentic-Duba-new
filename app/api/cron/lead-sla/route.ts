import { NextResponse } from 'next/server'
import { processLeadSlaBreaches } from '@/app/actions/lead-routing'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await processLeadSlaBreaches()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[cron] lead SLA error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
