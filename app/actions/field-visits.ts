'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import {
  generateOtp,
  verifyOtp,
  withinGeofence,
  haversineMeters,
  computeVisitAnalytics,
  DEFAULT_GEOFENCE_RADIUS_M,
  DEFAULT_OTP_LENGTH,
  type VisitRecord,
} from '@/lib/geo'
import {
  sendCheckinOtpSchema,
  verifyCheckinOtpSchema,
  geoCheckinSchema,
  submitVisitFeedbackSchema,
  visitAnalyticsSchema,
} from '@/lib/validations/field-visits'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhoneForMetaUae, isValidE164 } from '@/lib/whatsapp/phone-utils'

// ─── GET FIELD VISITS FOR A STAFF MEMBER ─────────────────
// Returns assigned/active visits for the staff member

export async function getStaffVisits(staffId: number) {
  try {
    const visits = await prisma.fieldVisit.findMany({
      where: {
        staffId,
        status: { in: ['Scheduled', 'In Progress'] },
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    })

    return {
      success: true,
      data: visits.map(v => ({
        id: v.id,
        displayId: v.displayId,
        customer: v.customer,
        address: v.address,
        date: v.date.toISOString(),
        time: v.time,
        scheduledDate: v.scheduledDate?.toISOString() || null,
        scheduledTime: v.scheduledTime || null,
        status: v.status,
        type: v.type,
        notes: v.notes,
        staffNotes: v.staffNotes,
        measurements: v.measurements,
        photos: v.photos,
        photoUrls: v.photoUrls,
        completedAt: v.completedAt?.toISOString() || null,
        // Legacy reference — nullable plain Int (no FK)
        customOrderId: v.customOrderId,
      })),
    }
  } catch (error) {
    console.error('Error fetching staff visits:', error)
    return { success: false, error: 'Failed to fetch visits' }
  }
}

// ─── GET SELF-INITIATED VISITS FOR A STAFF MEMBER ────────

export async function getSelfVisits(staffId: number) {
  try {
    const visits = await prisma.fieldVisit.findMany({
      where: {
        staffId,
        customOrderId: null, // self-initiated (not assigned from a deal/order)
      },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return {
      success: true,
      data: visits.map(v => ({
        id: v.id,
        displayId: v.displayId,
        customer: v.customer,
        address: v.address,
        date: v.date.toISOString(),
        time: v.time,
        status: v.status,
        type: v.type,
        notes: v.notes,
        staffNotes: v.staffNotes,
        measurements: v.measurements,
        photos: v.photos,
        photoUrls: v.photoUrls,
        completedAt: v.completedAt?.toISOString() || null,
      })),
    }
  } catch (error) {
    console.error('Error fetching self visits:', error)
    return { success: false, error: 'Failed to fetch self visits' }
  }
}

// ─── LOG A SELF-INITIATED VISIT ────────────────────────

export async function logSelfVisit(data: {
  staffId: number
  customer: string
  address: string
  date: string
  time: string
  type: string
  notes?: string
  measurements?: object
  photos?: number
  photoUrls?: string[]
}) {
  try {
    const count = await prisma.fieldVisit.count({ where: { staffId: data.staffId } })
    const displayId = `SV-${data.staffId}-${count + 1}`

    const visit = await prisma.fieldVisit.create({
      data: {
        displayId,
        staffId: data.staffId,
        customer: data.customer,
        address: data.address,
        date: new Date(data.date),
        time: data.time,
        status: 'Completed',
        type: data.type,
        notes: data.notes || null,
        measurements: data.measurements || undefined,
        photos: data.photos || 0,
        photoUrls: data.photoUrls || [],
        completedAt: new Date(),
      },
    })

    revalidatePath('/staff-portal')
    revalidatePath('/staff')
    return { success: true, data: visit }
  } catch (error) {
    console.error('Error logging self visit:', error)
    return { success: false, error: 'Failed to log visit' }
  }
}

// ─── UPDATE FIELD VISIT ─────────────────────────────────

export async function updateFieldVisit(data: {
  visitId: number
  status?: string
  staffNotes?: string
  measurements?: object
  completedAt?: string
}) {
  try {
    const updateData: Record<string, unknown> = {}
    if (data.status !== undefined) updateData.status = data.status
    if (data.staffNotes !== undefined) updateData.staffNotes = data.staffNotes
    if (data.measurements !== undefined) updateData.measurements = data.measurements
    if (data.status === 'Completed' && !data.completedAt) updateData.completedAt = new Date()
    if (data.completedAt) updateData.completedAt = new Date(data.completedAt)

    const visit = await prisma.fieldVisit.update({
      where: { id: data.visitId },
      data: updateData,
    })

    revalidatePath('/staff-portal')
    revalidatePath('/staff')
    return { success: true, data: visit }
  } catch (error) {
    console.error('Error updating field visit:', error)
    return { success: false, error: 'Failed to update visit' }
  }
}

// ─── UPDATE FIELD VISIT PHOTOS ───────────────────────────

export async function updateSelfVisitPhotos(visitId: number, photoUrls: string[]) {
  try {
    const visit = await prisma.fieldVisit.update({
      where: { id: visitId },
      data: {
        photos: photoUrls.length,
        photoUrls,
      },
    })

    revalidatePath('/staff-portal')
    return { success: true, data: visit }
  } catch (error) {
    console.error('Error updating visit photos:', error)
    return { success: false, error: 'Failed to update photos' }
  }
}

// ─── GET ALL FIELD VISITS (Manager/Admin) ─────────────────

export async function getFieldVisits(filters: {
  staffId?: number
  status?: string
  startDate?: string
  endDate?: string
} = {}) {
  try {
    const where: Record<string, unknown> = {}
    if (filters.staffId) where.staffId = filters.staffId
    if (filters.status) where.status = filters.status
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {}
      if (filters.startDate) {
        const d = new Date(filters.startDate)
        d.setHours(0, 0, 0, 0)
        dateFilter.gte = d
      }
      if (filters.endDate) {
        const d = new Date(filters.endDate)
        d.setHours(23, 59, 59, 999)
        dateFilter.lte = d
      }
      where.scheduledDate = dateFilter
    }

    const visits = await prisma.fieldVisit.findMany({
      where,
      include: {
        staff: { select: { id: true, name: true, role: true } },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 100,
    })

    return { success: true, data: visits }
  } catch (error) {
    console.error('Error fetching field visits:', error)
    return { success: false, error: 'Failed to fetch field visits' }
  }
}

// ─── CREATE A FIELD VISIT (Manager/Admin) ────────────────

export async function createFieldVisit(data: {
  staffId: number
  customer: string
  address: string
  date: string
  time: string
  type: string
  scheduledDate?: string
  scheduledTime?: string
  notes?: string
  buyerPhone?: string
}) {
  try {
    const count = await prisma.fieldVisit.count()
    const displayId = `FV-${String(count + 1).padStart(4, '0')}`

    const visit = await prisma.fieldVisit.create({
      data: {
        displayId,
        staffId: data.staffId,
        customer: data.customer,
        address: data.address,
        date: new Date(data.date),
        time: data.time,
        status: 'Scheduled',
        type: data.type,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
        scheduledTime: data.scheduledTime || null,
        notes: data.notes || null,
        buyerPhone: data.buyerPhone?.trim() || null,
        photoUrls: [],
      },
    })

    revalidatePath('/staff')
    revalidatePath('/staff-portal')
    return { success: true, data: visit }
  } catch (error) {
    console.error('Error creating field visit:', error)
    return { success: false, error: 'Failed to create field visit' }
  }
}

// ═══════════════════════════════════════════════════════════
// SITE VISIT 2.0 (Module 9, Req 12.1–12.6)
//
// OTP check-in, geo check-in validation, structured feedback,
// follow-up/deal creation, and visit analytics. All geometric,
// OTP, and aggregation math is delegated to the pure helpers in
// `lib/geo.ts`; everything here is the I/O + persistence shell.
// ═══════════════════════════════════════════════════════════

const SITE_VISIT_PATHS = ['/staff', '/staff-portal', '/field-visits']

function revalidateVisitPaths() {
  for (const path of SITE_VISIT_PATHS) revalidatePath(path)
}

// ─── OTP DELIVERY TRANSPORT (Req 12.2) ───────────────────
//
// Sends a one-time code to the buyer over WhatsApp, falling back to SMS.
// Transports are injectable so the dispatch flow can be exercised without a
// live Meta/SMS account; the defaults use the real Meta Cloud API and the
// env-configured SMS gateway respectively.

export type OtpChannel = 'whatsapp' | 'sms'

/**
 * Outcome of an OTP delivery attempt. Discriminated on `ok` so that a
 * successful result is guaranteed to carry a `channel` and a failed one
 * an `error` — callers can narrow without optional-chaining.
 */
export type OtpDeliveryResult =
  | { ok: true; channel: OtpChannel }
  | { ok: false; error: string }

export interface OtpTransports {
  sendWhatsApp?: (phoneE164: string, otp: string) => Promise<void>
  sendSms?: (phoneE164: string, otp: string) => Promise<void>
}

/** Default WhatsApp OTP sender — resolves the first configured account. */
async function defaultSendWhatsAppOtp(phoneE164: string, otp: string): Promise<void> {
  const config = await prisma.waWhatsappConfig.findFirst()
  if (!config) throw new Error('WhatsApp is not configured')

  const accessToken = decrypt(config.access_token)
  await sendTextMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    to: phoneE164,
    text: `Your site-visit verification code is ${otp}. Share it with your agent to confirm your visit.`,
  })
}

/**
 * Default SMS OTP sender. A real SMS gateway is configured via env
 * (`SMS_OTP_WEBHOOK_URL`); without it the SMS leg is unavailable and the
 * caller surfaces a delivery error rather than silently "succeeding".
 */
async function defaultSendSmsOtp(phoneE164: string, otp: string): Promise<void> {
  const endpoint = process.env.SMS_OTP_WEBHOOK_URL
  if (!endpoint) throw new Error('SMS gateway is not configured')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SMS_OTP_API_KEY ? { Authorization: `Bearer ${process.env.SMS_OTP_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      to: phoneE164,
      message: `Your site-visit verification code is ${otp}.`,
    }),
  })
  if (!res.ok) throw new Error(`SMS gateway error: ${res.status}`)
}

/** Try WhatsApp first, then SMS. Returns the channel that succeeded. */
async function deliverOtp(
  phoneE164: string,
  otp: string,
  transports?: OtpTransports,
): Promise<OtpDeliveryResult> {
  const sendWhatsApp = transports?.sendWhatsApp ?? defaultSendWhatsAppOtp
  const sendSms = transports?.sendSms ?? defaultSendSmsOtp

  try {
    await sendWhatsApp(phoneE164, otp)
    return { ok: true, channel: 'whatsapp' }
  } catch (waErr) {
    const waMsg = waErr instanceof Error ? waErr.message : String(waErr)
    try {
      await sendSms(phoneE164, otp)
      return { ok: true, channel: 'sms' }
    } catch (smsErr) {
      const smsMsg = smsErr instanceof Error ? smsErr.message : String(smsErr)
      return { ok: false, error: `WhatsApp failed (${waMsg}); SMS failed (${smsMsg})` }
    }
  }
}

// ─── SEND CHECK-IN OTP (Req 12.2) ────────────────────────

/**
 * Generate a one-time code for a site visit and send it to the buyer over
 * WhatsApp (with SMS fallback). The code is persisted on the visit and the
 * `otpVerified` flag is reset so a fresh code must be entered.
 *
 * @param input  visitId + buyerPhone (+ optional otpLength).
 * @param transports  optional transport overrides for testing.
 */
export async function sendCheckinOtp(
  input: unknown,
  transports?: OtpTransports,
): Promise<
  | { success: true; data: { visitId: number; channel: 'whatsapp' | 'sms' } }
  | { success: false; error: string }
> {
  const parsed = sendCheckinOtpSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { visitId, buyerPhone, otpLength } = parsed.data

  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }

  const phoneE164 = normalizePhoneForMetaUae(buyerPhone)
  if (!isValidE164(phoneE164)) {
    return { success: false, error: `Invalid phone number: ${buyerPhone}` }
  }

  const otp = generateOtp(Math.random, otpLength ?? DEFAULT_OTP_LENGTH)

  // Persist the code (resetting prior verification) before dispatch so a sent
  // code is always recoverable for verification.
  await prisma.fieldVisit.update({
    where: { id: visitId },
    data: { otpCode: otp, otpVerified: false },
  })

  const delivery = await deliverOtp(phoneE164, otp, transports)
  if (!delivery.ok) {
    return { success: false, error: `Could not send OTP. ${delivery.error ?? ''}`.trim() }
  }

  revalidateVisitPaths()
  return { success: true, data: { visitId, channel: delivery.channel } }
}

// ─── VERIFY CHECK-IN OTP (Req 12.3) ──────────────────────

/**
 * Verify a buyer-entered OTP against the stored code. On a match the visit's
 * `otpVerified` flag is set; on a mismatch the check-in is rejected with an
 * error and the flag is left unchanged (Req 12.3).
 */
export async function verifyCheckinOtp(
  input: unknown,
): Promise<
  | { success: true; data: { visitId: number; otpVerified: boolean } }
  | { success: false; error: string }
> {
  const parsed = verifyCheckinOtpSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { visitId, enteredOtp } = parsed.data

  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }

  if (!verifyOtp(visit.otpCode, enteredOtp.trim())) {
    return { success: false, error: 'The entered OTP is incorrect' }
  }

  const updated = await prisma.fieldVisit.update({
    where: { id: visitId },
    data: { otpVerified: true },
  })

  revalidateVisitPaths()
  return { success: true, data: { visitId, otpVerified: updated.otpVerified } }
}

// ─── GEO CHECK-IN (Req 12.4) ─────────────────────────────

/**
 * Validate that the agent is within the project geofence (default 500m) and
 * record the check-in coordinates and time. Project coordinates may be passed
 * explicitly or resolved from the visit's linked project. A check-in farther
 * than the radius is rejected with an error and nothing is persisted (Req 12.4).
 */
export async function geoCheckin(input: unknown) {
  const parsed = geoCheckinSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { visitId, agentLat, agentLng, projectLat, projectLng, radiusM } = parsed.data

  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }

  // Resolve the project location: explicit coords win, else the linked project.
  let projLat = projectLat
  let projLng = projectLng
  if ((projLat === undefined || projLng === undefined) && visit.projectId != null) {
    const project = await prisma.project.findUnique({
      where: { id: visit.projectId },
      select: { latitude: true, longitude: true },
    })
    if (project?.latitude != null && project?.longitude != null) {
      projLat = project.latitude
      projLng = project.longitude
    }
  }

  if (projLat === undefined || projLng === undefined) {
    return { success: false, error: 'Project location is unavailable for this visit' }
  }

  const radius = radiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  const distanceM = haversineMeters(agentLat, agentLng, projLat, projLng)

  if (!withinGeofence(agentLat, agentLng, projLat, projLng, radius)) {
    return {
      success: false,
      error: `You are ${Math.round(distanceM)}m from the project; check-in requires being within ${radius}m`,
      data: { distanceM },
    }
  }

  const updated = await prisma.fieldVisit.update({
    where: { id: visitId },
    data: {
      geoCheckinLat: agentLat,
      geoCheckinLng: agentLng,
      geoCheckinTime: new Date(),
      status: 'In Progress',
    },
  })

  revalidateVisitPaths()
  return { success: true, data: { visitId: updated.id, distanceM } }
}

// ─── STRUCTURED FEEDBACK + FOLLOW-UP/DEAL (Req 12.5) ─────

/**
 * Capture structured visit feedback (rating, liked/disliked/concerns,
 * duration), mark the visit Completed, and create the downstream record the
 * agent selected via `followUpAction`:
 *   - `Deal`     → create a Deal for the buyer (Req 12.5).
 *   - `FollowUp` → schedule a lead FollowUp (Req 12.5).
 *   - `None`     → record feedback only.
 *
 * The feedback write and the downstream creation run in a single transaction
 * so feedback is never persisted without its requested follow-up.
 */
export async function submitVisitFeedback(input: unknown) {
  const parsed = submitVisitFeedbackSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const data = parsed.data

  const visit = await prisma.fieldVisit.findUnique({ where: { id: data.visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }

  // Validate foreign keys up-front so a follow-up action never half-applies.
  if (data.followUpAction === 'Deal') {
    const [stage, contact] = await Promise.all([
      prisma.dealStage.findUnique({ where: { id: data.stageId! } }),
      prisma.contact.findUnique({ where: { id: data.contactId! } }),
    ])
    if (!stage) return { success: false, error: 'Target deal stage does not exist' }
    if (!contact) return { success: false, error: 'Contact not found' }
    if (stage.isLost) return { success: false, error: 'Cannot create a visit deal directly into a lost stage' }
  } else if (data.followUpAction === 'FollowUp') {
    const lead = await prisma.lead.findUnique({ where: { id: data.leadId! } })
    if (!lead) return { success: false, error: 'Lead not found' }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedVisit = await tx.fieldVisit.update({
        where: { id: data.visitId },
        data: {
          buyerRating: data.buyerRating ?? null,
          feedbackLiked: data.feedbackLiked ?? null,
          feedbackDisliked: data.feedbackDisliked ?? null,
          feedbackConcerns: data.feedbackConcerns ?? null,
          visitDurationMin: data.visitDurationMin ?? null,
          followUpAction: data.followUpAction,
          status: 'Completed',
          completedAt: new Date(),
        },
      })

      const deal =
        data.followUpAction === 'Deal'
          ? await (async () => {
            const stage = await tx.dealStage.findUnique({ where: { id: data.stageId! } })
            return tx.deal.create({
              data: {
                contactId: data.contactId!,
                stageId: data.stageId!,
                value: data.dealValue!,
                unitId: data.unitId ?? null,
                assignedAgentId: data.assignedAgentId ?? visit.staffId,
                source: 'Site Visit',
                notes: `Created from site visit ${updatedVisit.displayId}`,
                wonDate: stage?.isWon ? new Date() : null,
              },
            })
          })()
          : null

      const followUp =
        data.followUpAction === 'FollowUp'
          ? await tx.followUp.create({
            data: {
              leadId: data.leadId!,
              day: data.followUpDay ?? 0,
              message: data.followUpMessage!,
              sent: false,
              date: data.followUpDate ? new Date(data.followUpDate) : new Date(),
            },
          })
          : null

      return { visit: updatedVisit, deal, followUp }
    })

    revalidateVisitPaths()
    return { success: true, data: result }
  } catch (error) {
    console.error('Error submitting visit feedback:', error)
    return { success: false, error: 'Failed to submit visit feedback' }
  }
}

// ─── VISIT ANALYTICS (Req 12.6) ──────────────────────────

/**
 * Aggregate completed-visit analytics — visit count, average buyer rating, and
 * average visit duration — optionally scoped by staff, project, and date
 * range. Aggregation is delegated to the pure `computeVisitAnalytics` helper.
 */
export async function getVisitAnalytics(input: unknown = {}) {
  const parsed = visitAnalyticsSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { staffId, projectId, startDate, endDate } = parsed.data

  try {
    const where: Record<string, unknown> = { status: 'Completed' }
    if (staffId) where.staffId = staffId
    if (projectId) where.projectId = projectId
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {}
      if (startDate) dateFilter.gte = new Date(startDate)
      if (endDate) dateFilter.lte = new Date(endDate)
      where.date = dateFilter
    }

    const visits = await prisma.fieldVisit.findMany({
      where,
      select: { buyerRating: true, visitDurationMin: true },
    })

    const records: VisitRecord[] = visits.map((v) => ({
      buyerRating: v.buyerRating,
      visitDurationMin: v.visitDurationMin,
    }))

    return { success: true, data: computeVisitAnalytics(records) }
  } catch (error) {
    console.error('Error computing visit analytics:', error)
    return { success: false, error: 'Failed to compute visit analytics' }
  }
}
