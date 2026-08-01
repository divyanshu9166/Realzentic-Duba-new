import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * POST /api/appointments/create
 * Called by the AI agent to book Dubai property viewings and appointments.
 */
export async function POST(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { customerName, phone, date, time, purpose, notes } = body

    if (!customerName || !phone || !date || !time) {
      return NextResponse.json({ error: 'customerName, phone, date, and time are required' }, { status: 400 })
    }

    // Find or create the contact
    let contact = await prisma.contact.findFirst({ where: { phone } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: { name: customerName, phone },
      })
    }

    const appointment = await prisma.appointment.create({
      data: {
        contactId: contact.id,
        date: new Date(date),
        time: time,
        purpose: purpose || 'Site Visit',
        notes: notes || 'Booked via Realzentic Dubai AI Agent',
        status: 'Scheduled',
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        id: appointment.id,
        date,
        time,
        purpose: appointment.purpose,
      },
    })
  } catch (error) {
    console.error('Failed to create appointment:', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}
