export type AccessVariant = 'default' | 'gibraltar'

export interface AccessCodeEntry {
  code: string
  variant: AccessVariant
}

export function getAccessCodes(): AccessCodeEntry[] {
  const entries: AccessCodeEntry[] = []

  const defaultCode = process.env.SITE_ACCESS_CODE?.trim().toUpperCase()
  if (defaultCode) {
    entries.push({ code: defaultCode, variant: 'default' })
  }

  return entries
}

export function isAccessGateEnabled(): boolean {
  return getAccessCodes().length > 0
}
