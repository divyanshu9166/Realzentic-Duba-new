/** Dubai-business-hours helpers for lead response SLAs. */

export interface BusinessHoursConfig {
  enabled: boolean
  startMinute: number
  endMinute: number
  businessDays: number[] // JavaScript day numbers: Sunday 0 … Saturday 6
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  enabled: true,
  startMinute: 9 * 60,
  endMinute: 21 * 60,
  businessDays: [1, 2, 3, 4, 5, 6],
}

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000

function validConfig(config: BusinessHoursConfig): BusinessHoursConfig {
  const start = Number.isInteger(config.startMinute) ? config.startMinute : DEFAULT_BUSINESS_HOURS.startMinute
  const end = Number.isInteger(config.endMinute) ? config.endMinute : DEFAULT_BUSINESS_HOURS.endMinute
  const days = config.businessDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  if (end <= start || days.length === 0) return { ...DEFAULT_BUSINESS_HOURS }
  return { enabled: config.enabled, startMinute: start, endMinute: end, businessDays: [...new Set(days)] }
}

function dubaiDate(date: Date): Date {
  return new Date(date.getTime() + DUBAI_OFFSET_MS)
}

function fromDubaiParts(date: Date, minute: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
  result.setUTCMinutes(minute)
  return new Date(result.getTime() - DUBAI_OFFSET_MS)
}

function nextDubaiDayStart(date: Date, config: BusinessHoursConfig): Date {
  const shifted = dubaiDate(date)
  shifted.setUTCDate(shifted.getUTCDate() + 1)
  shifted.setUTCHours(0, 0, 0, 0)
  return fromDubaiParts(shifted, config.startMinute)
}

/** Add response-SLA minutes while counting only configured Dubai business hours. */
export function addBusinessMinutes(start: Date, minutes: number, input = DEFAULT_BUSINESS_HOURS): Date {
  const config = validConfig(input)
  if (!config.enabled || minutes <= 0) return new Date(start.getTime() + Math.max(0, minutes) * 60_000)

  let cursor = new Date(start)
  let remaining = Math.ceil(minutes)

  for (let guard = 0; guard < 800 && remaining > 0; guard += 1) {
    const local = dubaiDate(cursor)
    const day = local.getUTCDay()
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60

    if (!config.businessDays.includes(day)) {
      cursor = nextDubaiDayStart(cursor, config)
      continue
    }
    if (minute < config.startMinute) {
      cursor = fromDubaiParts(local, config.startMinute)
      continue
    }
    if (minute >= config.endMinute) {
      cursor = nextDubaiDayStart(cursor, config)
      continue
    }

    const available = config.endMinute - minute
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60_000)
    remaining -= Math.floor(available)
    cursor = nextDubaiDayStart(cursor, config)
  }

  // A finite fallback protects the cron from malformed configuration.
  return new Date(start.getTime() + Math.max(0, minutes) * 60_000)
}

export function businessHoursFromRule(rule: Partial<BusinessHoursConfig>): BusinessHoursConfig {
  return validConfig({
    enabled: rule.enabled ?? DEFAULT_BUSINESS_HOURS.enabled,
    startMinute: rule.startMinute ?? DEFAULT_BUSINESS_HOURS.startMinute,
    endMinute: rule.endMinute ?? DEFAULT_BUSINESS_HOURS.endMinute,
    businessDays: rule.businessDays ?? DEFAULT_BUSINESS_HOURS.businessDays,
  })
}
