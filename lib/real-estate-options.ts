/**
 * Shared real-estate option sets for lead / walk-in capture forms.
 *
 * Centralized here so the dashboard Leads page, the reception Walk-in form, and
 * the public QR walk-in form all present the same property-domain choices
 * (configuration, budget band, purpose, possession timeline, funding) instead
 * of the legacy retail options.
 */

/** Property configuration / what the buyer is looking for. */
export const PROPERTY_CONFIG_OPTIONS = [
    'Studio',
    '1 Bedroom Apartment',
    '2 Bedroom Apartment',
    '3 Bedroom Apartment',
    '4+ Bedroom Apartment',
    'Penthouse',
    'Villa',
    'Townhouse',
    'Duplex',
    'Commercial Retail',
    'Office Space',
    'Warehouse / Industrial',
    'Land Plot',
    'Other',
] as const

/** Real-estate budget bands for Dubai. */
export const RE_BUDGET_RANGES = [
    'Under AED 500K',
    'AED 500K – 1M',
    'AED 1M – 2M',
    'AED 2M – 3M',
    'AED 3M – 5M',
    'AED 5M – 10M',
    'AED 10M – 20M',
    'AED 20M +',
] as const

/** Why the buyer is purchasing — drives nurture/financing messaging. */
export const PURPOSE_OPTIONS = ['End Use', 'Investment', 'Both'] as const

/** How soon the buyer wants possession. */
export const POSSESSION_OPTIONS = [
    'Ready to Move',
    'Within 6 months',
    '6 – 12 months',
    '1 – 2 years',
    '2 + years',
] as const

/** How the purchase will be funded. */
export const FUNDING_OPTIONS = ['Mortgage', 'Cash / Self-funded', 'Mortgage + Cash', 'Developer Payment Plan'] as const

/** Dubai workflows differ materially between off-plan, resale, and rentals. */
export const SALE_TYPE_OPTIONS = ['Off-Plan (Primary)', 'Secondary / Resale', 'Rental'] as const

export type PropertyConfig = (typeof PROPERTY_CONFIG_OPTIONS)[number]
export type ReBudgetRange = (typeof RE_BUDGET_RANGES)[number]
export type Purpose = (typeof PURPOSE_OPTIONS)[number]
export type Possession = (typeof POSSESSION_OPTIONS)[number]
export type Funding = (typeof FUNDING_OPTIONS)[number]
export type SaleType = (typeof SALE_TYPE_OPTIONS)[number]

/**
 * Fold the optional structured preference fields into a human-readable block
 * appended to the free-text notes, so the data is captured without a schema
 * migration and renders cleanly in the lead/walk-in detail view.
 */
export function composePreferenceNotes(input: {
    notes?: string
    purpose?: string
    possession?: string
    location?: string
    funding?: string
}): string {
    const lines: string[] = []
    if (input.location?.trim()) lines.push(`Preferred Location: ${input.location.trim()}`)
    if (input.purpose) lines.push(`Purpose: ${input.purpose}`)
    if (input.possession) lines.push(`Possession: ${input.possession}`)
    if (input.funding) lines.push(`Funding: ${input.funding}`)
    const base = input.notes?.trim() ? input.notes.trim() : ''
    return [base, ...lines].filter(Boolean).join('\n')
}
