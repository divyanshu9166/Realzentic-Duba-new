import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const walkinFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  requirement: z.string().min(1, 'Please tell us what you are looking for'),
  budget: z.string().optional(),
})

// POST /api/walkin — public, no auth required
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = walkinFormSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { name, phone, requirement, budget } = parsed.data

    // Find or create contact
    let contact = await prisma.contact.findFirst({ where: { phone } })
    if (!contact) {
      contact = await prisma.contact.create({
        data: { name, phone, source: 'QR Walk-in' },
      })
    }

    const now = new Date()
    const walkin = await prisma.walkin.create({
      data: {
        contactId: contact.id,
        requirement,
        budget: budget || null,
        date: now,
        time: now.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true }),
        source: 'QR Walk-in',
      },
    })

    return NextResponse.json({ success: true, data: { id: walkin.id } })
  } catch (err: any) {
    console.error('Walk-in form error:', err)
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// GET /api/walkin — returns store info for the form header
export async function GET() {
  try {
    const settings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
    return NextResponse.json({
      storeName: settings?.storeName || 'Realzentic',
      logo: settings?.logo || null,
    })
  } catch {
    return NextResponse.json({
      storeName: 'Realzentic',
      logo: null,
    })
  }
}
