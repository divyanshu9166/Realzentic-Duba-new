import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

async function upsertProject(input: {
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
}) {
  const existing = await prisma.project.findFirst({ where: { name: input.name } })
  const data = {
    ...input,
    photoUrls: [],
    brochureUrl: null,
  }
  return existing
    ? prisma.project.update({ where: { id: existing.id }, data })
    : prisma.project.create({ data })
}

async function main() {
  console.log('🌱 Seeding Realzentic Dubai sample data...')

  await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeName: 'Realzentic Dubai',
      phone: '+971 50 123 4567',
      whatsappNumber: '971501234567',
      email: 'hello@realzentic.com',
      address: 'Business Bay, Dubai, United Arab Emirates',
      vatTrn: '100000000000003',
      vatRate: 5,
      currency: 'AED',
      bankName: 'Demo UAE Bank',
      bankAccountName: 'Realzentic Dubai',
      bankIban: 'AE070331234567890123456',
      storeLat: 25.1869,
      storeLng: 55.2648,
      geofenceRadius: 150,
      shiftStartTime: '09:00',
      shiftEndTime: '18:00',
    },
  })

  const staffRecords = await Promise.all([
    prisma.staff.upsert({
      where: { email: 'sara.alnuaimi@realzentic.com' },
      update: {},
      create: {
        name: 'Sara Al Nuaimi', role: 'Sales Director', designation: 'Sales Director',
        phone: '971501234501', email: 'sara.alnuaimi@realzentic.com', status: 'Active',
        joinDate: new Date('2025-01-15'), avatar: 'SA', basicSalary: 18000,
        emiratesId: '784-1985-1234567-1', laborCardNo: 'LC-10001', mohreNo: 'MOHRE-10001',
        iban: 'AE070331234567890123451', bankName: 'Demo UAE Bank', visaStatus: 'Valid',
        eosbAccrued: 10500, wpsRegistered: true,
        stats: { leadsAssigned: 38, conversions: 14, avgResponseTime: '8 min' },
        target: { monthly: 12000000, achieved: 8300000 }, commission: { rate: 1.5, earned: 124500 },
      },
    }),
    prisma.staff.upsert({
      where: { email: 'omar.hassan@realzentic.com' },
      update: {},
      create: {
        name: 'Omar Hassan', role: 'Property Consultant', designation: 'Property Consultant',
        phone: '971501234502', email: 'omar.hassan@realzentic.com', status: 'Active',
        joinDate: new Date('2025-06-01'), avatar: 'OH', basicSalary: 10500,
        emiratesId: '784-1991-7654321-2', laborCardNo: 'LC-10002', mohreNo: 'MOHRE-10002',
        iban: 'AE070331234567890123452', bankName: 'Demo UAE Bank', visaStatus: 'Valid',
        eosbAccrued: 2800, wpsRegistered: true,
        stats: { leadsAssigned: 26, conversions: 8, avgResponseTime: '12 min' },
        target: { monthly: 6500000, achieved: 4200000 }, commission: { rate: 1.25, earned: 52500 },
      },
    }),
  ])

  const password = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!', 10)
  await prisma.user.upsert({
    where: { email: 'admin@realzentic.com' },
    update: {},
    create: { name: 'Realzentic Administrator', email: 'admin@realzentic.com', hashedPassword: password, role: 'ADMIN', staffId: staffRecords[0].id },
  })

  const contactSpecs = [
    { name: 'James Wilson', phone: '971501234601', email: 'james.wilson@example.com', emirate: 'Dubai', nationality: 'British', interest: '2 Bedroom Apartment in Dubai Marina', budget: '2.2M AED', source: 'Property Finder', assignedToId: staffRecords[0].id },
    { name: 'Fatima Al Mansoori', phone: '971501234602', email: 'fatima.almansoori@example.com', emirate: 'Dubai', nationality: 'Emirati', interest: 'Villa in Dubai Hills Estate', budget: '6M AED', source: 'Bayut', assignedToId: staffRecords[1].id },
    { name: 'Daniel Wong', phone: '971501234603', email: 'daniel.wong@example.com', emirate: 'Dubai', nationality: 'Singaporean', interest: 'Off-plan investment property', budget: '1.5M AED', source: 'Website', assignedToId: staffRecords[1].id },
  ]

  const contacts = []
  for (const spec of contactSpecs) {
    const contact = await prisma.contact.upsert({
      where: { phone: spec.phone },
      update: {},
      create: { name: spec.name, phone: spec.phone, email: spec.email, emirate: spec.emirate, source: spec.source, nationality: spec.nationality },
    })
    contacts.push(contact)
    const existingLead = await prisma.lead.findFirst({ where: { contactId: contact.id, interest: spec.interest } })
    if (!existingLead) {
      await prisma.lead.create({
        data: {
          contactId: contact.id, interest: spec.interest, budget: spec.budget, status: 'NEW', source: spec.source,
          nationality: spec.nationality, visaStatus: 'Valid', preferredLanguage: 'English', assignedToId: spec.assignedToId,
        },
      })
    }
  }

  const marinaProject = await upsertProject({
    name: 'Azure Marina Residences', location: 'Dubai Marina', city: 'Dubai', emirate: 'Dubai',
    type: 'Residential', status: 'UnderConstruction', builderName: 'Azure Developments', totalUnits: 4,
    description: 'Waterfront freehold residences with flexible developer payment plans.',
    amenities: ['Infinity pool', 'Fitness centre', 'Concierge', 'Marina promenade'],
    dldProjectRegNo: 'DLD-PRJ-2026-0001', escrowAccountNo: 'ESCROW-AZURE-001', trakheesiPermitNo: 'TRAKHEESI-2026-0001',
    saleType: 'Off-plan', isFreeholdZone: true, latitude: 25.0808, longitude: 55.1403,
  })
  const hillsProject = await upsertProject({
    name: 'Sapphire Hills Villas', location: 'Dubai Hills Estate', city: 'Dubai', emirate: 'Dubai',
    type: 'Residential', status: 'ReadyToMove', builderName: 'Sapphire Properties', totalUnits: 3,
    description: 'Ready villas in a landscaped freehold community near Dubai Hills Mall.',
    amenities: ['Private garden', 'Community park', 'Golf course access', 'Covered parking'],
    dldProjectRegNo: 'DLD-PRJ-2026-0002', escrowAccountNo: 'ESCROW-SAPPHIRE-002', trakheesiPermitNo: 'TRAKHEESI-2026-0002',
    saleType: 'Ready', isFreeholdZone: true, latitude: 25.1117, longitude: 55.2422,
  })

  const existingMarinaTower = await prisma.tower.findFirst({ where: { projectId: marinaProject.id, name: 'Marina Tower A' } })
  const marinaTower = existingMarinaTower
    ? await prisma.tower.update({ where: { id: existingMarinaTower.id }, data: { totalFloors: 28 } })
    : await prisma.tower.create({ data: { projectId: marinaProject.id, name: 'Marina Tower A', totalFloors: 28 } })
  const existingHillsTower = await prisma.tower.findFirst({ where: { projectId: hillsProject.id, name: 'Villa Collection' } })
  const hillsTower = existingHillsTower
    ? await prisma.tower.update({ where: { id: existingHillsTower.id }, data: { totalFloors: 2 } })
    : await prisma.tower.create({ data: { projectId: hillsProject.id, name: 'Villa Collection', totalFloors: 2 } })

  const unitSpecs = [
    { towerId: marinaTower.id, floorNumber: 12, unitNumber: 'A-1204', type: 'Apartment2' as const, netArea: 1040, builtUpArea: 1260, facing: 'NE' as const, basePricePerSqft: 1750, totalPrice: 2205000 },
    { towerId: marinaTower.id, floorNumber: 22, unitNumber: 'A-2201', type: 'Penthouse' as const, netArea: 2640, builtUpArea: 3090, facing: 'W' as const, basePricePerSqft: 2350, totalPrice: 7350000 },
    { towerId: hillsTower.id, floorNumber: 1, unitNumber: 'V-18', type: 'Villa' as const, netArea: 3560, builtUpArea: 4210, facing: 'E' as const, basePricePerSqft: 1560, totalPrice: 6567600 },
  ]
  const units = []
  for (const unit of unitSpecs) {
    units.push(await prisma.unit.upsert({
      where: { towerId_unitNumber: { towerId: unit.towerId, unitNumber: unit.unitNumber } },
      update: unit,
      create: { ...unit, status: 'Available', floorRisePremium: 0, viewPremium: 0, parkingCount: 1, parkingType: 'Covered' },
    }))
  }

  const paymentPlan = await prisma.paymentPlan.findFirst({ where: { projectId: marinaProject.id, name: '60/40 Developer Payment Plan' } })
  if (!paymentPlan) {
    await prisma.paymentPlan.create({
      data: {
        projectId: marinaProject.id, name: '60/40 Developer Payment Plan', isDefault: true,
        milestones: [
          { name: 'Booking', dueOffsetDays: 0, percentage: 10 },
          { name: 'During construction', dueOffsetDays: 180, percentage: 50 },
          { name: 'On handover', dueOffsetDays: 720, percentage: 40 },
        ],
      },
    })
  }

  await prisma.channelPartner.upsert({
    where: { brnNumber: 'BRN-123456' },
    update: {},
    create: {
      name: 'Nadia Rahman', company: 'Harbour Key Realty', brnNumber: 'BRN-123456', ornNumber: 'ORN-78901',
      phone: '971501234701', email: 'nadia@harbourkey.example.com', type: 'Company', status: 'Active',
      commissionRate: 2, commissionType: 'Percentage', tradeLicenseNo: 'TL-998877',
      bankDetails: { iban: 'AE070331234567890123470', bankName: 'Demo UAE Bank' },
    },
  })

  let enquiryStage = await prisma.dealStage.findFirst({ where: { name: 'New Enquiry' } })
  if (!enquiryStage) enquiryStage = await prisma.dealStage.create({ data: { name: 'New Enquiry', order: 1, color: '#3B82F6' } })
  const existingDeal = await prisma.deal.findFirst({ where: { contactId: contacts[0].id, unitId: units[0].id } })
  if (!existingDeal) {
    await prisma.deal.create({ data: { contactId: contacts[0].id, unitId: units[0].id, assignedAgentId: staffRecords[0].id, stageId: enquiryStage.id, value: units[0].totalPrice, source: 'Property Finder' } })
  }

  console.log('✅ Dubai sample data seeded successfully.')
  console.log('   Admin: admin@realzentic.com (set SEED_ADMIN_PASSWORD before production use)')
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
