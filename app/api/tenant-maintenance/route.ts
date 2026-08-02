import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { workOrderDueAt } from '@/lib/work-order-sla'

const requestSchema = z.object({
  token: z.string().trim().min(32).max(128),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(3000).optional().or(z.literal('')),
  category: z.enum(['GENERAL', 'PLUMBING', 'ELECTRICAL', 'HVAC', 'CIVIL', 'CLEANING', 'OTHER']).default('GENERAL'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  attachments: z.array(z.string().url().max(2000)).max(10).default([]),
})

function displayId() {
  return `WO-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    const lease = await prisma.lease.findFirst({ where: { maintenanceAccessToken: parsed.data.token, status: 'ACTIVE' }, select: { id: true, contactId: true } })
    if (!lease) return NextResponse.json({ error: 'Maintenance link is invalid or expired' }, { status: 401 })
    const order = await prisma.workOrder.create({ data: { displayId: displayId(), leaseId: lease.id, contactId: lease.contactId, title: parsed.data.title, description: parsed.data.description || null, category: parsed.data.category, priority: parsed.data.priority, status: 'OPEN', dueAt: workOrderDueAt(parsed.data.priority), attachments: parsed.data.attachments } })
    return NextResponse.json({ success: true, data: { id: order.id, displayId: order.displayId, dueAt: order.dueAt } }, { status: 201 })
  } catch (error) {
    console.error('[tenant-maintenance] request failed:', error)
    return NextResponse.json({ error: 'Could not create maintenance request' }, { status: 500 })
  }
}
