'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'

function mapPublication(row: any) {
  return { id: row.id, portalName: row.portalName, projectId: row.projectId, projectName: row.project?.name ?? null, unitId: row.unitId, unitNumber: row.unit?.unitNumber ?? null, status: row.status, externalListingId: row.externalListingId, listingUrl: row.listingUrl, lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null, lastError: row.lastError, payload: row.payload }
}

const include = { project: { select: { name: true } }, unit: { select: { unitNumber: true } } } as const

export async function getListingPublicationWorkspace() {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const [publications, projects, units] = await Promise.all([
      prisma.listingPublication.findMany({ include, orderBy: { updatedAt: 'desc' }, take: 500 }),
      prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.unit.findMany({ select: { id: true, unitNumber: true, tower: { select: { projectId: true, project: { select: { name: true } } } } }, orderBy: { unitNumber: 'asc' }, take: 2000 }),
    ])
    return { success: true, data: { publications: publications.map(mapPublication), projects, units: units.map(unit => ({ id: unit.id, unitNumber: unit.unitNumber, projectId: unit.tower.projectId, projectName: unit.tower.project.name })) } }
  } catch { return { success: false, error: 'Administrator or manager access required' } }
}

export async function saveListingPublication(data: { portalName: string; projectId?: number | null; unitId?: number | null; payload?: unknown }) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const portalName = data.portalName?.trim()
    if (!portalName) return { success: false, error: 'Portal name is required' }
    if (!data.projectId && !data.unitId) return { success: false, error: 'Select a project or unit' }
    if (data.projectId && !(await prisma.project.findUnique({ where: { id: data.projectId }, select: { id: true } }))) return { success: false, error: 'Project not found' }
    if (data.unitId) {
      const unit = await prisma.unit.findUnique({ where: { id: data.unitId }, select: { id: true, tower: { select: { projectId: true } } } })
      if (!unit) return { success: false, error: 'Unit not found' }
      if (data.projectId && unit.tower.projectId !== data.projectId) return { success: false, error: 'Unit does not belong to the selected project' }
    }
    const payload = data.payload == null ? undefined : JSON.parse(JSON.stringify(data.payload)) as Prisma.InputJsonValue
    const existing = await prisma.listingPublication.findFirst({ where: { portalName, projectId: data.projectId ?? null, unitId: data.unitId ?? null } })
    const row = existing
      ? await prisma.listingPublication.update({ where: { id: existing.id }, data: { payload, status: 'DRAFT', lastError: null }, include })
      : await prisma.listingPublication.create({ data: { portalName, projectId: data.projectId ?? null, unitId: data.unitId ?? null, payload }, include })
    revalidatePath('/listing-publications'); return { success: true, data: mapPublication(row) }
  } catch { return { success: false, error: 'Could not save listing publication' } }
}

export async function queueListingPublication(id: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const row = await prisma.listingPublication.update({ where: { id }, data: { status: 'QUEUED', lastError: null }, include })
    revalidatePath('/listing-publications'); return { success: true, data: mapPublication(row) }
  } catch { return { success: false, error: 'Could not queue listing' } }
}

/**
 * Publish through the portal's configured outbound REST adapter. Bayut,
 * Property Finder and Dubizzle credentials/endpoints are intentionally stored
 * per portal because each provider uses a different commercial integration.
 * The CRM owns the queue, payload and reconciliation; the configured adapter
 * owns provider-specific authentication and field translation.
 */
export async function publishListingPublication(id: number) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const row = await prisma.listingPublication.findUnique({ where: { id }, include: { project: true, unit: { include: { tower: { include: { project: true } } } } } })
    if (!row) return { success: false, error: 'Listing publication not found' }
    const config = await prisma.portalConfig.findUnique({ where: { portalName: row.portalName } })
    if (!config?.enabled || !config.listingApiUrl || !config.listingApiKey) return { success: false, error: `${row.portalName} outbound listing API is not configured` }
    let endpoint: URL
    try { endpoint = new URL(config.listingApiUrl); if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('invalid protocol') } catch { return { success: false, error: 'Portal listing API URL is invalid' } }
    await prisma.listingPublication.update({ where: { id }, data: { status: 'PUBLISHING', lastError: null } })
    const project = row.project ?? row.unit?.tower.project ?? null
    const payload = { publicationId: row.id, portal: row.portalName, project: project ? { id: project.id, name: project.name, location: project.location, city: project.city, emirate: project.emirate, description: project.description, latitude: project.latitude, longitude: project.longitude } : null, unit: row.unit ? { id: row.unit.id, unitNumber: row.unit.unitNumber, type: row.unit.type, status: row.unit.status, totalPrice: row.unit.totalPrice, netArea: row.unit.netArea, builtUpArea: row.unit.builtUpArea } : null, custom: row.payload ?? null }
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.listingApiKey}`, 'x-api-key': config.listingApiKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) })
    const body = await response.json().catch(() => ({})) as { id?: string; listingId?: string; url?: string; listingUrl?: string; error?: string; message?: string }
    if (!response.ok) throw new Error(body.error || body.message || `Portal returned HTTP ${response.status}`)
    const updated = await prisma.listingPublication.update({ where: { id }, data: { status: 'PUBLISHED', externalListingId: body.id || body.listingId || null, listingUrl: body.url || body.listingUrl || null, lastPublishedAt: new Date(), lastError: null }, include })
    revalidatePath('/listing-publications'); return { success: true, data: mapPublication(updated) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Portal publication failed'
    try { await prisma.listingPublication.update({ where: { id }, data: { status: 'FAILED', lastError: message.slice(0, 1000) } }) } catch { /* preserve original error */ }
    revalidatePath('/listing-publications'); return { success: false, error: message }
  }
}

/** Record the result after the connected portal adapter has published it. */
export async function recordListingPublicationResult(id: number, result: { success: boolean; externalListingId?: string; listingUrl?: string; error?: string }) {
  try {
    await requireRole('ADMIN', 'MANAGER')
    const row = await prisma.listingPublication.update({ where: { id }, data: result.success ? { status: 'PUBLISHED', externalListingId: result.externalListingId || null, listingUrl: result.listingUrl || null, lastPublishedAt: new Date(), lastError: null } : { status: 'FAILED', lastError: result.error?.slice(0, 1000) || 'Portal publication failed' }, include })
    revalidatePath('/listing-publications'); return { success: true, data: mapPublication(row) }
  } catch { return { success: false, error: 'Could not record portal publication result' } }
}
