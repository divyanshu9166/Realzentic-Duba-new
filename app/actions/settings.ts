'use server'

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/auth-helpers'

const updateSettingsSchema = z.object({
  storeName: z.string().min(1).optional(),
  phone: z.string().optional(),
  whatsappNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  paymentQr: z.string().optional(),
  invoicePrefix: z.string().optional(),
  invoicePadding: z.number().min(2).max(8).optional(),
  invoiceTerms: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIban: z.string().optional(),
  vatTrn: z.string().optional(),
  vatRate: z.number().min(0).max(100).optional(),
  currency: z.string().optional(),
  logo: z.string().optional(),
  storeLat: z.number().optional(),
  storeLng: z.number().optional(),
  geofenceRadius: z.number().min(10).max(5000).optional(),
  shiftStartTime: z.string().optional(),
  shiftEndTime: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().min(1).max(65535).optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFromName: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  smtpConfigured: z.boolean().optional(),
})

const supportsStoreSettingsPaymentQr = Boolean(
  Prisma.dmmf.datamodel.models
    .find(model => model.name === 'StoreSettings')
    ?.fields.some(field => field.name === 'paymentQr')
)

const supportsStoreSettingsWhatsappNumber = Boolean(
  Prisma.dmmf.datamodel.models
    .find(model => model.name === 'StoreSettings')
    ?.fields.some(field => field.name === 'whatsappNumber')
)

async function readPaymentQrFromDb() {
  try {
    const rows = await prisma.$queryRaw<Array<{ paymentQr: string | null }>>`
      SELECT "paymentQr" as "paymentQr"
      FROM "StoreSettings"
      WHERE "id" = 1
      LIMIT 1
    `
    return rows[0]?.paymentQr ?? null
  } catch {
    return null
  }
}

async function readWhatsappNumberFromDb() {
  try {
    const rows = await prisma.$queryRaw<Array<{ whatsappNumber: string | null }>>`
      SELECT "whatsappNumber" as "whatsappNumber"
      FROM "StoreSettings"
      WHERE "id" = 1
      LIMIT 1
    `
    return rows[0]?.whatsappNumber ?? null
  } catch {
    return null
  }
}

export async function getStoreSettings() {
  let settings = await prisma.storeSettings.findFirst({ where: { id: 1 } })
  if (!settings) {
    settings = await prisma.storeSettings.create({
      data: { id: 1 },
    })
  }

  const paymentQr = supportsStoreSettingsPaymentQr
    ? ((settings as { paymentQr?: string | null }).paymentQr ?? null)
    : await readPaymentQrFromDb()

  const whatsappNumber = supportsStoreSettingsWhatsappNumber
    ? ((settings as { whatsappNumber?: string | null }).whatsappNumber ?? null)
    : await readWhatsappNumberFromDb()

  return {
    success: true,
    data: {
      storeName: settings.storeName,
      phone: settings.phone,
      whatsappNumber,
      email: settings.email,
      address: settings.address,
      paymentQr,
      invoicePrefix: settings.invoicePrefix,
      invoicePadding: settings.invoicePadding,
      invoiceTerms: settings.invoiceTerms,
      bankName: settings.bankName,
      bankAccountName: settings.bankAccountName,
      bankAccountNumber: settings.bankAccountNumber,
      bankIban: settings.bankIban,
      vatTrn: settings.vatTrn,
      vatRate: settings.vatRate,
      currency: settings.currency,
      logo: settings.logo,
      storeLat: settings.storeLat,
      storeLng: settings.storeLng,
      geofenceRadius: settings.geofenceRadius,
      shiftStartTime: settings.shiftStartTime,
      shiftEndTime: settings.shiftEndTime,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpUser: settings.smtpUser,
      smtpPass: settings.smtpPass,
      smtpFromName: settings.smtpFromName,
      smtpSecure: settings.smtpSecure,
      smtpConfigured: settings.smtpConfigured,
    },
  }
}

export async function updateStoreSettings(data: unknown) {
  try { await requireRole('ADMIN') } catch { return { success: false, error: 'Admin access required' } }
  const parsed = updateSettingsSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { paymentQr, ...settingsWithoutPaymentQr } = parsed.data
  const { whatsappNumber, ...settingsWithoutExtras } = settingsWithoutPaymentQr
  const settingsData = {
    ...settingsWithoutExtras,
    ...(supportsStoreSettingsPaymentQr && paymentQr !== undefined ? { paymentQr } : {}),
    ...(supportsStoreSettingsWhatsappNumber && whatsappNumber !== undefined ? { whatsappNumber } : {}),
  }

  const settings = await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: settingsData,
    create: { id: 1, ...settingsData },
  })

  if (!supportsStoreSettingsPaymentQr && paymentQr !== undefined) {
    try {
      await prisma.$executeRaw`
        UPDATE "StoreSettings"
        SET "paymentQr" = ${paymentQr}
        WHERE "id" = 1
      `
    } catch {
      return {
        success: false,
        error: 'Payment QR field is not available yet. Run `npx prisma generate`, `npx prisma db push`, and restart the dev server.',
      }
    }
  }

  if (!supportsStoreSettingsWhatsappNumber && whatsappNumber !== undefined) {
    try {
      await prisma.$executeRaw`
        UPDATE "StoreSettings"
        SET "whatsappNumber" = ${whatsappNumber}
        WHERE "id" = 1
      `
    } catch {
      return {
        success: false,
        error: 'WhatsApp number field is not available yet. Run `npx prisma generate`, `npx prisma db push`, and restart the dev server.',
      }
    }
  }

  const resolvedPaymentQr = supportsStoreSettingsPaymentQr
    ? ((settings as { paymentQr?: string | null }).paymentQr ?? null)
    : await readPaymentQrFromDb()

  const resolvedWhatsappNumber = supportsStoreSettingsWhatsappNumber
    ? ((settings as { whatsappNumber?: string | null }).whatsappNumber ?? null)
    : await readWhatsappNumberFromDb()

  revalidatePath('/settings')
  return { success: true, data: { ...settings, paymentQr: resolvedPaymentQr, whatsappNumber: resolvedWhatsappNumber } }
}

export async function getMarketplaceChannels() {
  const channels = await prisma.marketplaceChannel.findMany({
    orderBy: { name: 'asc' },
  })

  return {
    success: true,
    data: channels.map(ch => ({
      id: ch.id,
      slug: ch.slug,
      name: ch.name,
      logo: ch.logo,
      color: ch.color,
      connected: ch.connected,
      lastSync: ch.lastSync?.toISOString() || null,
      sellerId: ch.sellerId,
    })),
  }
}

export async function updateMarketplaceChannel(id: number, data: { connected?: boolean; sellerId?: string }) {
  const channel = await prisma.marketplaceChannel.update({
    where: { id },
    data,
  })

  revalidatePath('/settings')
  return { success: true, data: channel }
}

export async function getStoreCampaigns() {
  const campaigns = await prisma.storeCampaign.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return {
    success: true,
    data: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      location: c.location,
      scans: c.scans,
      leads: c.leads,
      status: c.status,
      purpose: c.purpose,
    })),
  }
}
