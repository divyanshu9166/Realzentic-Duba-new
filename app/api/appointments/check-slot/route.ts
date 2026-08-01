import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/appointments/check-slot?date=YYYY-MM-DD&time=HH:MM+AM
 *
 * Checks whether a specific date+time slot is available for a new appointment.
 * A slot is considered taken if any appointment exists on the same date
 * within ±60 minutes of the requested time.
 *
 * Returns:
 *   { available: true }
 *   { available: false, suggestions: ["10:00 AM", "2:00 PM", ...] }
 *
 * Called by:
 *   - AI calling agent before confirming a property viewing on call
 *   - WhatsApp appointment chatbot after customer picks a time
 */

// Fixed property-viewing slots — 10 AM to 5 PM
const ALL_SLOTS = [
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
]

/** Convert "HH:MM AM/PM" or "HH AM/PM" or "HH:MM" → minutes since midnight */
function timeToMinutes(t: string): number {
  const normalized = t.trim().toUpperCase()
  // Match HH:MM AM/PM, HH AM/PM, or just HH:MM (assumes 24-hour if no AM/PM, but falls back to AM/PM logic)
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/)
  if (!match) return -1
  
  let hours = parseInt(match[1], 10)
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  const period = match[3]
  
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  
  // If no AM/PM provided and hours between 1 and 7, assume PM (e.g. "2:00" -> 2 PM) 
  // since property viewings are scheduled between 10 AM and 5 PM
  if (!period && hours >= 1 && hours <= 7) {
    hours += 12
  }

  return hours * 60 + minutes
}

export async function GET(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')   // e.g. "2026-06-10"
  const timeStr = searchParams.get('time')   // e.g. "11:00 AM"

  if (!dateStr || !timeStr) {
    return NextResponse.json(
      { error: 'date and time query parameters are required' },
      { status: 400 },
    )
  }

  // Parse date — accept YYYY-MM-DD
  const requestedDate = new Date(dateStr)
  if (isNaN(requestedDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
  }

  const requestedMinutes = timeToMinutes(timeStr)
  if (requestedMinutes < 0) {
    return NextResponse.json(
      { error: 'Invalid time format. Use HH:MM AM/PM (e.g. 11:00 AM).' },
      { status: 400 },
    )
  }

  try {
    // Fetch all appointments on the requested date
    const dayStart = new Date(dateStr)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dateStr)
    dayEnd.setHours(23, 59, 59, 999)

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'Cancelled' },
      },
      select: { time: true },
    })

    // Check if requested slot conflicts (±60 minutes)
    const CONFLICT_WINDOW_MINUTES = 60
    const conflictingSlot = existingAppointments.find((appt) => {
      const apptMinutes = timeToMinutes(appt.time)
      return Math.abs(apptMinutes - requestedMinutes) < CONFLICT_WINDOW_MINUTES
    })

    if (!conflictingSlot) {
      return NextResponse.json({ available: true })
    }

    // Slot is taken — find available slots from the fixed list
    const bookedMinutes = new Set(
      existingAppointments.map((a) => timeToMinutes(a.time)).filter((m) => m >= 0),
    )

    const suggestions = ALL_SLOTS.filter((slot) => {
      const slotMin = timeToMinutes(slot)
      return !Array.from(bookedMinutes).some(
        (booked) => Math.abs(booked - slotMin) < CONFLICT_WINDOW_MINUTES,
      )
    })

    return NextResponse.json({
      available: false,
      suggestions: suggestions.slice(0, 4), // return up to 4 alternatives
    })
  } catch (error) {
    console.error('[check-slot] error:', error)
    return NextResponse.json({ error: 'Failed to check slot availability' }, { status: 500 })
  }
}
