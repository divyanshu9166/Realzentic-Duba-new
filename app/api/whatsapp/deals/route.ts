import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function POST(request: Request) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: {
            title?: string
            value?: number
            currency?: string
            contact_id?: string
            pipeline_id?: string
            stage_id?: string
            assigned_to?: string | null
            notes?: string | null
            expected_close_date?: string | null
            status?: string
        }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const title = String(body?.title ?? '').trim()
        const contactId = String(body?.contact_id ?? '').trim()
        const pipelineId = String(body?.pipeline_id ?? '').trim()
        const stageId = String(body?.stage_id ?? '').trim()

        if (!title || !contactId || !pipelineId || !stageId) {
            return NextResponse.json(
                { error: 'Title, contact, pipeline, and stage are required' },
                { status: 400 },
            )
        }

        const userId = String(session.user.id)

        const deal = await prisma.waDeal.create({
            data: {
                user_id: userId,
                title,
                value: typeof body?.value === 'number' ? body.value : Number(body?.value) || 0,
                currency: String(body?.currency ?? 'AED'),
                contact_id: contactId,
                pipeline_id: pipelineId,
                stage_id: stageId,
                assigned_to: body?.assigned_to ? String(body.assigned_to) : null,
                notes: body?.notes ? String(body.notes) : null,
                expected_close_date: body?.expected_close_date
                    ? String(body.expected_close_date)
                    : null,
                status: String(body?.status ?? 'open'),
            },
        })

        return NextResponse.json({ data: deal })
    } catch (error) {
        console.error('Error creating deal:', error)
        return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 })
    }
}
