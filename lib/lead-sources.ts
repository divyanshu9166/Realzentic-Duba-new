export const WHATSAPP_INQUIRY_SOURCE = 'WhatsApp Inquiry'

export const LEAD_SOURCE_OPTIONS = [
  'WhatsApp',
  WHATSAPP_INQUIRY_SOURCE,
  'Instagram',
  'Facebook',
  'Website',
  'Walk-in',
  'Site Visit',
  'Property Viewing',
  'Referral',
  'Channel Partner',
  'Bayut',
  'Property Finder',
  'Dubizzle',
] as const

export type LeadSource = (typeof LEAD_SOURCE_OPTIONS)[number]
