import { describe, expect, it } from 'vitest'
import {
    GOLDEN_VISA_PROPERTY_THRESHOLD_AED,
    isGoldenVisaEligible,
} from './golden-visa'

describe('Golden Visa property indicator', () => {
    it('is eligible at or above the AED 2M threshold', () => {
        expect(isGoldenVisaEligible(GOLDEN_VISA_PROPERTY_THRESHOLD_AED)).toBe(true)
        expect(isGoldenVisaEligible(GOLDEN_VISA_PROPERTY_THRESHOLD_AED + 1)).toBe(true)
    })

    it('rejects lower, missing, and invalid property values', () => {
        expect(isGoldenVisaEligible(GOLDEN_VISA_PROPERTY_THRESHOLD_AED - 0.01)).toBe(false)
        expect(isGoldenVisaEligible(null)).toBe(false)
        expect(isGoldenVisaEligible(Number.NaN)).toBe(false)
    })
})
