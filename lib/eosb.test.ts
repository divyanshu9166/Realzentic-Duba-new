import { describe, expect, it } from 'vitest'
import { calculateEosb } from './eosb'

describe('calculateEosb', () => {
  it('uses 21 days of basic salary for each of the first five completed years', () => {
    expect(calculateEosb(10_000, 3)).toBe(21_000)
  })

  it('uses 30 days of basic salary after the fifth completed year', () => {
    expect(calculateEosb(10_000, 6)).toBe(45_000)
  })

  it('caps the estimate at two years of basic salary', () => {
    expect(calculateEosb(10_000, 50)).toBe(240_000)
  })

  it('does not produce a benefit for invalid negative inputs', () => {
    expect(calculateEosb(-10_000, 3)).toBe(0)
    expect(calculateEosb(10_000, -3)).toBe(0)
  })
})
