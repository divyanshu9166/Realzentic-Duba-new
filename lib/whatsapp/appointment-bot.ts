/**
 * lib/whatsapp/appointment-bot.ts
 *
 * WhatsApp Appointment Booking Chatbot — Redis-backed state machine.
 *
 * Flow:
 *   IDLE
 *     → (customer clicks "Schedule Appointment" button)
 *   COLLECTING_DATE
 *     → (customer sends a date like "tomorrow", "10 june", "2026-06-10")
 *   COLLECTING_TIME
 *     → (customer picks a time from offered slots)
 *   CONFIRMING
 *     → (customer says "yes" to confirm)
 *   DONE  (terminal — state is cleared)
 *
 * State is stored in Redis with a 30-minute TTL. If the customer goes
 * silent for 30 minutes the session expires gracefully.
 *
 * Called from: app/api/whatsapp/webhook/route.ts → processMessage()
 */

import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import {
  sendTextMessage,
  sendInteractiveButtonMessage,
} from '@/lib/whatsapp/meta-api'

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_TTL_SECONDS = 30 * 60 // 30 minutes

/** Fixed property-viewing time slots offered to the customer. */
const AVAILABLE_SLOTS = [
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
]

// ── Types ────────────────────────────────────────────────────────────────────

type BotStep =
  | 'COLLECTING_DATE'
  | 'COLLECTING_TIME'
  | 'CONFIRMING'

interface BotState {
  step: BotStep
  /** ISO date string e.g. "2026-06-10" */
  date?: string
  /** Human-readable time e.g. "11:00 AM" */
  time?: string
  /** Contact's display name */
  contactName: string
  /** Contact's phone number (E.164) */
  contactPhone: string
  /** WA contact id */
  contactId: string
  /** WA conversation id — for saving the bot's reply message to DB */
  conversationId: string
  /** userId (CRM owner) — for WA config lookup */
  userId: string
}

interface WaConfig {
  phoneNumberId: string
  accessToken: string
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

function stateKey(conversationId: string): string {
  return `wa:appt-bot:${conversationId}`
}

export async function getBotState(conversationId: string): Promise<BotState | null> {
  try {
    const raw = await redis.get(stateKey(conversationId))
    if (!raw) return null
    return JSON.parse(raw) as BotState
  } catch {
    return null
  }
}

async function setBotState(state: BotState): Promise<void> {
  try {
    await redis.set(stateKey(state.conversationId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS)
  } catch {
    // non-critical
  }
}

export async function clearBotState(conversationId: string): Promise<void> {
  try {
    await redis.del(stateKey(conversationId))
  } catch {
    // non-critical
  }
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Parse natural language English date input into a YYYY-MM-DD string.
 * Returns null if the input is unrecognizable.
 */
function parseDate(input: string): string | null {
  const text = input.trim().toLowerCase()
  const now = new Date()

  // Relative dates
  if (/\b(today|now)\b/i.test(text)) {
    return toDateStr(now)
  }
  if (/\b(tomorrow)\b/i.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return toDateStr(d)
  }
  if (/\b(day after tomorrow)\b/i.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 2)
    return toDateStr(d)
  }

  // ISO format: 2026-06-10
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`)
    if (!isNaN(d.getTime())) return toDateStr(d)
  }

  // "10 june" or "june 10" or "10/06" or "10-06"
  const months: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, october: 9, oct: 9,
    november: 10, nov: 10, december: 11, dec: 11,
  }
  const dayMonthMatch = text.match(/(\d{1,2})\s+(\w+)/)
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1])
    const month = months[dayMonthMatch[2].toLowerCase()]
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = now.getFullYear()
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return toDateStr(d)
    }
  }
  const monthDayMatch = text.match(/(\w+)\s+(\d{1,2})/)
  if (monthDayMatch) {
    const month = months[monthDayMatch[1].toLowerCase()]
    const day = parseInt(monthDayMatch[2])
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = now.getFullYear()
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return toDateStr(d)
    }
  }
  // "10/06" or "10-06"
  const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (slashMatch) {
    const day = parseInt(slashMatch[1])
    const month = parseInt(slashMatch[2]) - 1
    const d = new Date(now.getFullYear(), month, day)
    if (!isNaN(d.getTime())) return toDateStr(d)
  }

  return null
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Format YYYY-MM-DD → "Sunday, 10 June 2026" */
function formatDateHuman(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Time parsing ──────────────────────────────────────────────────────────────

/** Convert "HH:MM AM/PM" → minutes since midnight */
function timeToMinutes(t: string): number {
  const normalized = t.trim().toUpperCase()
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (!match) return -1
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const period = match[3]
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  return hours * 60 + minutes
}

/**
 * Match user input to one of the fixed slot strings.
 * Handles: "11", "11am", "11:00", "2 PM", "two o'clock", etc.
 */
function parseTimeToSlot(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ')

  // Direct slot match (case-insensitive)
  const directMatch = AVAILABLE_SLOTS.find(
    (slot) => slot.toLowerCase() === text || slot.toLowerCase().replace(':00', '') === text,
  )
  if (directMatch) return directMatch

  // Numeric hour extraction: "11", "11am", "2pm", "2 o'clock"
  const hourMatch = text.match(/(\d{1,2})\s*(?:am|pm|o'?clock)?/)
  if (hourMatch) {
    const hour = parseInt(hourMatch[1])
    const isPM = text.includes('pm') || (hour !== 12 && hour < 8)  // 2→2PM, 11→11AM heuristic
    const adjusted = isPM && hour !== 12 ? hour + 12 : hour
    // Find closest slot
    const targetMins = adjusted * 60
    const closest = AVAILABLE_SLOTS.find((slot) => {
      const slotMins = timeToMinutes(slot)
      return Math.abs(slotMins - targetMins) < 30
    })
    if (closest) return closest
  }

  return null
}

// ── Slot availability check ───────────────────────────────────────────────────

async function isSlotAvailable(
  dateStr: string,
  timeStr: string,
): Promise<{ available: boolean; suggestions: string[] }> {
  try {
    const dayStart = new Date(dateStr)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dateStr)
    dayEnd.setHours(23, 59, 59, 999)

    const existing = await prisma.appointment.findMany({
      where: {
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'Cancelled' },
      },
      select: { time: true },
    })

    const requestedMins = timeToMinutes(timeStr)
    const conflict = existing.find(
      (a) => Math.abs(timeToMinutes(a.time) - requestedMins) < 60,
    )

    if (!conflict) return { available: true, suggestions: [] }

    const bookedMins = existing.map((a) => timeToMinutes(a.time))
    const suggestions = AVAILABLE_SLOTS.filter((slot) => {
      const slotMins = timeToMinutes(slot)
      return !bookedMins.some((bm) => Math.abs(bm - slotMins) < 60)
    }).slice(0, 4)

    return { available: false, suggestions }
  } catch {
    // If DB check fails, optimistically allow the booking
    return { available: true, suggestions: [] }
  }
}

// ── Messaging helpers ─────────────────────────────────────────────────────────

async function sendBotReply(
  text: string,
  state: BotState,
  waConfig: WaConfig,
): Promise<void> {
  try {
    const result = await sendTextMessage({
      phoneNumberId: waConfig.phoneNumberId,
      accessToken: waConfig.accessToken,
      to: state.contactPhone,
      text,
    })

    // Persist reply to DB
    await prisma.waMessage.create({
      data: {
        conversation_id: state.conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: state.conversationId },
      data: { last_message_text: text, last_message_at: new Date() },
    })
  } catch (err) {
    console.error('[appt-bot] sendBotReply failed:', err)
  }
}

async function sendSlotsAsButtons(
  state: BotState,
  waConfig: WaConfig,
  slots: string[],
  introText: string,
): Promise<void> {
  const displaySlots = slots.slice(0, 3)  // WhatsApp max 3 buttons

  if (displaySlots.length === 0) {
    await sendBotReply(
      'No viewing slots are available on that date. Please share another date (for example, tomorrow or 15 June).',
      state,
      waConfig,
    )
    await setBotState({ ...state, step: 'COLLECTING_DATE' })
    return
  }

  try {
    const result = await sendInteractiveButtonMessage({
      phoneNumberId: waConfig.phoneNumberId,
      accessToken: waConfig.accessToken,
      to: state.contactPhone,
      headerText: '📅 Realzentic Dubai — Property Viewing',
      bodyText: introText,
      footerText: 'Viewing times are subject to property availability',
      buttons: displaySlots.map((slot) => ({ id: `SLOT_${slot}`, title: slot })),
    })

    await prisma.waMessage.create({
      data: {
        conversation_id: state.conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: introText,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: state.conversationId },
      data: { last_message_text: introText, last_message_at: new Date() },
    })
  } catch {
    // Fallback to plain text if interactive fails (e.g. outside 24h window)
    const slotList = displaySlots.join(' | ')
    await sendBotReply(`${introText}\n\nAvailable slots: ${slotList}`, state, waConfig)
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export interface AppointmentBotContext {
  conversationId: string
  contactId: string
  contactPhone: string
  contactName: string
  userId: string
  incomingText: string
  /** Set when the customer clicked a quick-reply button */
  buttonReplyId?: string
}

/**
 * Start a fresh appointment booking session.
 * Called when customer clicks the "Schedule Appointment" button.
 */
export async function startAppointmentBot(
  ctx: Omit<AppointmentBotContext, 'incomingText' | 'buttonReplyId'>,
  waConfig: WaConfig,
): Promise<void> {
  const state: BotState = {
    step: 'COLLECTING_DATE',
    contactName: ctx.contactName,
    contactPhone: ctx.contactPhone,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
  }
  await setBotState(state)

  const greeting = `Hello ${ctx.contactName.split(' ')[0]}! 👋\n\nWhich *date* would suit you for a Dubai property viewing?\n\nPlease share a date (for example, tomorrow, 15 June, or 2026-06-15).`
  await sendBotReply(greeting, state, waConfig)
}

/**
 * Handle an incoming message when an appointment bot session is active.
 * Returns true if the message was handled by the bot (skip AI agent).
 */
export async function handleAppointmentBotMessage(
  ctx: AppointmentBotContext,
  waConfig: WaConfig,
): Promise<boolean> {
  const state = await getBotState(ctx.conversationId)
  if (!state) return false

  const text = ctx.incomingText.trim()
  const buttonId = ctx.buttonReplyId

  // ── Handle cancellation at any step ─────────────────────────────────────
  if (/\b(cancel|no|stop)\b/i.test(text)) {
    await clearBotState(ctx.conversationId)
    await sendBotReply(
      'No problem — the viewing request has been cancelled. Please message us whenever you would like to arrange one.',
      state,
      waConfig,
    )
    return true
  }

  // ── Step: COLLECTING_DATE ────────────────────────────────────────────────
  if (state.step === 'COLLECTING_DATE') {
    const parsedDate = parseDate(text)
    if (!parsedDate) {
      await sendBotReply(
        'Please share a valid date, for example:\n• *tomorrow*\n• *15 June*\n• *2026-06-15*',
        state,
        waConfig,
      )
      return true
    }

    // Reject past dates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const chosen = new Date(parsedDate)
    if (chosen < today) {
      await sendBotReply(
        'That date has already passed. Please choose today or a future date:',
        state,
        waConfig,
      )
      return true
    }

    const updatedState: BotState = { ...state, step: 'COLLECTING_TIME', date: parsedDate }
    await setBotState(updatedState)

    const humanDate = formatDateHuman(parsedDate)
    await sendSlotsAsButtons(
      updatedState,
      waConfig,
      AVAILABLE_SLOTS,
      `*${humanDate}* — Please choose one of the available viewing times below:`,
    )
    return true
  }

  // ── Step: COLLECTING_TIME ────────────────────────────────────────────────
  if (state.step === 'COLLECTING_TIME') {
    let chosenSlot: string | null = null

    // Button click — id format: "SLOT_11:00 AM"
    if (buttonId?.startsWith('SLOT_')) {
      chosenSlot = buttonId.replace('SLOT_', '')
    } else {
      chosenSlot = parseTimeToSlot(text)
    }

    if (!chosenSlot) {
      await sendSlotsAsButtons(
        state,
        waConfig,
        AVAILABLE_SLOTS,
        'Please choose a time below or type one (for example, "11 AM" or "2 PM"):',
      )
      return true
    }

    if (!state.date) {
      // Edge case: date was lost — restart
      await setBotState({ ...state, step: 'COLLECTING_DATE' })
      await sendBotReply('One moment — please share your preferred date again:', state, waConfig)
      return true
    }

    // Check slot availability
    const { available, suggestions } = await isSlotAvailable(state.date, chosenSlot)

    if (!available) {
      const humanDate = formatDateHuman(state.date)
      const suggestionText = suggestions.length > 0
        ? `These viewing times are available on ${humanDate}:`
        : `No viewing times are available on that date. Please choose another day:`

      if (suggestions.length > 0) {
        await sendSlotsAsButtons(state, waConfig, suggestions, suggestionText)
      } else {
        await setBotState({ ...state, step: 'COLLECTING_DATE' })
        await sendBotReply(
          `❌ The *${chosenSlot}* time is no longer available on ${humanDate}.\n\n${suggestionText}`,
          state,
          waConfig,
        )
      }
      return true
    }

    // Slot is free — ask for confirmation
    const updatedState: BotState = { ...state, step: 'CONFIRMING', time: chosenSlot }
    await setBotState(updatedState)

    const humanDate = formatDateHuman(state.date)
    const confirmMsg =
      `✅ This viewing time is available.\n\n` +
      `📅 *Date:* ${humanDate}\n` +
      `⏰ *Time:* ${chosenSlot}\n` +
      `👤 *Name:* ${state.contactName}\n\n` +
      `Would you like to confirm? Reply *yes* or *cancel*.`

    await sendBotReply(confirmMsg, updatedState, waConfig)
    return true
  }

  // ── Step: CONFIRMING ─────────────────────────────────────────────────────
  if (state.step === 'CONFIRMING') {
    const isConfirmed = /\b(yes|yep|ok|okay|confirm|sure)\b/i.test(text)

    if (!isConfirmed) {
      await sendBotReply(
        'Please reply *yes* to confirm the viewing, or *cancel* to stop.',
        state,
        waConfig,
      )
      return true
    }

    if (!state.date || !state.time) {
      await clearBotState(ctx.conversationId)
      await sendBotReply(
        'We could not complete the viewing request. Please try again shortly.',
        state,
        waConfig,
      )
      return true
    }

    // Ensure CRM global Contact exists
    let crmContact = await prisma.contact.findUnique({
      where: { phone: state.contactPhone },
    })
    if (!crmContact) {
      crmContact = await prisma.contact.create({
        data: {
          phone: state.contactPhone,
          name: state.contactName || state.contactPhone,
          source: 'WhatsApp Bot',
        },
      })
    }

    // Create the appointment in DB
    try {
      await prisma.appointment.create({
        data: {
          contactId: crmContact.id,
          date: new Date(state.date),
          time: state.time,
          purpose: 'Property Viewing',
          notes: `Booked via WhatsApp chatbot by ${state.contactName} (${state.contactPhone})`,
          status: 'Scheduled',
        },
      })
    } catch (err) {
      console.error('[appt-bot] appointment creation failed:', err)
      await clearBotState(ctx.conversationId)
      await sendBotReply(
        '❌ We could not save the viewing request. Please contact our Realzentic Dubai team for assistance.',
        state,
        waConfig,
      )
      return true
    }

    await clearBotState(ctx.conversationId)

    const humanDate = formatDateHuman(state.date)
    const confirmationMsg =
      `🎉 *Property Viewing Confirmed!*\n\n` +
      `📅 *Date:* ${humanDate}\n` +
      `⏰ *Time:* ${state.time}\n` +
      `📍 *Location:* A Realzentic consultant will confirm the property location\n` +
      `👤 *Name:* ${state.contactName}\n\n` +
      `Our consultant will contact you to confirm the property, location, and any access requirements.`

    await sendBotReply(confirmationMsg, state, waConfig)

    console.log(
      `[appt-bot] Appointment booked | contact=${state.contactId} | date=${state.date} | time=${state.time}`,
    )
    return true
  }

  return false
}
