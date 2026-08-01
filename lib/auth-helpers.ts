import { getSession as getCustomSession } from './session'
import { prisma } from './db'
import type { UserRole } from '@prisma/client'

export async function getSession() {
  const session = await getCustomSession()
  if (!session) return null

  // The signed cookie is an identity credential, not the source of truth for
  // mutable authorization data. Roles, activation and staff links can change
  // during the cookie's seven-day lifetime, so resolve them from the database
  // before every server-side permission check.
  const userId = Number(session.id)
  if (!Number.isInteger(userId) || userId <= 0) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      staffId: true,
      isActive: true,
    },
  })
  if (!user?.isActive) return null

  return {
    user: {
      id: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      staffId: user.staffId,
    }
  }
}

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  return session
}

export async function requireRole(...roles: UserRole[]) {
  const session = await requireAuth()
  if (!roles.includes(session.user.role)) {
    throw new Error('Forbidden')
  }
  return session
}
