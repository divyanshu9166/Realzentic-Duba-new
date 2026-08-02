'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import {
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
  createFieldVisitSchema,
  rescheduleFieldVisitSchema,
  updateFieldVisitSchema,
  updateVisitPhotosSchema,
  type CreateFieldVisitInput,
} from '@/lib/validations/field-visits'
import {
  generateSecureOtp,
  issueOtpState,
  otpResendDelaySeconds,
  verifyOtpState,
} from '@/lib/site-visit-otp'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhoneForMetaUae, isValidE164, phonesMatch } from '@/lib/whatsapp/phone-utils'

const ACTIVE_VISIT_STATUSES = ['Scheduled', 'In Progress'] as const
const SITE_VISIT_OTP_SECRET = process.env.SITE_VISIT_OTP_SECRET || process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SITE_VISIT_OTP_SECRET or SESSION_SECRET must be configured in production')
  }
  return 'local-site-visit-otp-secret'
})()

function isManagerRole(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER'
}

async function requireStaffScope(staffId: number) {
  const session = await requireAuth()
  if (!isManagerRole(session.user.role) && session.user.staffId !== staffId) throw new Error('Forbidden')
  return session
}

function assertVisitAccess(
  session: Awaited<ReturnType<typeof requireAuth>>,
  visit: { staffId: number },
) {
  if (!isManagerRole(session.user.role) && session.user.staffId !== visit.staffId) throw new Error('Forbidden')
}

/** Field execution is never an administrative impersonation capability. */
function assertVisitExecutionAccess(
  session: Awaited<ReturnType<typeof requireAuth>>,
  visit: { staffId: number },
) {
  if (session.user.staffId !== visit.staffId) throw new Error('Forbidden')
}

function actionError(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.message === 'Forbidden' || error.message === 'Unauthorized')) return error.message
  return fallback
}

function serializeVisit(visit: any) {
  return {
    id: visit.id,
    displayId: visit.displayId,
    staffId: visit.staffId,
    staff: visit.staff ? { id: visit.staff.id, name: visit.staff.name, role: visit.staff.role } : undefined,
    customOrderId: visit.customOrderId,
    customer: visit.customer,
    address: visit.address,
    date: visit.date.toISOString(),
    time: visit.time,
    scheduledDate: visit.scheduledDate?.toISOString() ?? null,
    scheduledTime: visit.scheduledTime,
    status: visit.status,
    completedAt: visit.completedAt?.toISOString() ?? null,
    type: visit.type,
    notes: visit.notes,
    staffNotes: visit.staffNotes,
    measurements: visit.measurements,
    photos: visit.photos,
    photoUrls: visit.photoUrls,
    projectId: visit.projectId,
    unitIds: visit.unitIds,
    buyerPhone: visit.buyerPhone,
    geoCheckinLat: visit.geoCheckinLat,
    geoCheckinLng: visit.geoCheckinLng,
    geoCheckinTime: visit.geoCheckinTime?.toISOString() ?? null,
    otpVerified: visit.otpVerified,
    buyerRating: visit.buyerRating,
    feedbackLiked: visit.feedbackLiked,
    feedbackDisliked: visit.feedbackDisliked,
    feedbackConcerns: visit.feedbackConcerns,
    followUpAction: visit.followUpAction,
    visitDurationMin: visit.visitDurationMin,
  }
}

async function validateScheduledVisit(
  data: CreateFieldVisitInput,
  excludeVisitId?: number,
): Promise<
  | { ok: true; buyerPhone: string; scheduledAt: Date }
  | { ok: false; error: string }
> {
  const buyerPhone = normalizePhoneForMetaUae(data.buyerPhone)
  if (!isValidE164(buyerPhone)) return { ok: false, error: 'Enter a valid buyer phone number' }

  const scheduledAt = new Date(data.scheduledAt)
  if (scheduledAt.getTime() < Date.now() - 15 * 60_000) {
    return { ok: false, error: 'Scheduled time cannot be in the past' }
  }

  const conflictStart = new Date(scheduledAt.getTime() - 60 * 60_000)
  const conflictEnd = new Date(scheduledAt.getTime() + 60 * 60_000)
  const [staff, project, units, conflict] = await Promise.all([
    prisma.staff.findUnique({ where: { id: data.staffId }, select: { status: true } }),
    prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true, latitude: true, longitude: true },
    }),
    data.unitIds.length > 0
      ? prisma.unit.findMany({
        where: { id: { in: data.unitIds } },
        select: { id: true, status: true, tower: { select: { projectId: true } } },
      })
      : Promise.resolve([]),
    prisma.fieldVisit.findFirst({
      where: {
        id: excludeVisitId ? { not: excludeVisitId } : undefined,
        staffId: data.staffId,
        status: { in: ['Scheduled', 'In Progress'] },
        scheduledDate: { gte: conflictStart, lte: conflictEnd },
      },
      select: { displayId: true },
    }),
  ])

  if (!staff || staff.status !== 'Active') return { ok: false, error: 'Assign an active staff member' }
  if (!project) return { ok: false, error: 'Project not found' }
  if (project.latitude == null || project.longitude == null) {
    return { ok: false, error: 'Add latitude and longitude to the project before scheduling a geo-verified visit' }
  }
  if (
    units.length !== data.unitIds.length ||
    units.some((unit) => unit.tower.projectId !== data.projectId || unit.status === 'Sold' || unit.status === 'Mortgaged')
  ) {
    return { ok: false, error: 'One or more selected units are unavailable or do not belong to this project' }
  }
  if (conflict) {
    return { ok: false, error: `The assigned agent already has ${conflict.displayId} within 60 minutes of this time` }
  }

  return { ok: true, buyerPhone, scheduledAt }
}

// ─── GET FIELD VISITS FOR A STAFF MEMBER ─────────────────
// Returns assigned/active visits for the staff member

export async function getStaffVisits(staffId: number) {
  try {
    await requireStaffScope(staffId)
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

    return { success: true, data: visits.map(serializeVisit) }
  } catch (error) {
    console.error('Error fetching staff visits:', error)
    return { success: false, error: actionError(error, 'Failed to fetch visits') }
  }
}

// ─── GET SELF-INITIATED VISITS FOR A STAFF MEMBER ────────

export async function getSelfVisits(staffId: number) {
  try {
    await requireStaffScope(staffId)
    const visits = await prisma.fieldVisit.findMany({
      where: {
        staffId,
        customOrderId: null,
        projectId: null, // self-initiated, not manager-scheduled against project inventory
      },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return { success: true, data: visits.map(serializeVisit) }
  } catch (error) {
    console.error('Error fetching self visits:', error)
    return { success: false, error: actionError(error, 'Failed to fetch self visits') }
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
    await requireStaffScope(data.staffId)
    if (!data.customer?.trim() || !data.address?.trim()) {
      return { success: false, error: 'Customer and address are required' }
    }
    const displayId = `SV-${data.staffId}-${randomUUID().slice(0, 8).toUpperCase()}`

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
    return { success: true, data: { id: visit.id, displayId: visit.displayId } }
  } catch (error) {
    console.error('Error logging self visit:', error)
    return { success: false, error: actionError(error, 'Failed to log visit') }
  }
}

// ─── UPDATE FIELD VISIT ─────────────────────────────────

export async function updateFieldVisit(input: unknown) {
  try {
    const parsed = updateFieldVisitSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const data = parsed.data
    const session = await requireAuth()
    const existing = await prisma.fieldVisit.findUnique({ where: { id: data.visitId } })
    if (!existing) return { success: false, error: 'Visit not found' }
    assertVisitAccess(session, existing)

    if (data.status !== undefined && data.status !== existing.status) {
      const allowedTransitions: Record<string, string[]> = {
        Scheduled: ['In Progress', 'Cancelled', 'No Show'],
        'In Progress': ['Completed', 'Cancelled'],
        Completed: [],
        Cancelled: [],
        'No Show': [],
      }
      if (!(allowedTransitions[existing.status] ?? []).includes(data.status)) {
        return { success: false, error: `Cannot change a ${existing.status} visit to ${data.status}` }
      }
      if (data.status === 'Completed') {
        return { success: false, error: 'Use the verified feedback workflow to complete this visit' }
      }
      if (data.status === 'In Progress' && (!existing.otpVerified || existing.geoCheckinTime == null)) {
        return { success: false, error: 'OTP verification and geo check-in are required before starting the visit' }
      }
    }

    const updateData: Record<string, unknown> = {}
    if (data.status !== undefined) updateData.status = data.status
    if (data.staffNotes !== undefined) updateData.staffNotes = data.staffNotes
    if (data.measurements !== undefined) updateData.measurements = data.measurements

    const visit = await prisma.fieldVisit.update({
      where: { id: data.visitId },
      data: updateData,
    })

    revalidatePath('/staff-portal')
    revalidatePath('/staff')
    return { success: true, data: { id: visit.id, status: visit.status } }
  } catch (error) {
    console.error('Error updating field visit:', error)
    return { success: false, error: actionError(error, 'Failed to update visit') }
  }
}

// ─── UPDATE FIELD VISIT PHOTOS ───────────────────────────

export async function updateSelfVisitPhotos(visitId: number, photoUrls: string[]) {
  try {
    const parsed = updateVisitPhotosSchema.safeParse({ visitId, photoUrls })
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const session = await requireAuth()
    const existing = await prisma.fieldVisit.findUnique({ where: { id: parsed.data.visitId } })
    if (!existing) return { success: false, error: 'Visit not found' }
    assertVisitAccess(session, existing)

    const visit = await prisma.fieldVisit.update({
      where: { id: parsed.data.visitId },
      data: {
        photos: parsed.data.photoUrls.length,
        photoUrls: parsed.data.photoUrls,
      },
    })

    revalidatePath('/staff-portal')
    return { success: true, data: { id: visit.id, photos: visit.photos, photoUrls: visit.photoUrls } }
  } catch (error) {
    console.error('Error updating visit photos:', error)
    return { success: false, error: actionError(error, 'Failed to update photos') }
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
    const session = await requireAuth()
    const where: Record<string, unknown> = {}
    if (isManagerRole(session.user.role)) {
      if (filters.staffId) where.staffId = filters.staffId
    } else {
      if (session.user.staffId == null) return { success: false, error: 'Staff profile is not linked', data: [] }
      where.staffId = session.user.staffId
    }
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

    return { success: true, data: visits.map(serializeVisit) }
  } catch (error) {
    console.error('Error fetching field visits:', error)
    return { success: false, error: actionError(error, 'Failed to fetch field visits'), data: [] }
  }
}

// ─── CREATE A FIELD VISIT (Manager/Admin) ────────────────

export async function createFieldVisit(input: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = createFieldVisitSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const data = parsed.data
    const validation = await validateScheduledVisit(data)
    if (!validation.ok) return { success: false, error: validation.error }
    const { buyerPhone, scheduledAt } = validation

    const displayId = `FV-${scheduledAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`
    const dubaiTime = new Intl.DateTimeFormat('en-AE', {
      timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(scheduledAt)

    const visit = await prisma.fieldVisit.create({
      data: {
        displayId,
        staffId: data.staffId,
        customer: data.customer,
        address: data.address,
        date: scheduledAt,
        time: dubaiTime,
        status: 'Scheduled',
        type: data.type,
        scheduledDate: scheduledAt,
        scheduledTime: dubaiTime,
        notes: data.notes || null,
        buyerPhone,
        projectId: data.projectId,
        unitIds: data.unitIds,
        photoUrls: [],
      },
    })

    revalidateVisitPaths()
    revalidatePath('/calendar')
    return { success: true, data: { id: visit.id, displayId: visit.displayId } }
  } catch (error) {
    console.error('Error creating field visit:', error)
    return { success: false, error: actionError(error, 'Failed to create field visit') }
  }
}

// ─── RESCHEDULE / REASSIGN A VISIT (Manager/Admin) ─────

export async function rescheduleFieldVisit(input: unknown) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const parsed = rescheduleFieldVisitSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const { visitId, ...data } = parsed.data

    const existing = await prisma.fieldVisit.findUnique({ where: { id: visitId }, select: { status: true } })
    if (!existing) return { success: false, error: 'Visit not found' }
    if (existing.status !== 'Scheduled') {
      return { success: false, error: 'Only a scheduled visit can be rescheduled or reassigned' }
    }

    const validation = await validateScheduledVisit(data, visitId)
    if (!validation.ok) return { success: false, error: validation.error }
    const { buyerPhone, scheduledAt } = validation
    const dubaiTime = new Intl.DateTimeFormat('en-AE', {
      timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(scheduledAt)

    const visit = await prisma.fieldVisit.update({
      where: { id: visitId },
      data: {
        staffId: data.staffId,
        customer: data.customer,
        address: data.address,
        date: scheduledAt,
        time: dubaiTime,
        scheduledDate: scheduledAt,
        scheduledTime: dubaiTime,
        type: data.type,
        notes: data.notes || null,
        buyerPhone,
        projectId: data.projectId,
        unitIds: data.unitIds,
        otpCode: null,
        otpVerified: false,
        geoCheckinLat: null,
        geoCheckinLng: null,
        geoCheckinTime: null,
      },
    })

    revalidateVisitPaths()
    revalidatePath('/calendar')
    return { success: true, data: { id: visit.id, displayId: visit.displayId } }
  } catch (error) {
    console.error('Error rescheduling field visit:', error)
    return { success: false, error: actionError(error, 'Failed to reschedule field visit') }
  }
}

export async function getSiteVisitProjects() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const projects = await prisma.project.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        location: true,
        emirate: true,
        latitude: true,
        longitude: true,
        towers: {
          select: {
            name: true,
            units: {
              where: { status: { in: ['Available', 'Blocked', 'Booked'] } },
              orderBy: [{ floorNumber: 'asc' }, { unitNumber: 'asc' }],
              select: { id: true, unitNumber: true, floorNumber: true, type: true, status: true, totalPrice: true },
            },
          },
        },
      },
    })
    return {
      success: true,
      data: projects.map((project) => ({
        id: project.id,
        name: project.name,
        location: project.location,
        emirate: project.emirate,
        hasCoordinates: project.latitude != null && project.longitude != null,
        units: project.towers.flatMap((tower) => tower.units.map((unit) => ({
          id: unit.id,
          label: `${tower.name} · ${unit.unitNumber} · Floor ${unit.floorNumber}`,
          type: unit.type,
          status: unit.status,
          totalPrice: Number(unit.totalPrice),
        }))),
      })),
    }
  } catch (error) {
    return { success: false, error: actionError(error, 'Failed to load project inventory'), data: [] }
  }
}

export async function getSiteVisitReferenceData() {
  try {
    const session = await requireAuth()
    const manager = isManagerRole(session.user.role)
    if (!manager && session.user.staffId == null) {
      return { success: false, error: 'Staff profile is not linked' }
    }

    const staffWhere = manager ? { status: 'Active' } : { id: session.user.staffId!, status: 'Active' }
    const leadWhere = manager ? {} : { assignedToId: session.user.staffId! }
    const [staff, leads, stages, projectsResult] = await Promise.all([
      prisma.staff.findMany({
        where: staffWhere,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true },
      }),
      prisma.lead.findMany({
        where: leadWhere,
        orderBy: { date: 'desc' },
        take: 500,
        select: { id: true, contact: { select: { id: true, name: true, phone: true } } },
      }),
      prisma.dealStage.findMany({
        orderBy: { order: 'asc' },
        select: { id: true, name: true, isWon: true, isLost: true },
      }),
      manager ? getSiteVisitProjects() : Promise.resolve({ success: true as const, data: [] }),
    ])

    const contacts = manager
      ? await prisma.contact.findMany({
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true, phone: true },
      })
      : [...new Map(leads.map((lead) => [lead.contact.id, lead.contact])).values()]

    return {
      success: true,
      data: {
        canManage: manager,
        staff,
        leads: leads.map((lead) => ({
          id: lead.id,
          name: lead.contact.name,
          phone: lead.contact.phone,
        })),
        stages,
        contacts,
        projects: projectsResult.success ? projectsResult.data : [],
      },
    }
  } catch (error) {
    return { success: false, error: actionError(error, 'Failed to load site visit reference data') }
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

  let session
  try {
    session = await requireAuth()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }
  try {
    assertVisitExecutionAccess(session, visit)
  } catch {
    return { success: false, error: 'Forbidden' }
  }
  if (!ACTIVE_VISIT_STATUSES.includes(visit.status as (typeof ACTIVE_VISIT_STATUSES)[number])) {
    return { success: false, error: `OTP cannot be sent for a ${visit.status} visit` }
  }

  const phoneE164 = normalizePhoneForMetaUae(buyerPhone)
  if (!isValidE164(phoneE164)) {
    return { success: false, error: `Invalid phone number: ${buyerPhone}` }
  }
  const storedPhone = visit.buyerPhone ? normalizePhoneForMetaUae(visit.buyerPhone) : null
  if (storedPhone && storedPhone !== phoneE164) {
    return { success: false, error: 'Buyer phone does not match the number saved on this visit' }
  }

  const retryAfter = otpResendDelaySeconds(visit.otpCode)
  if (retryAfter > 0) return { success: false, error: `Wait ${retryAfter}s before requesting another OTP` }

  const otp = generateSecureOtp(otpLength ?? DEFAULT_OTP_LENGTH)
  const otpState = issueOtpState({ visitId, otp, secret: SITE_VISIT_OTP_SECRET })

  // Persist only a protected state; the plaintext code exists solely long
  // enough to dispatch it to the buyer.
  const reservation = await prisma.fieldVisit.updateMany({
    where: { id: visitId, otpCode: visit.otpCode },
    data: { otpCode: otpState, otpVerified: false, buyerPhone: phoneE164 },
  })
  if (reservation.count !== 1) {
    return { success: false, error: 'Another OTP request is already in progress. Please wait and try again.' }
  }

  const delivery = await deliverOtp(phoneE164, otp, transports)
  if (!delivery.ok) {
    await prisma.fieldVisit.updateMany({ where: { id: visitId, otpCode: otpState }, data: { otpCode: null } })
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

  let session
  try {
    session = await requireAuth()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }
  try {
    assertVisitExecutionAccess(session, visit)
  } catch {
    return { success: false, error: 'Forbidden' }
  }
  if (!ACTIVE_VISIT_STATUSES.includes(visit.status as (typeof ACTIVE_VISIT_STATUSES)[number])) {
    return { success: false, error: `OTP cannot be verified for a ${visit.status} visit` }
  }
  if (visit.otpVerified) return { success: true, data: { visitId, otpVerified: true } }

  const verification = verifyOtpState({
    visitId,
    enteredOtp: enteredOtp.trim(),
    state: visit.otpCode,
    secret: SITE_VISIT_OTP_SECRET,
  })
  if (!verification.ok) {
    const attemptUpdate = await prisma.fieldVisit.updateMany({
      where: { id: visitId, otpCode: visit.otpCode },
      data: { otpCode: verification.nextState, otpVerified: false },
    })
    if (attemptUpdate.count !== 1) {
      return { success: false, error: 'OTP state changed. Please enter the latest code or request a new one.' }
    }
    const error = verification.reason === 'expired'
      ? 'OTP expired. Request a new code.'
      : verification.reason === 'locked'
        ? 'Too many incorrect attempts. Request a new code.'
        : verification.reason === 'missing'
          ? 'Request a new OTP before verifying.'
          : `The entered OTP is incorrect. ${verification.attemptsRemaining} attempts remaining.`
    return { success: false, error }
  }

  const verified = await prisma.fieldVisit.updateMany({
    where: { id: visitId, otpCode: visit.otpCode, otpVerified: false },
    data: { otpVerified: true, otpCode: null },
  })
  if (verified.count !== 1) {
    return { success: false, error: 'OTP state changed. Please enter the latest code or request a new one.' }
  }

  revalidateVisitPaths()
  return { success: true, data: { visitId, otpVerified: true } }
}

// ─── GEO CHECK-IN (Req 12.4) ─────────────────────────────

/**
 * Validate that the agent is within the project geofence (default 500m) and
 * record the check-in coordinates and time. The trusted project coordinates
 * are always resolved from the database. A check-in farther than the radius
 * is rejected with an error and nothing is persisted (Req 12.4).
 */
export async function geoCheckin(input: unknown) {
  const parsed = geoCheckinSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { visitId, agentLat, agentLng, accuracyM } = parsed.data

  let session
  try {
    session = await requireAuth()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }
  try {
    assertVisitExecutionAccess(session, visit)
  } catch {
    return { success: false, error: 'Forbidden' }
  }
  if (visit.status !== 'Scheduled' && visit.status !== 'In Progress') {
    return { success: false, error: `Cannot check in to a ${visit.status} visit` }
  }
  if (!visit.otpVerified) return { success: false, error: 'Verify the buyer OTP before geo check-in' }
  if (accuracyM != null && accuracyM > 250) {
    return { success: false, error: `GPS accuracy is too low (±${Math.round(accuracyM)}m). Move outdoors and try again.` }
  }

  if (visit.projectId == null) {
    return { success: false, error: 'Project location is unavailable for this visit' }
  }
  const project = await prisma.project.findUnique({
    where: { id: visit.projectId },
    select: { latitude: true, longitude: true },
  })
  if (project?.latitude == null || project.longitude == null) {
    return { success: false, error: 'Project location is unavailable for this visit' }
  }

  const radius = DEFAULT_GEOFENCE_RADIUS_M
  const distanceM = haversineMeters(agentLat, agentLng, project.latitude, project.longitude)

  if (!withinGeofence(agentLat, agentLng, project.latitude, project.longitude, radius)) {
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

  let session
  try {
    session = await requireAuth()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }
  const visit = await prisma.fieldVisit.findUnique({ where: { id: data.visitId } })
  if (!visit) return { success: false, error: 'Visit not found' }
  try {
    assertVisitExecutionAccess(session, visit)
  } catch {
    return { success: false, error: 'Forbidden' }
  }
  if (!visit.otpVerified || visit.geoCheckinTime == null) {
    return { success: false, error: 'OTP verification and geo check-in are required before completing the visit' }
  }
  if (visit.status !== 'In Progress') {
    return { success: false, error: `Feedback cannot complete a ${visit.status} visit` }
  }
  if (!isManagerRole(session.user.role) && data.assignedAgentId != null && data.assignedAgentId !== visit.staffId) {
    return { success: false, error: 'Staff cannot reassign a deal to another agent' }
  }
  if (data.unitId != null && !visit.unitIds.includes(data.unitId)) {
    return { success: false, error: 'Selected deal unit was not included in this site visit' }
  }

  // Validate foreign keys up-front so a follow-up action never half-applies.
  if (data.followUpAction === 'Deal') {
    const [stage, contact, unit] = await Promise.all([
      prisma.dealStage.findUnique({ where: { id: data.stageId! } }),
      prisma.contact.findUnique({ where: { id: data.contactId! }, select: { id: true, phone: true } }),
      data.unitId != null
        ? prisma.unit.findUnique({ where: { id: data.unitId }, select: { status: true } })
        : Promise.resolve(null),
    ])
    if (!stage) return { success: false, error: 'Target deal stage does not exist' }
    if (!contact) return { success: false, error: 'Contact not found' }
    if (!visit.buyerPhone || !contact.phone || !phonesMatch(contact.phone, visit.buyerPhone)) {
      return { success: false, error: 'The deal contact must match the buyer verified for this visit' }
    }
    if (stage.isLost) return { success: false, error: 'Cannot create a visit deal directly into a lost stage' }
    if (data.unitId != null && (!unit || unit.status === 'Sold' || unit.status === 'Mortgaged')) {
      return { success: false, error: 'Selected unit is no longer available for a deal' }
    }
  } else if (data.followUpAction === 'FollowUp') {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId! },
      select: { assignedToId: true, contact: { select: { phone: true } } },
    })
    if (!lead) return { success: false, error: 'Lead not found' }
    if (lead.assignedToId !== visit.staffId) {
      return { success: false, error: 'The follow-up lead must be assigned to the visit agent' }
    }
    if (!visit.buyerPhone || !lead.contact.phone || !phonesMatch(lead.contact.phone, visit.buyerPhone)) {
      return { success: false, error: 'The follow-up lead must belong to the buyer verified for this visit' }
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.fieldVisit.updateMany({
        where: {
          id: data.visitId,
          status: 'In Progress',
          otpVerified: true,
          geoCheckinTime: { not: null },
        },
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
      if (claimed.count !== 1) throw new Error('VISIT_ALREADY_COMPLETED')
      const updatedVisit = await tx.fieldVisit.findUniqueOrThrow({ where: { id: data.visitId } })

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
    return {
      success: true,
      data: {
        visitId: result.visit.id,
        status: result.visit.status,
        dealId: result.deal?.id ?? null,
        followUpId: result.followUp?.id ?? null,
      },
    }
  } catch (error) {
    console.error('Error submitting visit feedback:', error)
    if (error instanceof Error && error.message === 'VISIT_ALREADY_COMPLETED') {
      return { success: false, error: 'This visit was already completed or changed. Refresh and try again.' }
    }
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

  let session
  try {
    session = await requireAuth()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  let { staffId } = parsed.data
  const { projectId, startDate, endDate } = parsed.data
  if (!isManagerRole(session.user.role)) {
    if (session.user.staffId == null) return { success: false, error: 'Staff profile is not linked' }
    if (staffId != null && staffId !== session.user.staffId) return { success: false, error: 'Forbidden' }
    staffId = session.user.staffId
  }

  try {
    const where: Record<string, unknown> = {
      status: 'Completed',
      otpVerified: true,
      geoCheckinTime: { not: null },
    }
    if (staffId) where.staffId = staffId
    if (projectId) where.projectId = projectId
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {}
      if (startDate) dateFilter.gte = new Date(startDate)
      if (endDate) dateFilter.lte = new Date(endDate)
      where.scheduledDate = dateFilter
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
