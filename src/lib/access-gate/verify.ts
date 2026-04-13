import type { AccessVariant } from './codes'
import { getAccessCodes } from './codes'
import { hashAccessCode, timingSafeEqual } from './cookie'

export interface VerifyResult {
  ok: boolean
  variant?: AccessVariant
  token?: string
}

export async function verifyAccessCodeInput(input: string): Promise<VerifyResult> {
  const normalized = input.trim().toUpperCase()
  const entries = getAccessCodes()

  for (const entry of entries) {
    if (timingSafeEqual(normalized, entry.code)) {
      const token = await hashAccessCode(entry.code)
      return { ok: true, variant: entry.variant, token }
    }
  }

  return { ok: false }
}

export async function isValidAccessCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) {
    return false
  }

  const entries = getAccessCodes()
  for (const entry of entries) {
    const expected = await hashAccessCode(entry.code)
    if (timingSafeEqual(cookieValue, expected)) {
      return true
    }
  }
  return false
}
