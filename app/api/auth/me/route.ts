import { NextResponse } from 'next/server'
import { createSession, deleteSession, getSession } from '@/lib/session'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await getSession()
    
    if (!session) {
      return NextResponse.json(null)
    }

    const userId = Number(session.id)
    const user = Number.isFinite(userId)
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            staffId: true,
            isActive: true,
            createdAt: true,
          },
        })
      : null

    if (!user?.isActive) {
      await deleteSession()
      return NextResponse.json(null, { status: 401 })
    }

    // Sync profile to WhatsApp CRM profiles table (non-critical, never crash auth)
    if (user) {
      try {
        await prisma.waProfile.upsert({
          where: { user_id: String(user.id) },
          update: {
            full_name: user.name,
            email: user.email,
            role: user.role,
          },
          create: {
            user_id: String(user.id),
            full_name: user.name,
            email: user.email,
            role: user.role,
          },
        })
      } catch {
        // waProfile sync is optional — don't let it break authentication
      }

      // Refresh stale role/profile claims in the signed cookie. Server actions
      // already resolve the current database role, and this keeps middleware
      // route checks consistent on the user's next navigation as well.
      if (
        session.email !== user.email ||
        session.name !== user.name ||
        session.role !== user.role ||
        session.staffId !== user.staffId
      ) {
        await createSession({
          id: String(user.id),
          email: user.email,
          name: user.name,
          role: user.role,
          staffId: user.staffId,
        })
      }
    }

    return NextResponse.json({
      user: {
        id: user ? String(user.id) : session.id,
        email: user?.email ?? session.email,
        name: user?.name ?? session.name,
        role: user?.role ?? session.role,
        staffId: user?.staffId ?? session.staffId,
        created_at: user?.createdAt?.toISOString() ?? null,
      }
    })
  } catch (error) {
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json(null, { status: 500 })
  }
}
