export const ACCESS_COOKIE_NAME = 'wp_access'
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

const STATIC_SALT = 'wirepredictions:access-gate:v1'

export async function hashAccessCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase()
  const input = `${STATIC_SALT}:${normalized}`
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}
