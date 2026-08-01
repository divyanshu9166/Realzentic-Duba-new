import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const SITE_VISIT_OTP_TTL_MS = 10 * 60 * 1000
export const SITE_VISIT_OTP_RESEND_COOLDOWN_MS = 60 * 1000
export const SITE_VISIT_OTP_MAX_ATTEMPTS = 5

interface OtpState {
  issuedAt: number
  expiresAt: number
  attempts: number
  digest: string
}

export type OtpVerification =
  | { ok: true }
  | {
      ok: false
      reason: 'missing' | 'expired' | 'locked' | 'incorrect'
      nextState: string | null
      attemptsRemaining: number
    }

function digestOtp(visitId: number, otp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${visitId}:${otp}`).digest('hex')
}

function encodeState(state: OtpState): string {
  return `v1:${state.issuedAt}:${state.expiresAt}:${state.attempts}:${state.digest}`
}

function parseState(value: string | null | undefined): OtpState | null {
  if (!value) return null
  const [version, issuedAtRaw, expiresAtRaw, attemptsRaw, digest] = value.split(':')
  const issuedAt = Number(issuedAtRaw)
  const expiresAt = Number(expiresAtRaw)
  const attempts = Number(attemptsRaw)
  if (
    version !== 'v1' ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isInteger(attempts) ||
    attempts < 0 ||
    !/^[a-f0-9]{64}$/.test(digest ?? '')
  ) {
    return null
  }
  return { issuedAt, expiresAt, attempts, digest }
}

export function generateSecureOtp(length = 6): string {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error('OTP length must be an integer between 4 and 8')
  }
  let otp = ''
  for (let index = 0; index < length; index += 1) otp += String(randomInt(0, 10))
  return otp
}

export function issueOtpState(input: {
  visitId: number
  otp: string
  secret: string
  nowMs?: number
}): string {
  const nowMs = input.nowMs ?? Date.now()
  return encodeState({
    issuedAt: nowMs,
    expiresAt: nowMs + SITE_VISIT_OTP_TTL_MS,
    attempts: 0,
    digest: digestOtp(input.visitId, input.otp, input.secret),
  })
}

export function otpResendDelaySeconds(state: string | null | undefined, nowMs = Date.now()): number {
  const parsed = parseState(state)
  if (!parsed) return 0
  const availableAt = parsed.issuedAt + SITE_VISIT_OTP_RESEND_COOLDOWN_MS
  return Math.max(0, Math.ceil((availableAt - nowMs) / 1000))
}

export function verifyOtpState(input: {
  visitId: number
  enteredOtp: string
  state: string | null | undefined
  secret: string
  nowMs?: number
}): OtpVerification {
  const parsed = parseState(input.state)
  if (!parsed) {
    return { ok: false, reason: 'missing', nextState: null, attemptsRemaining: 0 }
  }

  const nowMs = input.nowMs ?? Date.now()
  if (nowMs > parsed.expiresAt) {
    return { ok: false, reason: 'expired', nextState: null, attemptsRemaining: 0 }
  }
  if (parsed.attempts >= SITE_VISIT_OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'locked', nextState: null, attemptsRemaining: 0 }
  }

  const expected = Buffer.from(parsed.digest, 'hex')
  const actual = Buffer.from(digestOtp(input.visitId, input.enteredOtp, input.secret), 'hex')
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return { ok: true }

  const attempts = parsed.attempts + 1
  const attemptsRemaining = Math.max(0, SITE_VISIT_OTP_MAX_ATTEMPTS - attempts)
  return {
    ok: false,
    reason: attempts >= SITE_VISIT_OTP_MAX_ATTEMPTS ? 'locked' : 'incorrect',
    nextState: attempts >= SITE_VISIT_OTP_MAX_ATTEMPTS ? null : encodeState({ ...parsed, attempts }),
    attemptsRemaining,
  }
}
