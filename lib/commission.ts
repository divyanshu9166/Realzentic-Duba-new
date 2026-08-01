/**
 * Channel-partner commission computation.
 *
 * `computeCommission` is a PURE function (no DB/IO) that resolves the payable
 * commission for a booking given a partner's commission configuration. It
 * supports the three `CommissionType` variants defined in the Prisma schema:
 *
 *   - `Percentage` — `rate`% of the agreement value.
 *   - `Fixed`      — a flat amount, independent of the agreement value.
 *   - `Slab`       — selects the slab whose value range contains the
 *                    agreement value, then applies that slab's rate.
 *
 * Every result is rounded to two decimal places via {@link roundMoney} so the
 * output shares the platform-wide money/rounding semantics.
 *
 * Requirements: 6.4 (percentage), 6.5 (slab), 6.8 (fixed).
 *
 * Slab rates use the same percentage convention as percentage commissions:
 * a configured rate of 2 means 2% of the agreement value.
 */

import type { CommissionType } from '@prisma/client'
import { roundMoney } from './money'

/**
 * A single commission slab, matching the `commissionSlabs` JSON shape declared
 * on `ChannelPartner` in `prisma/schema.prisma`:
 * `[{ minValue, maxValue, rate }]`.
 *
 * A slab matches an agreement value when `minValue <= agreementValue <= maxValue`.
 */
export interface CommissionSlab {
    /** Inclusive lower bound of the agreement-value range this slab covers. */
    minValue: number
    /** Inclusive upper bound of the agreement-value range this slab covers. */
    maxValue: number
    /** Percentage applied to the agreement value when this slab is selected. */
    rate: number
}

/**
 * Compute the commission payable for a booking.
 *
 * @param type           The partner's commission type (`Percentage`/`Fixed`/`Slab`).
 * @param rate           Percentage rate (e.g. `2.5` for 2.5%) used when `type` is `Percentage`.
 * @param fixedAmount    Flat commission amount used when `type` is `Fixed`.
 * @param slabs          Slab configuration used when `type` is `Slab`; `null`/`undefined` is treated as empty.
 * @param agreementValue The booking's agreement value.
 * @returns The commission, rounded to 2 decimal places. Returns `0` when a
 *          `Slab` configuration has no slab matching the agreement value.
 */
export function computeCommission(
    type: CommissionType,
    rate: number,
    fixedAmount: number,
    slabs: CommissionSlab[] | null | undefined,
    agreementValue: number
): number {
    switch (type) {
        case 'Percentage':
            // round(rate / 100 × agreementValue, 2)  — design Property 25.
            return roundMoney((rate / 100) * agreementValue)

        case 'Fixed':
            // Value-independent flat amount — design Property 27 / Req 6.8.
            return roundMoney(fixedAmount)

        case 'Slab': {
            // Select the slab whose [minValue, maxValue] range contains the
            // agreement value; the first match wins for overlapping slabs.
            const matching = (slabs ?? []).find(
                (slab) =>
                    agreementValue >= slab.minValue &&
                    agreementValue <= slab.maxValue
            )
            if (!matching) return 0
            // Apply the configured slab rate as a percentage of the agreement value.
            return roundMoney((matching.rate / 100) * agreementValue)
        }

        default: {
            // Exhaustiveness guard: if a new CommissionType is added, this
            // surfaces a compile-time error.
            const _exhaustive: never = type
            throw new Error(`Unsupported commission type: ${String(_exhaustive)}`)
        }
    }
}
