/** Pure Dubai rental-renewal compliance helpers. */

export interface RentIncreaseCompliance {
  currentRent: number
  indexRent: number | null
  maxIncreasePercent: number
  maxPermittedRent: number
  proposedIncreasePercent: number
  compliant: boolean
  warning: string | null
}

/**
 * DLD's published rental-index bands cap renewal increases at 0%, 5%, 10%,
 * 15% or 20% depending on the gap between the current rent and the index.
 */
export function maxIncreasePercentForIndex(currentRent: number, indexRent: number | null | undefined): number {
  const current = Math.max(0, Math.round(currentRent))
  if (current <= 0 || indexRent == null || !Number.isFinite(indexRent) || indexRent <= 0) return 20
  const gap = ((indexRent - current) / current) * 100
  if (gap <= 10) return 0
  if (gap <= 20) return 5
  if (gap <= 30) return 10
  if (gap <= 40) return 15
  return 20
}

export function assessRentIncrease(currentRent: number, proposedRent: number, indexRent?: number | null): RentIncreaseCompliance {
  const current = Math.max(0, Math.round(currentRent))
  const proposed = Math.max(0, Math.round(proposedRent))
  const index = indexRent == null ? null : Math.max(0, Math.round(indexRent))
  const maxIncreasePercent = maxIncreasePercentForIndex(current, index)
  const maxPermittedRent = Math.floor(current * (1 + maxIncreasePercent / 100))
  const proposedIncreasePercent = current > 0 ? ((proposed - current) / current) * 100 : 0
  const compliant = proposed <= maxPermittedRent
  const warning = index == null
    ? 'RERA index rent was not recorded; the conservative 20% maximum was applied. Confirm the DLD Rental Increase Calculator before issuing the renewal offer.'
    : compliant
      ? null
      : `The proposed rent exceeds the RERA-index allowance of AED ${maxPermittedRent.toLocaleString()}.`
  return { currentRent: current, indexRent: index, maxIncreasePercent, maxPermittedRent, proposedIncreasePercent, compliant, warning }
}
