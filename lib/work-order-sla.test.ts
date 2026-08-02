import { describe, expect, it } from 'vitest'
import { workOrderDueAt } from './work-order-sla'

describe('maintenance priority SLA', () => {
  it('uses four hours for urgent work', () => {
    const created = new Date('2026-01-01T08:00:00.000Z')
    expect(workOrderDueAt('URGENT', created).toISOString()).toBe('2026-01-01T12:00:00.000Z')
  })

  it('falls back to the medium SLA for unknown priorities', () => {
    const created = new Date('2026-01-01T08:00:00.000Z')
    expect(workOrderDueAt('UNKNOWN', created).toISOString()).toBe('2026-01-04T08:00:00.000Z')
  })
})
