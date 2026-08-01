'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { normalizePhone } from '@/lib/dedup'

export interface BulkContactRow {
  name: string
  phone: string
  email?: string
  address?: string
  city?: string
  source?: string
  notes?: string
}

export async function bulkImportContacts(rows: BulkContactRow[]) {
  if (!rows || rows.length === 0) return { success: false, error: 'No contacts to import' }

  // Validate — every row needs at least name and phone
  const valid = rows.filter(r => r.name?.trim() && r.phone?.trim())
  if (valid.length === 0) return { success: false, error: 'No valid rows (name and phone required)' }

  // Normalise phone — strip spaces/dashes
  const normalised = valid.map(r => ({
    name: r.name.trim(),
    phone: normalizePhone(r.phone),
    email: r.email?.trim() || undefined,
    address: r.city ? `${r.address || ''}, ${r.city}`.replace(/^,\s*/, '') : r.address?.trim() || undefined,
    source: r.source?.trim() || 'Import',
    notes: r.notes?.trim() || undefined,
  }))

  // Upsert — skip rows whose phone already exists
  let created = 0
  let skipped = 0

  for (const row of normalised) {
    try {
      const existing = await prisma.contact.findFirst({ where: { phone: row.phone } })
      if (existing) {
        skipped++
        continue
      }
      await prisma.contact.create({ data: row })
      created++
    } catch {
      skipped++
    }
  }

  revalidatePath('/marketing')
  return {
    success: true,
    data: { total: valid.length, created, skipped },
  }
}

// ─── CREATE A SINGLE CONTACT (manual add) ────────────────
// Adds one contact from the Contacts UI, with phone-based de-duplication so a
// manually-added contact never collides with an existing record.

export interface CreateContactInput {
  name: string
  phone: string
  email?: string
  source?: string
  emirate?: string
  address?: string
  notes?: string
  nationality?: string
  preferredCurrency?: string
}

export async function createContact(input: CreateContactInput) {
  const name = input?.name?.trim()
  const phone = input?.phone?.trim()
  if (!name) return { success: false as const, error: 'Name is required' }
  if (!phone || phone.replace(/\D/g, '').length < 6) {
    return { success: false as const, error: 'A valid phone number is required' }
  }

  try {
    // De-dup: reject if an existing contact matches by exact or normalized phone.
    const exact = await prisma.contact.findFirst({ where: { phone } })
    if (exact) {
      return { success: false as const, error: 'A contact with this phone number already exists' }
    }
    const normalizedTarget = normalizePhone(phone)
    if (normalizedTarget) {
      const candidates = await prisma.contact.findMany({ select: { id: true, phone: true } })
      const dupe = candidates.find((c) => normalizePhone(c.phone) === normalizedTarget)
      if (dupe) {
        return { success: false as const, error: 'A contact with this phone number already exists' }
      }
    }

    const email = input.email?.trim() || null
    const contact = await prisma.contact.create({
      data: {
        name,
        phone,
        email,
        source: input.source?.trim() || 'Manual',
        emirate: input.emirate?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        nationality: input.nationality?.trim() || null,
        preferredCurrency: input.preferredCurrency?.trim() || 'AED',
      },
    })

    revalidatePath('/contacts')
    return { success: true as const, data: contact }
  } catch (error) {
    console.error('Error creating contact:', error)
    return { success: false as const, error: 'Failed to create contact' }
  }
}

// ─── BRIEF CONTACT LIST ──────────────────────────────────
// Lightweight id/name/phone list for populating selectors (e.g. the
// Site Visit 2.0 feedback "create deal" follow-up). Read-only.

export async function listContactsBrief() {
  try {
    const contacts = await prisma.contact.findMany({
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
      take: 500,
    })
    return { success: true, data: contacts }
  } catch (error) {
    console.error('Error listing contacts:', error)
    return { success: false, error: 'Failed to load contacts', data: [] as { id: number; name: string; phone: string | null }[] }
  }
}


// ─── CONTACTS DIRECTORY ──────────────────────────────────
// The central customer database view: every Contact with quick-glance
// counts (leads / deals / bookings) and source, for the /contacts section.

export interface ContactDirectoryRow {
  id: number
  name: string
  phone: string
  email: string | null
  source: string | null
  emirate: string | null
  nationality: string | null
  createdAt: string
  leadCount: number
  dealCount: number
  bookingCount: number
}

/**
 * List contacts for the Contacts directory, newest first, with linked-record
 * counts. Supports a free-text search across name / phone / email. Capped at
 * 1000 rows for the list view (detail pages load the full record on demand).
 */
export async function getContactsDirectory(params?: { search?: string }): Promise<{
  success: boolean
  data: ContactDirectoryRow[]
  error?: string
}> {
  try {
    const search = params?.search?.trim()
    const where = search
      ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
      : {}

    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        source: true,
        emirate: true,
        nationality: true,
        createdAt: true,
        _count: { select: { leads: true, deals: true, bookings: true } },
      },
    })

    return {
      success: true,
      data: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        source: c.source,
        emirate: c.emirate,
        nationality: c.nationality,
        createdAt: c.createdAt.toISOString(),
        leadCount: c._count.leads,
        dealCount: c._count.deals,
        bookingCount: c._count.bookings,
      })),
    }
  } catch (error) {
    console.error('Error loading contacts directory:', error)
    return { success: false, data: [], error: 'Failed to load contacts' }
  }
}
