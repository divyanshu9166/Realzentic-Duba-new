import { describe, expect, it } from 'vitest'
import {
  issueOtpState,
  otpResendDelaySeconds,
  SITE_VISIT_OTP_MAX_ATTEMPTS,
  SITE_VISIT_OTP_TTL_MS,
  verifyOtpState,
} from './site-visit-otp'

const secret = 'test-secret'

describe('site visit OTP state', () => {
  it('verifies the dispatched code without storing it in plaintext', () => {
    const state = issueOtpState({ visitId: 7, otp: '123456', secret, nowMs: 1_000 })
    expect(state).not.toBe('123456')
    expect(verifyOtpState({ visitId: 7, enteredOtp: '123456', state, secret, nowMs: 2_000 })).toEqual({ ok: true })
  })

  it('expires after the configured TTL', () => {
    const state = issueOtpState({ visitId: 7, otp: '123456', secret, nowMs: 1_000 })
    const result = verifyOtpState({
      visitId: 7,
      enteredOtp: '123456',
      state,
      secret,
      nowMs: 1_000 + SITE_VISIT_OTP_TTL_MS + 1,
    })
    expect(result).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('locks after the maximum incorrect attempts', () => {
    let state: string | null = issueOtpState({ visitId: 7, otp: '123456', secret, nowMs: 1_000 })
    let reason = ''
    for (let attempt = 0; attempt < SITE_VISIT_OTP_MAX_ATTEMPTS; attempt += 1) {
      const result = verifyOtpState({ visitId: 7, enteredOtp: '000000', state, secret, nowMs: 2_000 })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        state = result.nextState
        reason = result.reason
      }
    }
    expect(reason).toBe('locked')
    expect(state).toBeNull()
  })

  it('enforces a resend cooldown', () => {
    const state = issueOtpState({ visitId: 7, otp: '123456', secret, nowMs: 1_000 })
    expect(otpResendDelaySeconds(state, 1_000)).toBe(60)
    expect(otpResendDelaySeconds(state, 61_000)).toBe(0)
  })
})
