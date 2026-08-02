import { NextResponse } from 'next/server'
import { processMaintenanceSchedules } from '@/app/actions/work-orders'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ success: true, ...(await processMaintenanceSchedules()) }) }
  catch (error) { console.error('[cron] maintenance schedule error:', error); return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }) }
}
