/**
 * Dubai Golden Visa property-investment threshold used by the CRM's listing
 * and buyer-facing messaging. The badge is an eligibility indicator only;
 * final immigration eligibility must be confirmed by the buyer's adviser and
 * the relevant UAE authority.
 */
export const GOLDEN_VISA_PROPERTY_THRESHOLD_AED = 2_000_000

/** True when the recorded property value meets the current CRM threshold. */
export function isGoldenVisaEligible(propertyValue: number | null | undefined): boolean {
    return typeof propertyValue === 'number'
        && Number.isFinite(propertyValue)
        && propertyValue >= GOLDEN_VISA_PROPERTY_THRESHOLD_AED
}
