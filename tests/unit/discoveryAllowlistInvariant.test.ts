import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_POLYMARKET_SLUGS,
  FIFA_EVENT_SLUG,
} from '@/lib/polymarket/constants'

/**
 * Drift detector: the inline allowlist in `useEventPriceHistory.ts` (a
 * `'use client'`-callable hook) MUST stay byte-identical with the server-side
 * `DISCOVERED_POLYMARKET_SLUGS` + `FIFA_EVENT_SLUG`. The inline copy exists
 * because importing from `@/lib/polymarket/constants` would drag the
 * server-only chain into the client bundle and break the Turbopack build.
 *
 * Re-parsing the hook source at test time keeps both lists locked in step.
 * If a future PR adds a slug to one and not the other, this test fails
 * before merge.
 */
const HOOK_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory.ts',
)

function extractInlineSlugs(source: string): string[] {
  const match = source.match(/DISCOVERED_POLYMARKET_SLUGS_INLINE\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!match) {
    throw new Error('Could not find DISCOVERED_POLYMARKET_SLUGS_INLINE array in useEventPriceHistory.ts')
  }
  const body = match[1]
  return Array.from(body.matchAll(/'([^']+)'/g)).map(m => m[1])
}

function extractInlineFifaSlug(source: string): string {
  const match = source.match(/FIFA_EVENT_SLUG_INLINE\s*=\s*'([^']+)'\s*as const/)
  if (!match) {
    throw new Error('Could not find FIFA_EVENT_SLUG_INLINE in useEventPriceHistory.ts')
  }
  return match[1]
}

describe('client-inline allowlist matches server-side allowlist', () => {
  const source = readFileSync(HOOK_PATH, 'utf8')

  it('fIFA_EVENT_SLUG_INLINE equals server FIFA_EVENT_SLUG byte-for-byte', () => {
    expect(extractInlineFifaSlug(source)).toBe(FIFA_EVENT_SLUG)
  })

  it('dISCOVERED_POLYMARKET_SLUGS_INLINE matches server DISCOVERED_POLYMARKET_SLUGS', () => {
    const inline = extractInlineSlugs(source)
    expect(inline).toEqual([...DISCOVERED_POLYMARKET_SLUGS])
  })

  it('inline list contains exactly 5 slugs (day-1 allowlist size)', () => {
    expect(extractInlineSlugs(source)).toHaveLength(5)
  })

  it('inline list and server list have identical set semantics (no order-dependent skew)', () => {
    const inlineSet = new Set(extractInlineSlugs(source))
    const serverSet = new Set(DISCOVERED_POLYMARKET_SLUGS)
    expect(inlineSet).toEqual(serverSet)
  })
})
