import { describe, expect, it } from 'vitest'
import { assessRentIncrease, maxIncreasePercentForIndex } from './rental-compliance'

describe('Dubai rental-index compliance', () => {
  it('applies the published increase bands', () => {
    expect(maxIncreasePercentForIndex(100_000, 110_000)).toBe(0)
    expect(maxIncreasePercentForIndex(100_000, 125_000)).toBe(10)
    expect(maxIncreasePercentForIndex(100_000, 150_000)).toBe(20)
  })

  it('rejects a renewal above the conservative cap', () => {
    const result = assessRentIncrease(100_000, 120_001)
    expect(result.compliant).toBe(false)
    expect(result.maxPermittedRent).toBe(120_000)
  })
})
