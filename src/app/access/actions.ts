'use server'

import { cookies } from 'next/headers'
import { ACCESS_COOKIE_MAX_AGE, ACCESS_COOKIE_NAME } from '@/lib/access-gate/cookie'
import { verifyAccessCodeInput } from '@/lib/access-gate/verify'

export interface AccessFormState {
  ok?: boolean
  next?: string
  error?: string
}

export async function submitAccessCode(
  _prev: AccessFormState,
  formData: FormData,
): Promise<AccessFormState> {
  const input = String(formData.get('code') ?? '')
  const nextRaw = String(formData.get('next') ?? '/')
  const next = safeNextPath(nextRaw)

  if (input.trim().length === 0) {
    return { error: 'Enter your access code.' }
  }

  const result = await verifyAccessCodeInput(input)
  if (!result.ok || !result.token) {
    return { error: 'Invalid access code.' }
  }

  const store = await cookies()
  store.set({
    name: ACCESS_COOKIE_NAME,
    value: result.token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE,
  })

  return { ok: true, next }
}

function safeNextPath(value: string): string {
  if (!value || typeof value !== 'string') {
    return '/'
  }
  if (!value.startsWith('/')) {
    return '/'
  }
  if (value.startsWith('//')) {
    return '/'
  }
  if (value.startsWith('/access')) {
    return '/'
  }
  return value
}
