import { describe, expect, it } from 'vitest'
import { addBusinessMinutes, DEFAULT_BUSINESS_HOURS } from './lead-sla'

describe('Dubai business-hour SLA clock', () => {
  it('pauses outside business hours and resumes on the next business day', () => {
    const start = new Date('2026-01-05T16:30:00.000Z') // Monday 20:30 Dubai
    expect(addBusinessMinutes(start, 120, DEFAULT_BUSINESS_HOURS).toISOString()).toBe('2026-01-06T06:30:00.000Z') // Tuesday 10:30 Dubai
  })

  it('uses a flat clock when business hours are disabled', () => {
    const start = new Date('2026-01-05T20:30:00.000Z')
    expect(addBusinessMinutes(start, 30, { ...DEFAULT_BUSINESS_HOURS, enabled: false }).toISOString()).toBe('2026-01-05T21:00:00.000Z')
  })
})
