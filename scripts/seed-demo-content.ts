import 'dotenv/config'

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

const now = new Date()
const period = now.toISOString().slice(0, 7)

function daysFromNow(days: number, hour = 10, minute = 0) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  date.setHours(hour, minute, 0, 0)
  return date
}

function daysAgo(days: number, hour = 10, minute = 0) {
  return daysFromNow(-days, hour, minute)
}

async function ensureWaContact(userId: string, input: { phone: string; name: string; email: string; company: string }) {
  const existing = await prisma.waContact.findFirst({ where: { user_id: userId, phone: input.phone } })
  return existing
    ? prisma.waContact.update({ where: { id: existing.id }, data: input })
    : prisma.waContact.create({ data: { user_id: userId, ...input } })
}

async function ensureWaMessage(
  conversationId: string,
  key: string,
  input: { sender_type: string; sender_id?: string; content_text: string; status: string; created_at: Date },
) {
  const existing = await prisma.waMessage.findFirst({ where: { message_id: key } })
  return existing
    ? prisma.waMessage.update({ where: { id: existing.id }, data: input })
    : prisma.waMessage.create({ data: { conversation_id: conversationId, message_id: key, ...input } })
}

async function ensureSocialContact(userId: string, platform: 'instagram' | 'facebook', platformId: string, name: string) {
  return prisma.socialContact.upsert({
    where: { user_id_platform_platform_id: { user_id: userId, platform, platform_id: platformId } },
    update: { name },
    create: { user_id: userId, platform, platform_id: platformId, name },
  })
}

async function ensureSocialMessage(
  conversationId: string,
  key: string,
  senderType: 'customer' | 'agent',
  content: string,
  createdAt: Date,
) {
  const existing = await prisma.socialMessage.findFirst({ where: { platform_msg_id: key } })
  return existing
    ? prisma.socialMessage.update({ where: { id: existing.id }, data: { sender_type: senderType, content_text: content, created_at: createdAt } })
    : prisma.socialMessage.create({
      data: {
        conversation_id: conversationId,
        platform_msg_id: key,
        sender_type: senderType,
        content_type: 'text',
        content_text: content,
        status: 'sent',
        created_at: createdAt,
      },
    })
}

async function ensureCrmContact(input: {
  name: string
  phone: string
  email: string
  emirate: string
  nationality: string
  source: string
}) {
  const existing = await prisma.contact.findUnique({ where: { phone: input.phone } })
  return existing
    ? prisma.contact.update({ where: { id: existing.id }, data: input })
    : prisma.contact.create({ data: { ...input, preferredCurrency: 'AED' } })
}

async function ensureDemoProjectPhoto(name: string, photoUrl: string) {
  const project = await prisma.project.findFirst({ where: { name }, select: { id: true, photoUrls: true } })
  if (project && project.photoUrls.length === 0) {
    await prisma.project.update({ where: { id: project.id }, data: { photoUrls: [photoUrl] } })
  }
}

async function ensureProject(input: {
  name: string
  location: string
  city: string
  emirate: string
  type: 'Residential' | 'Commercial' | 'Mixed'
  status: 'Upcoming' | 'UnderConstruction' | 'ReadyToMove'
  builderName: string
  totalUnits: number
  description: string
  amenities: string[]
  dldProjectRegNo: string
  escrowAccountNo: string
  trakheesiPermitNo: string
  saleType: string
  isFreeholdZone: boolean
  latitude: number
  longitude: number
  photoUrls?: string[]
}) {
  const existing = await prisma.project.findFirst({ where: { name: input.name } })
  const data = {
    ...input,
    photoUrls: input.photoUrls ?? [],
    geofenceRadiusM: 200,
    locationConfirmedAt: daysAgo(2, 9),
  }
  return existing
    ? prisma.project.update({ where: { id: existing.id }, data })
    : prisma.project.create({ data })
}

async function ensureTower(projectId: number, name: string, totalFloors: number) {
  const existing = await prisma.tower.findFirst({ where: { projectId, name } })
  return existing
    ? prisma.tower.update({ where: { id: existing.id }, data: { totalFloors, status: 'Active' } })
    : prisma.tower.create({ data: { projectId, name, totalFloors, status: 'Active' } })
}

async function ensureUnit(input: {
  towerId: number
  floorNumber: number
  unitNumber: string
  type: 'Studio' | 'Apartment1' | 'Apartment2' | 'Apartment3' | 'Penthouse' | 'Villa' | 'Townhouse' | 'Office' | 'Retail'
  netArea: number
  builtUpArea: number
  plotArea?: number
  bedroomCount?: number
  bathroomCount?: number
  privateGarden?: boolean
  privatePool?: boolean
  facing: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
  basePricePerSqft: number
  totalPrice: number
}) {
  return prisma.unit.upsert({
    where: { towerId_unitNumber: { towerId: input.towerId, unitNumber: input.unitNumber } },
    update: input,
    create: { ...input, status: 'Available', floorRisePremium: 0, viewPremium: 0, parkingCount: 1, parkingType: 'Covered' },
  })
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@realzentic.com' } })
  if (!admin) throw new Error('Admin user not found. Run the normal database seed first.')

  const staff = await prisma.staff.findMany({ where: { status: 'Active' }, orderBy: { id: 'asc' }, take: 3 })
  if (staff.length === 0) throw new Error('No active staff found. Run the normal database seed first.')

  const adminUserId = String(admin.id)
  const primaryAgent = staff[1] ?? staff[0]
  const secondaryAgent = staff[2] ?? staff[0]
  const crmContacts = await prisma.contact.findMany({
    where: { name: { in: ['James Wilson', 'Fatima Al Mansoori', 'Daniel Wong'] } },
    select: { id: true, name: true },
  })
  const crmContactByName = new Map(crmContacts.map((contact) => [contact.name, contact.id]))
  const jamesId = crmContactByName.get('James Wilson')
  const fatimaId = crmContactByName.get('Fatima Al Mansoori')
  const danielId = crmContactByName.get('Daniel Wong')
  if (!jamesId || !fatimaId || !danielId) throw new Error('CRM contacts not found. Run the normal database seed first.')

  // Keep the normal seeded Dubai projects presentation-ready without
  // overwriting images a user may have uploaded manually.
  await ensureDemoProjectPhoto('Azure Marina Residences', '/demo-properties/azure-marina-residences.svg')
  await ensureDemoProjectPhoto('Sapphire Hills Villas', '/demo-properties/sapphire-hills-villas.svg')
  const marinaProject = await prisma.project.findFirst({ where: { name: 'Azure Marina Residences' } })
  const hillsProject = await prisma.project.findFirst({ where: { name: 'Sapphire Hills Villas' } })
  if (!marinaProject || !hillsProject) throw new Error('Dubai projects not found. Run the normal database seed first.')

  // ── WhatsApp Marketing demo workspace ──────────────────────────────────
  const waProfile = await prisma.waProfile.upsert({
    where: { user_id: adminUserId },
    update: { full_name: admin.name, email: admin.email, role: 'admin' },
    create: { user_id: adminUserId, full_name: admin.name, email: admin.email, role: 'admin' },
  })

  const waContacts = await Promise.all([
    ensureWaContact(adminUserId, { phone: '971501234801', name: 'Maya Thompson', email: 'maya.thompson@example.com', company: 'Thompson Family Office' }),
    ensureWaContact(adminUserId, { phone: '971501234802', name: 'Rami Haddad', email: 'rami.haddad@example.com', company: 'Haddad Investments' }),
    ensureWaContact(adminUserId, { phone: '971501234803', name: 'Olivia Chen', email: 'olivia.chen@example.com', company: 'Chen Capital' }),
    ensureWaContact(adminUserId, { phone: '971501234804', name: 'Khalid Al Zarooni', email: 'khalid.zarooni@example.com', company: 'Private Buyer' }),
  ])

  const hotTag = await prisma.waTag.findFirst({ where: { user_id: adminUserId, name: 'Hot Buyer' } })
    ?? await prisma.waTag.create({ data: { user_id: adminUserId, name: 'Hot Buyer', color: '#ef4444' } })
  const investorTag = await prisma.waTag.findFirst({ where: { user_id: adminUserId, name: 'Dubai Investor' } })
    ?? await prisma.waTag.create({ data: { user_id: adminUserId, name: 'Dubai Investor', color: '#8b5cf6' } })
  await prisma.waContactTag.upsert({ where: { contact_id_tag_id: { contact_id: waContacts[0].id, tag_id: hotTag.id } }, update: {}, create: { contact_id: waContacts[0].id, tag_id: hotTag.id } })
  await prisma.waContactTag.upsert({ where: { contact_id_tag_id: { contact_id: waContacts[1].id, tag_id: investorTag.id } }, update: {}, create: { contact_id: waContacts[1].id, tag_id: investorTag.id } })

  const waConversationSpecs = [
    { contact: waContacts[0], last: 'Could you share the payment plan and viewing slots?', unread: 2, daysAgo: 0 },
    { contact: waContacts[1], last: 'The 2BR at Dubai Marina looks interesting.', unread: 1, daysAgo: 1 },
    { contact: waContacts[2], last: 'Please send the service charge estimate.', unread: 0, daysAgo: 2 },
    { contact: waContacts[3], last: 'I can visit the showroom tomorrow afternoon.', unread: 3, daysAgo: 0 },
  ]
  const waConversations: Array<{ id: string }> = []
  for (const [index, spec] of waConversationSpecs.entries()) {
    const lastAt = daysAgo(spec.daysAgo, 9 + index, 15)
    const conversation = await prisma.waConversation.upsert({
      where: { user_id_contact_id: { user_id: adminUserId, contact_id: spec.contact.id } },
      update: { status: 'open', needs_human: index !== 2, assigned_agent_id: adminUserId, last_message_text: spec.last, last_message_at: lastAt, unread_count: spec.unread },
      create: { user_id: adminUserId, contact_id: spec.contact.id, status: 'open', needs_human: index !== 2, assigned_agent_id: adminUserId, last_message_text: spec.last, last_message_at: lastAt, unread_count: spec.unread },
    })
    waConversations.push(conversation)

    await ensureWaMessage(conversation.id, `demo-wa-${index}-1`, { sender_type: 'customer', sender_id: spec.contact.id, content_text: index === 0 ? 'Hello, I am looking for a family home in Dubai Hills.' : 'Hi, I would like more information about this property.', status: 'delivered', created_at: daysAgo(spec.daysAgo + 1, 8, 30) })
    await ensureWaMessage(conversation.id, `demo-wa-${index}-2`, { sender_type: 'agent', sender_id: adminUserId, content_text: index === 0 ? 'Absolutely. I can share the brochure, payment plan and viewing availability.' : 'Thanks for reaching out. I am checking the latest availability for you now.', status: 'read', created_at: daysAgo(spec.daysAgo, 8, 45) })
    await ensureWaMessage(conversation.id, `demo-wa-${index}-3`, { sender_type: 'customer', sender_id: spec.contact.id, content_text: spec.last, status: 'delivered', created_at: lastAt })
  }

  const templateName = 'dubai_property_viewing_demo'
  const existingTemplate = await prisma.waMessageTemplate.findFirst({ where: { user_id: adminUserId, name: templateName, language: 'en_US' } })
  await (existingTemplate
    ? prisma.waMessageTemplate.update({ where: { id: existingTemplate.id }, data: { status: 'Approved', body_text: 'Hello {{1}}, your Dubai property viewing is confirmed for {{2}} at {{3}}. Reply here if you need assistance.' } })
    : prisma.waMessageTemplate.create({ data: { user_id: adminUserId, name: templateName, category: 'Marketing', language: 'en_US', body_text: 'Hello {{1}}, your Dubai property viewing is confirmed for {{2}} at {{3}}. Reply here if you need assistance.', footer_text: 'Realzentic Dubai — Demo template', status: 'Approved', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm viewing' }] } }))

  const broadcastSpecs = [
    { name: 'Dubai Hills Weekend Viewing — Demo', status: 'sent', scheduled_at: daysAgo(1, 9), total: 4, sent: 4, delivered: 4, read: 3, replied: 2 },
    { name: 'Marina Investor Update — Demo', status: 'scheduled', scheduled_at: daysFromNow(2, 11), total: 3, sent: 0, delivered: 0, read: 0, replied: 0 },
    { name: 'New Launch Interest Follow-up — Demo', status: 'draft', scheduled_at: null, total: 0, sent: 0, delivered: 0, read: 0, replied: 0 },
  ]
  for (const [index, spec] of broadcastSpecs.entries()) {
    const existing = await prisma.waBroadcast.findFirst({ where: { user_id: adminUserId, name: spec.name } })
    const broadcast = existing
      ? await prisma.waBroadcast.update({ where: { id: existing.id }, data: { template_name: templateName, template_language: 'en_US', audience_filter: { source: 'demo', segment: index === 1 ? 'investors' : 'viewing_interest' }, scheduled_at: spec.scheduled_at, status: spec.status, total_recipients: spec.total, sent_count: spec.sent, delivered_count: spec.delivered, read_count: spec.read, replied_count: spec.replied } })
      : await prisma.waBroadcast.create({ data: { user_id: adminUserId, name: spec.name, template_name: templateName, template_language: 'en_US', audience_filter: { source: 'demo', segment: index === 1 ? 'investors' : 'viewing_interest' }, scheduled_at: spec.scheduled_at, status: spec.status, total_recipients: spec.total, sent_count: spec.sent, delivered_count: spec.delivered, read_count: spec.read, replied_count: spec.replied } })
    if (spec.total > 0) {
      for (const [recipientIndex, contact] of waContacts.slice(0, spec.total).entries()) {
        const existingRecipient = await prisma.waBroadcastRecipient.findFirst({ where: { broadcast_id: broadcast.id, contact_id: contact.id } })
        const recipientData = { status: index === 0 ? (recipientIndex === 3 ? 'delivered' : recipientIndex === 2 ? 'read' : 'replied') : 'pending', sent_at: index === 0 ? daysAgo(1, 9, 5) : null, delivered_at: index === 0 ? daysAgo(1, 9, 6) : null, read_at: index === 0 && recipientIndex < 3 ? daysAgo(1, 9, 8) : null, replied_at: index === 0 && recipientIndex < 2 ? daysAgo(1, 8, 55) : null }
        if (existingRecipient) await prisma.waBroadcastRecipient.update({ where: { id: existingRecipient.id }, data: recipientData })
        else await prisma.waBroadcastRecipient.create({ data: { broadcast_id: broadcast.id, contact_id: contact.id, ...recipientData } })
      }
    }
  }

  const existingPipeline = await prisma.waPipeline.findFirst({ where: { user_id: adminUserId, name: 'Dubai Sales Pipeline — Demo' } })
  const pipeline = existingPipeline ?? await prisma.waPipeline.create({ data: { user_id: adminUserId, name: 'Dubai Sales Pipeline — Demo' } })
  const pipelineStages: Array<{ id: string }> = []
  for (const [position, name, color] of [
    [0, 'New Enquiry', '#3b82f6'],
    [1, 'Qualified', '#8b5cf6'],
    [2, 'Viewing Booked', '#f59e0b'],
    [3, 'Negotiation', '#10b981'],
  ] as const) {
    const existing = await prisma.waPipelineStage.findFirst({ where: { pipeline_id: pipeline.id, name } })
    pipelineStages.push(existing
      ? await prisma.waPipelineStage.update({ where: { id: existing.id }, data: { position, color } })
      : await prisma.waPipelineStage.create({ data: { pipeline_id: pipeline.id, name, position, color } }))
  }
  for (const [index, contact] of waContacts.slice(0, 3).entries()) {
    const title = `${contact.name} — Dubai property enquiry`
    const existing = await prisma.waDeal.findFirst({ where: { user_id: adminUserId, title } })
    const data = { user_id: adminUserId, pipeline_id: pipeline.id, stage_id: pipelineStages[Math.min(index + 1, pipelineStages.length - 1)].id, contact_id: contact.id, conversation_id: waConversations[index].id, assigned_to: waProfile.id, title, value: [2200000, 4800000, 7350000][index], currency: 'AED', status: index === 2 ? 'won' : 'open', notes: 'Demo pipeline record for client presentation.', expected_close_date: daysFromNow(14 + index * 7) }
    if (existing) await prisma.waDeal.update({ where: { id: existing.id }, data })
    else await prisma.waDeal.create({ data })
  }

  const automationName = 'Demo — Route new buyer enquiries'
  const existingAutomation = await prisma.waAutomation.findFirst({ where: { user_id: adminUserId, name: automationName } })
  const automation = existingAutomation ?? await prisma.waAutomation.create({ data: { user_id: adminUserId, name: automationName, description: 'Routes new WhatsApp property enquiries to a consultant and sends a viewing response.', trigger_type: 'new_message_received', trigger_config: { demo: true }, is_active: true, execution_count: 18, last_executed_at: daysAgo(0, 8, 50) } })
  await prisma.waAutomation.update({ where: { id: automation.id }, data: { is_active: true, execution_count: 18, last_executed_at: daysAgo(0, 8, 50) } })
  const existingStep = await prisma.waAutomationStep.findFirst({ where: { automation_id: automation.id, position: 0 } })
  if (!existingStep) await prisma.waAutomationStep.create({ data: { automation_id: automation.id, step_type: 'send_template', step_config: { template_name: templateName, language: 'en_US' }, position: 0 } })
  const existingLog = await prisma.waAutomationLog.findFirst({ where: { automation_id: automation.id, trigger_event: 'demo_seed_execution' } })
  if (!existingLog) await prisma.waAutomationLog.create({ data: { automation_id: automation.id, user_id: adminUserId, contact_id: waContacts[0].id, trigger_event: 'demo_seed_execution', steps_executed: [{ step: 'send_template', status: 'success' }], status: 'success' } })

  // ── Instagram and Facebook DM demo inboxes ─────────────────────────────
  for (const [platform, prefix, name, message] of [
    ['instagram', 'igsid-demo-001', 'Aisha Rahman', 'Hi, is the Dubai Hills villa available for a private viewing?'],
    ['instagram', 'igsid-demo-002', 'Marco Silva', 'Can you share the payment plan for the Marina residences?'],
    ['facebook', 'psid-demo-001', 'Noura Al Hashimi', 'I found your listing and would like the brochure in English.'],
    ['facebook', 'psid-demo-002', 'Daniel Reed', 'Do you have any ready-to-move apartments near Business Bay?'],
  ] as const) {
    const contact = await ensureSocialContact(adminUserId, platform, prefix, name)
    const lastAt = daysAgo(platform === 'instagram' ? 0 : 1, 10, 20)
    const conversation = await prisma.socialConversation.upsert({
      where: { user_id_contact_id: { user_id: adminUserId, contact_id: contact.id } },
      update: { platform, status: 'open', last_message_text: message, last_message_at: lastAt, unread_count: name === 'Marco Silva' ? 0 : 1 },
      create: { user_id: adminUserId, contact_id: contact.id, platform, status: 'open', last_message_text: message, last_message_at: lastAt, unread_count: name === 'Marco Silva' ? 0 : 1 },
    })
    await ensureSocialMessage(conversation.id, `demo-${platform}-${prefix}-1`, 'agent', 'Hello, thanks for contacting Realzentic Dubai. How can I help?', daysAgo(platform === 'instagram' ? 1 : 2, 9, 30))
    await ensureSocialMessage(conversation.id, `demo-${platform}-${prefix}-2`, 'customer', message, lastAt)
  }

  // ── Additional property inventory ──────────────────────────────────────
  const creekProject = await ensureProject({
    name: 'Crescent Bay Offices', location: 'Business Bay', city: 'Dubai', emirate: 'Dubai', type: 'Commercial', status: 'ReadyToMove', builderName: 'Crescent Business Group', totalUnits: 3,
    description: 'Grade-A fitted offices with canal views and flexible business-suite layouts.', amenities: ['24/7 security', 'Reception lobby', 'Meeting rooms', 'Visitor parking'], dldProjectRegNo: 'DLD-PRJ-2026-0003', escrowAccountNo: 'ESCROW-CRESCENT-003', trakheesiPermitNo: 'TRAKHEESI-2026-0003', saleType: 'Freehold', isFreeholdZone: true, latitude: 25.1869, longitude: 55.2648, photoUrls: ['/demo-properties/crescent-bay-offices.svg'],
  })
  const creekTower = await ensureTower(creekProject.id, 'Crescent Tower', 18)
  const creekUnits = await Promise.all([
    ensureUnit({ towerId: creekTower.id, floorNumber: 5, unitNumber: 'OFF-501', type: 'Office', netArea: 980, builtUpArea: 1180, facing: 'NE', basePricePerSqft: 2100, totalPrice: 2478000 }),
    ensureUnit({ towerId: creekTower.id, floorNumber: 9, unitNumber: 'OFF-904', type: 'Office', netArea: 1450, builtUpArea: 1680, facing: 'W', basePricePerSqft: 2250, totalPrice: 3780000 }),
  ])
  const groveProject = await ensureProject({
    name: 'Palm Grove Townhomes', location: 'Jumeirah Village Circle', city: 'Dubai', emirate: 'Dubai', type: 'Residential', status: 'Upcoming', builderName: 'Palm Grove Living', totalUnits: 4,
    description: 'Contemporary family townhomes with landscaped courtyards and community amenities.', amenities: ['Clubhouse', 'Kids play area', 'Jogging track', 'Community pool'], dldProjectRegNo: 'DLD-PRJ-2026-0004', escrowAccountNo: 'ESCROW-PALMGROVE-004', trakheesiPermitNo: 'TRAKHEESI-2026-0004', saleType: 'Off-plan', isFreeholdZone: true, latitude: 25.0562, longitude: 55.2106, photoUrls: ['/demo-properties/palm-grove-townhomes.svg'],
  })
  const groveTower = await ensureTower(groveProject.id, 'Townhome Collection', 2)
  const groveUnits = await Promise.all([
    ensureUnit({ towerId: groveTower.id, floorNumber: 1, unitNumber: 'TH-01', type: 'Townhouse', netArea: 1850, builtUpArea: 2250, plotArea: 1600, bedroomCount: 3, bathroomCount: 4, privateGarden: true, facing: 'E', basePricePerSqft: 1320, totalPrice: 2970000 }),
    ensureUnit({ towerId: groveTower.id, floorNumber: 1, unitNumber: 'TH-02', type: 'Townhouse', netArea: 2040, builtUpArea: 2450, plotArea: 1900, bedroomCount: 4, bathroomCount: 5, privateGarden: true, facing: 'N', basePricePerSqft: 1380, totalPrice: 3381000 }),
  ])

  // ── Leads and walk-ins for the client presentation ─────────────────────
  const demoLeadContacts = await Promise.all([
    ensureCrmContact({ name: 'Sofia Martinez', phone: '971501234811', email: 'sofia.martinez@example.com', emirate: 'Dubai', nationality: 'Spanish', source: 'Instagram' }),
    ensureCrmContact({ name: 'Ali Rahman', phone: '971501234812', email: 'ali.rahman@example.com', emirate: 'Dubai', nationality: 'British', source: 'Website' }),
    ensureCrmContact({ name: 'Elena Petrova', phone: '971501234813', email: 'elena.petrova@example.com', emirate: 'Dubai', nationality: 'Russian', source: 'Bayut' }),
    ensureCrmContact({ name: 'Yusuf Khan', phone: '971501234814', email: 'yusuf.khan@example.com', emirate: 'Dubai', nationality: 'Indian', source: 'Property Finder' }),
    ensureCrmContact({ name: 'Lara Bennett', phone: '971501234815', email: 'lara.bennett@example.com', emirate: 'Dubai', nationality: 'Australian', source: 'Referral' }),
  ])
  const leadSpecs = [
    { contact: demoLeadContacts[0], projectId: hillsProject.id, interest: '4 Bedroom Villa in Dubai Hills Estate', budget: '6.5M AED', status: 'CONTACTED' as const, source: 'Instagram', community: 'Dubai Hills Estate', assignedToId: primaryAgent.id, date: daysAgo(0, 8, 35), note: 'Requested a private viewing and family-community details.', followUpDate: daysAgo(0, 16), followUpMessage: 'Confirm Sofia’s preferred viewing slot and share the villa brochure.' },
    { contact: demoLeadContacts[1], projectId: marinaProject.id, interest: '2 Bedroom Apartment in Dubai Marina', budget: '2.4M AED', status: 'NEW' as const, source: 'Website', community: 'Dubai Marina', assignedToId: secondaryAgent.id, date: daysAgo(0, 9, 10), note: 'First-time enquiry; prefers a flexible developer payment plan.', followUpDate: daysFromNow(1, 11), followUpMessage: 'Call Ali with the latest two-bedroom availability and payment plan.' },
    { contact: demoLeadContacts[2], projectId: groveProject.id, interest: 'Ready 1 Bedroom Apartment in Jumeirah Village Circle', budget: '1.35M AED', status: 'SHOWROOM_VISIT' as const, source: 'Bayut', community: 'Jumeirah Village Circle', assignedToId: primaryAgent.id, date: daysAgo(1, 14, 20), note: 'Viewing confirmed; comparing ready homes close to community amenities.', followUpDate: daysFromNow(1, 15), followUpMessage: 'Send Elena the JVC short-list and confirm the viewing arrival point.' },
    { contact: demoLeadContacts[3], projectId: creekProject.id, interest: 'Fitted Office in Business Bay', budget: '3.8M AED', status: 'QUOTATION' as const, source: 'Property Finder', community: 'Business Bay', assignedToId: secondaryAgent.id, date: daysAgo(2, 11, 40), note: 'Requested a side-by-side comparison of fitted office units.', followUpDate: daysAgo(0, 13), followUpMessage: 'Follow up on the Business Bay office quotation and service-charge estimate.' },
    { contact: demoLeadContacts[4], projectId: hillsProject.id, interest: 'Dubai Hills Family Villa', budget: '7.2M AED', status: 'WON' as const, source: 'Referral', community: 'Dubai Hills Estate', assignedToId: primaryAgent.id, date: daysAgo(5, 12, 10), note: 'Converted buyer; demo record used to show the won pipeline stage.', followUpDate: daysFromNow(30, 10), followUpMessage: 'Schedule the post-sale handover check-in.' },
  ]
  for (const spec of leadSpecs) {
    const leadData = {
      contactId: spec.contact.id,
      projectId: spec.projectId,
      interest: spec.interest,
      budget: spec.budget,
      status: spec.status,
      source: spec.source,
      community: spec.community,
      nationality: spec.contact.nationality,
      visaStatus: 'Valid',
      preferredLanguage: 'English',
      assignedToId: spec.assignedToId,
      date: spec.date,
      notes: spec.note,
      assignedAt: spec.date,
      firstResponseAt: spec.status === 'NEW' ? null : new Date(spec.date.getTime() + 18 * 60 * 1000),
      responseDueAt: new Date(spec.date.getTime() + 15 * 60 * 1000),
      assignmentReason: 'Demo presentation lead assignment',
    }
    const existing = await prisma.lead.findFirst({ where: { contactId: spec.contact.id, interest: spec.interest } })
    const lead = existing
      ? await prisma.lead.update({ where: { id: existing.id }, data: leadData })
      : await prisma.lead.create({ data: leadData })

    const existingAssignment = await prisma.leadAssignmentEvent.findFirst({ where: { leadId: lead.id, reason: 'Demo presentation lead assignment' } })
    if (!existingAssignment) {
      await prisma.leadAssignmentEvent.create({
        data: {
          leadId: lead.id,
          toStaffId: spec.assignedToId,
          reason: 'Demo presentation lead assignment',
          assignedAt: spec.date,
          responseDueAt: leadData.responseDueAt,
          respondedAt: leadData.firstResponseAt,
        },
      })
    }

    const existingFollowUp = await prisma.followUp.findFirst({ where: { leadId: lead.id, day: 1 } })
    if (existingFollowUp) {
      await prisma.followUp.update({ where: { id: existingFollowUp.id }, data: { message: spec.followUpMessage, date: spec.followUpDate, sent: false } })
    } else {
      await prisma.followUp.create({ data: { leadId: lead.id, day: 1, message: spec.followUpMessage, sent: false, date: spec.followUpDate } })
    }
  }

  const demoWalkinContacts = await Promise.all([
    ensureCrmContact({ name: 'Noor Al Mazrouei', phone: '971501234821', email: 'noor.almazrouei@example.com', emirate: 'Dubai', nationality: 'Emirati', source: 'Walk-in' }),
    ensureCrmContact({ name: 'Michael Turner', phone: '971501234822', email: 'michael.turner@example.com', emirate: 'Dubai', nationality: 'British', source: 'Walk-in' }),
    ensureCrmContact({ name: 'Hana Siddiqui', phone: '971501234823', email: 'hana.siddiqui@example.com', emirate: 'Dubai', nationality: 'Pakistani', source: 'Walk-in' }),
    ensureCrmContact({ name: 'Ravi Kapoor', phone: '971501234824', email: 'ravi.kapoor@example.com', emirate: 'Dubai', nationality: 'Indian', source: 'Walk-in' }),
    ensureCrmContact({ name: 'Leila Haddad', phone: '971501234825', email: 'leila.haddad@example.com', emirate: 'Dubai', nationality: 'Lebanese', source: 'Walk-in' }),
  ])
  const walkinSpecs = [
    { contact: demoWalkinContacts[0], requirement: '3 Bedroom Townhouse in Jumeirah Village Circle', budget: '2.9M AED', status: 'BROWSING' as const, date: daysAgo(0, 9, 15), time: '09:15 AM', assignedToId: primaryAgent.id, notes: 'Family buyer browsing townhouse layouts and community facilities.' },
    { contact: demoWalkinContacts[1], requirement: '2 Bedroom Waterfront Apartment in Dubai Marina', budget: '2.8M AED', status: 'INTERESTED' as const, date: daysAgo(0, 10, 40), time: '10:40 AM', assignedToId: secondaryAgent.id, notes: 'Interested in marina views; requested a payment-plan comparison.' },
    { contact: demoWalkinContacts[2], requirement: 'Ready Villa in Dubai Hills Estate', budget: '6M AED', status: 'FOLLOW_UP' as const, date: daysAgo(1, 15, 20), time: '03:20 PM', assignedToId: primaryAgent.id, notes: 'Follow-up required after reviewing two villa options.' },
    { contact: demoWalkinContacts[3], requirement: 'Fitted Office in Business Bay', budget: '3.5M AED', status: 'CONVERTED' as const, date: daysAgo(2, 12, 5), time: '12:05 PM', assignedToId: secondaryAgent.id, notes: 'Converted to a qualified office enquiry after a consultation.' },
    { contact: demoWalkinContacts[4], requirement: 'Off-plan Apartment near Dubai Creek Harbour', budget: '1.8M AED', status: 'LEFT' as const, date: daysAgo(3, 17, 10), time: '05:10 PM', assignedToId: primaryAgent.id, notes: 'Left after collecting the launch brochure; nurture follow-up planned.' },
  ]
  for (const spec of walkinSpecs) {
    const existing = await prisma.walkin.findFirst({ where: { contactId: spec.contact.id, requirement: spec.requirement } })
    const walkinData = {
      contactId: spec.contact.id,
      requirement: spec.requirement,
      assignedToId: spec.assignedToId,
      date: spec.date,
      time: spec.time,
      status: spec.status,
      budget: spec.budget,
      notes: spec.notes,
      source: 'Walk-in',
      visitDuration: spec.status === 'LEFT' ? '18 min' : spec.status === 'CONVERTED' ? '42 min' : '27 min',
    }
    if (existing) await prisma.walkin.update({ where: { id: existing.id }, data: walkinData })
    else await prisma.walkin.create({ data: walkinData })
  }

  // ── CRM activity that makes the dashboard and operations screens useful ──
  const appointmentSpecs = [
    { contactId: jamesId, purpose: 'Dubai Hills villa viewing', date: daysFromNow(1, 11), time: '11:00 AM', notes: 'DEMO_SEED_APPOINTMENT_01' },
    { contactId: fatimaId, purpose: 'Off-plan investment consultation', date: daysFromNow(2, 15), time: '03:00 PM', notes: 'DEMO_SEED_APPOINTMENT_02' },
    { contactId: danielId, purpose: 'Business Bay office tour', date: daysFromNow(3, 10), time: '10:00 AM', notes: 'DEMO_SEED_APPOINTMENT_03' },
  ]
  for (const spec of appointmentSpecs) {
    const existing = await prisma.appointment.findFirst({ where: { notes: spec.notes } })
    if (existing) await prisma.appointment.update({ where: { id: existing.id }, data: { ...spec, status: 'Scheduled' } })
    else await prisma.appointment.create({ data: { ...spec, status: 'Scheduled' } })
  }

  const visitSpecs = [
    { displayId: 'FV-DEMO-001', staffId: primaryAgent.id, customer: 'Maya Thompson', address: 'Crescent Bay Offices, Business Bay, Dubai', projectId: creekProject.id, unitIds: [creekUnits[0].id], status: 'Scheduled', date: daysFromNow(1, 11), scheduledDate: daysFromNow(1, 11), scheduledTime: '11:00 AM - 12:00 PM', time: '11:00 AM', type: 'Office Tour', buyerPhone: '971501234801', notes: 'DEMO_SEED_VISIT_001' },
    { displayId: 'FV-DEMO-002', staffId: secondaryAgent.id, customer: 'Rami Haddad', address: 'Palm Grove Townhomes, Jumeirah Village Circle, Dubai', projectId: groveProject.id, unitIds: [groveUnits[0].id], status: 'In Progress', date: daysAgo(0, 9), scheduledDate: daysAgo(0, 9), scheduledTime: '09:00 AM - 10:00 AM', time: '09:00 AM', type: 'Investor Tour', buyerPhone: '971501234802', geoCheckinLat: 25.0562, geoCheckinLng: 55.2106, geoCheckinTime: daysAgo(0, 9, 12), notes: 'DEMO_SEED_VISIT_002' },
  ]
  for (const spec of visitSpecs) {
    const existing = await prisma.fieldVisit.findFirst({ where: { displayId: spec.displayId } })
    if (existing) await prisma.fieldVisit.update({ where: { id: existing.id }, data: spec })
    else await prisma.fieldVisit.create({ data: { ...spec, photoUrls: [], notes: spec.notes ?? 'DEMO_SEED_VISIT_001' } })
  }
  const liveVisit = await prisma.fieldVisit.findFirst({ where: { displayId: 'FV-DEMO-002' } })
  for (const [index, agent] of [primaryAgent, secondaryAgent].entries()) {
    const location = await prisma.agentLocation.findFirst({ where: { staffId: agent.id, recordedAt: { gte: new Date(now.getTime() - 5 * 60 * 1000) } } })
    if (!location) await prisma.agentLocation.create({ data: { staffId: agent.id, latitude: index === 0 ? 25.1117 : 25.0808, longitude: index === 0 ? 55.2422 : 55.1403, accuracyM: 18, speed: index === 0 ? 0.8 : 1.4, heading: index === 0 ? 90 : 180, visitId: index === 1 ? liveVisit?.id : null, recordedAt: new Date(now.getTime() - (index + 1) * 45 * 1000) } })
  }

  for (const [index, task] of [
    { title: 'Follow up with Maya on Dubai Hills payment plan', type: 'Follow-up', priority: 'High', assignedToId: primaryAgent.id, contactId: jamesId, dueDate: daysFromNow(1, 12), description: 'Share the approved payment-plan brochure and confirm viewing.' },
    { title: 'Prepare Crescent Bay office comparison', type: 'Documentation', priority: 'Medium', assignedToId: secondaryAgent.id, contactId: danielId, dueDate: daysFromNow(2, 14), description: 'Compare two fitted office options and service-charge estimates.' },
    { title: 'Confirm tomorrow morning investor tour', type: 'Site Visit', priority: 'High', assignedToId: primaryAgent.id, contactId: fatimaId, dueDate: daysFromNow(0, 17), description: 'Confirm arrival point and send calendar details.' },
  ].entries()) {
    const existing = await prisma.task.findFirst({ where: { title: task.title } })
    if (existing) await prisma.task.update({ where: { id: existing.id }, data: { ...task, status: index === 2 ? 'Done' : 'Open', completedAt: index === 2 ? daysAgo(0, 9) : null } })
    else await prisma.task.create({ data: { ...task, status: index === 2 ? 'Done' : 'Open', completedAt: index === 2 ? daysAgo(0, 9) : null } })
  }

  const callSpecs = [
    { key: 'DEMO_SEED_CALL_01', contactId: jamesId, customerName: 'Maya Thompson', phone: '971501234801', direction: 'OUTBOUND' as const, status: 'COMPLETED' as const, duration: '04:32', durationSec: 272, agent: primaryAgent.name, date: daysAgo(0, 8, 20), time: '08:20 AM', purpose: 'Payment plan follow-up', outcome: 'Requested brochure and viewing', notes: 'DEMO_SEED_CALL_01' },
    { key: 'DEMO_SEED_CALL_02', contactId: fatimaId, customerName: 'Rami Haddad', phone: '971501234802', direction: 'INBOUND' as const, status: 'COMPLETED' as const, duration: '07:10', durationSec: 430, agent: secondaryAgent.name, date: daysAgo(1, 16, 10), time: '04:10 PM', purpose: 'Investment enquiry', outcome: 'Viewing scheduled', notes: 'DEMO_SEED_CALL_02' },
  ]
  for (const call of callSpecs) {
    const existing = await prisma.callLog.findFirst({ where: { notes: call.key } })
    const { key: _key, ...callData } = call
    if (existing) await prisma.callLog.update({ where: { id: existing.id }, data: callData })
    else await prisma.callLog.create({ data: callData })
  }

  const paymentSpecs = [
    { displayId: 'PAY-DEMO-001', amount: 250000, vatAmount: 12500, method: 'Bank Transfer', reference: 'RESERVATION-AZURE-A1204', date: daysAgo(0, 9, 5), customerName: 'James Wilson', contactId: jamesId, notes: 'Reservation deposit — demo presentation record.' },
    { displayId: 'PAY-DEMO-002', amount: 75000, vatAmount: 3750, method: 'Card', reference: 'VIEWING-FEE-SAPPHIRE-001', date: daysAgo(0, 11, 25), customerName: 'Fatima Al Mansoori', contactId: fatimaId, notes: 'Consultation and viewing fee — demo presentation record.' },
  ]
  for (const payment of paymentSpecs) {
    await prisma.dailyPayment.upsert({
      where: { displayId: payment.displayId },
      update: { ...payment, type: 'IN', status: 'Reconciled', reconciled: true, reconciledDate: payment.date, receivedByStaffId: primaryAgent.id, isReversal: false },
      create: { ...payment, type: 'IN', status: 'Reconciled', reconciled: true, reconciledDate: payment.date, receivedByStaffId: primaryAgent.id, isReversal: false },
    })
  }

  const marketingCategory = await prisma.expenseCategory.upsert({
    where: { name: 'Client Marketing' },
    update: {},
    create: { name: 'Client Marketing', icon: 'Megaphone', color: '#8b5cf6', budget: 15000, isDefault: false, isActive: true, sortOrder: 80 },
  })
  for (const expense of [
    { description: 'Dubai Hills weekend open-house creative', amount: 4200, vendor: 'Demo Creative Studio', date: daysAgo(1, 12), reference: 'MKT-DEMO-001' },
    { description: 'Property photography and listing refresh', amount: 2800, vendor: 'Demo Visuals UAE', date: daysAgo(3, 14), reference: 'MKT-DEMO-002' },
  ]) {
    const existing = await prisma.expense.findFirst({ where: { reference: expense.reference } })
    const expenseData = { ...expense, categoryId: marketingCategory.id, paymentMode: 'Bank Transfer', status: 'Approved', approvedBy: 'Realzentic Administrator', notes: 'Demo presentation expense.' }
    if (existing) await prisma.expense.update({ where: { id: existing.id }, data: expenseData })
    else await prisma.expense.create({ data: expenseData })
  }

  for (const [agent, metrics] of [[primaryAgent, { deals: 6, revenue: 18200000, siteVisits: 14, calls: 86, npsScore: 92 }], [secondaryAgent, { deals: 4, revenue: 12400000, siteVisits: 11, calls: 74, npsScore: 88 }], [staff[0], { deals: 3, revenue: 9800000, siteVisits: 8, calls: 61, npsScore: 84 }]] as const) {
    await prisma.agentScore.upsert({ where: { staffId_period: { staffId: agent.id, period } }, update: { metrics }, create: { staffId: agent.id, period, metrics } })
  }

  for (const [index, campaign] of [
    { name: 'Dubai Hills Weekend Open House — Demo', channel: 'Instagram & Facebook', status: 'SENT' as const, audience: 680, sent: 642, opened: 421, clicked: 96 },
    { name: 'Marina Investor Briefing — Demo', channel: 'WhatsApp', status: 'SCHEDULED' as const, audience: 240, sent: 0, opened: 0, clicked: 0 },
  ].entries()) {
    const existing = await prisma.campaign.findFirst({ where: { name: campaign.name } })
    if (existing) await prisma.campaign.update({ where: { id: existing.id }, data: campaign })
    else await prisma.campaign.create({ data: { ...campaign, scheduledDate: index === 1 ? daysFromNow(2, 11) : daysAgo(2, 10), template: 'Dubai property showcase — demo campaign' } })
  }

  console.log('✅ Demo content is ready for the admin presentation account.')
  console.log(`   Leads: ${demoLeadContacts.length} | Walk-ins: ${demoWalkinContacts.length} | Payments: ${paymentSpecs.length}`)
  console.log('   Property visuals: Azure Marina, Sapphire Hills, Crescent Bay and Palm Grove')
  console.log(`   WhatsApp conversations: ${waConversations.length}`)
  console.log('   Instagram + Facebook conversations: 4')
  console.log('   Broadcasts, templates, automations, pipelines, properties, visits, tasks and calls: seeded')
  console.log('   No live WhatsApp, Meta, SMS or email credentials were created.')
}

main()
  .catch((error) => { console.error('❌ Demo seed failed:', error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
