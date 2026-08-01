/** Shared money formatting for the Dubai (UAE) product. */
export const CURRENCY = 'AED' as const
export const LOCALE = 'en-AE' as const

function safeValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Format whole-dirham values for property, deal, and financial displays. */
export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safeValue(value))
}

/** Format large AED values with standard K/M/B notation. */
export function formatCompactCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(safeValue(value))
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE).format(safeValue(value))
}
