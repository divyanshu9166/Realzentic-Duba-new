/** Facilities response and completion SLA defaults for Dubai operations. */

export const WORK_ORDER_SLA_HOURS: Record<string, number> = {
  URGENT: 4,
  HIGH: 24,
  MEDIUM: 72,
  LOW: 168,
}

export function workOrderDueAt(priority: string, createdAt = new Date()): Date {
  const hours = WORK_ORDER_SLA_HOURS[priority] ?? WORK_ORDER_SLA_HOURS.MEDIUM
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000)
}
