import { NextResponse } from 'next/server'
import { processWorkOrderSlaBreaches } from '@/app/actions/work-orders'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ success: true, ...(await processWorkOrderSlaBreaches()) }) }
  catch (error) { console.error('[cron] maintenance SLA error:', error); return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }) }
}
