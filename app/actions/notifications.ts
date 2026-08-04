'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth-helpers'
import { notifyManagers } from '@/lib/notify'

type NotificationItem = {
  id: string
  type: 'conversation' | 'followup' | 'field_visit' | 'financial_alert' | 'lead_captured' | 'portal_lead'
  title: string
  subtitle: string
  date: string
  href: string
  unread?: number
}

export async function getTopNotifications() {
  const now = new Date()
  const followUpWhere = {
    sent: false,
    date: { lte: now },
  }

  const [
    unreadConversations,
    dueFollowUps,
    unreadConversationAggregate,
    pendingFollowUpsCount,
    unreadNotifications,
    unreadNotificationsCount,
  ] = await Promise.all([
    prisma.conversation.findMany({
      where: { unread: { gt: 0 } },
      orderBy: { date: 'desc' },
      take: 8,
      select: {
        id: true,
        customerName: true,
        channel: true,
        unread: true,
        lastMessage: true,
        date: true,
      },
    }),
    prisma.followUp.findMany({
      where: followUpWhere,
      orderBy: { date: 'asc' },
      take: 8,
      include: {
        lead: {
          include: {
            contact: { select: { name: true } },
          },
        },
      },
    }),
    prisma.conversation.aggregate({
      where: { unread: { gt: 0 } },
      _sum: { unread: true },
    }),
    prisma.followUp.count({ where: followUpWhere }),
    prisma.notification.findMany({
      where: { read: false },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.notification.count({ where: { read: false } }),
  ])

  const conversationItems: NotificationItem[] = unreadConversations.map(c => ({
    id: `conversation-${c.id}`,
    type: 'conversation',
    title: `${c.customerName} sent ${c.unread} unread message${c.unread > 1 ? 's' : ''}`,
    subtitle: c.lastMessage || `New ${c.channel} message`,
    date: c.date.toISOString(),
    href: '/conversations',
    unread: c.unread,
  }))

  const followUpItems: NotificationItem[] = dueFollowUps.map(f => ({
    id: `followup-${f.id}`,
    type: 'followup',
    title: `Follow-up due: ${f.lead.contact.name}`,
    subtitle: f.message,
    date: f.date.toISOString(),
    href: '/leads',
  }))

  const notificationItems: NotificationItem[] = unreadNotifications.map(n => ({
    id: `notification-${n.id}`,
    type: n.type as NotificationItem['type'],
    title: n.title,
    subtitle: n.subtitle,
    date: n.createdAt.toISOString(),
    href: n.href,
  }))

  const items = [...conversationItems, ...followUpItems, ...notificationItems]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 15)

  const unreadConversationsCount = unreadConversationAggregate._sum.unread || 0

  return {
    success: true,
    data: {
      unreadCount: unreadConversationsCount + pendingFollowUpsCount + unreadNotificationsCount,
      unreadConversationsCount,
      pendingFollowUps: pendingFollowUpsCount,
      overdueInvoices: 0, // removed — no Invoice model in Real Estate CRM
      unreadAlerts: unreadNotificationsCount,
      items,
    },
  }
}

export async function markConversationNotificationRead(conversationId: number) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { unread: 0 },
  })

  revalidatePath('/conversations')
  return { success: true }
}

export async function markAllConversationNotificationsRead() {
  await prisma.conversation.updateMany({
    where: { unread: { gt: 0 } },
    data: { unread: 0 },
  })

  revalidatePath('/conversations')
  return { success: true }
}

export async function markNotificationRead(notificationId: number) {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  })

  return { success: true }
}

export async function markAllAlertNotificationsRead() {
  await prisma.notification.updateMany({
    where: { read: false },
    data: { read: true },
  })

  return { success: true }
}

// runStockCheck removed — inventory/product model not part of Real Estate CRM

