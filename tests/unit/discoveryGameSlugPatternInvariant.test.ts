import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'

/**
 * Drift detector: the inline `DISCOVERED_GAME_SLUG_PATTERNS_INLINE` array in
 * `useEventPriceHistory.ts` MUST stay byte-identical with the league slug
 * patterns in `DISCOVERED_GAMES_LEAGUES` (server side). The inline copy
 * exists because importing from `@/lib/polymarket/games-leagues` would drag
 * the server-only chain into the client bundle and break the Turbopack build.
 *
 * Phase B counterpart of `discoveryAllowlistInvariant.test.ts` (which locks
 * the futures slug literals).
 */
const HOOK_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory.ts',
)

function extractInlinePatterns(source: string): string[] {
  // Capture the body of `DISCOVERED_GAME_SLUG_PATTERNS_INLINE = [...]` then
  // pull out each `/.../` literal. The patterns may span multiple lines.
  const match = source.match(
    /DISCOVERED_GAME_SLUG_PATTERNS_INLINE[^=]*=\s*\[([\s\S]*?)\]\s*as const/,
  )
  if (!match) {
    throw new Error('Could not find DISCOVERED_GAME_SLUG_PATTERNS_INLINE in useEventPriceHistory.ts')
  }
  const body = match[1]
  // Match each `/.../...` regex literal (no flags expected, but allow optional flags).
  return Array.from(body.matchAll(/\/(.+?)\/[gimsuy]*\s*,?/g)).map(m => m[1])
}

describe('client-inline per-game slug patterns match server-side league registry', () => {
  const source = readFileSync(HOOK_PATH, 'utf8')

  it('inline pattern source strings match server slug-pattern source strings', () => {
    const inline = extractInlinePatterns(source)
    const server = DISCOVERED_GAMES_LEAGUES.map(league => league.slugPattern.source)
    expect(inline).toEqual(server)
  })

  it('inline pattern count matches server league count', () => {
    const inline = extractInlinePatterns(source)
    expect(inline).toHaveLength(DISCOVERED_GAMES_LEAGUES.length)
  })

  it('mVP single-league lock — exactly 1 inline pattern (MLB only)', () => {
    const inline = extractInlinePatterns(source)
    expect(inline).toHaveLength(1)
    expect(inline[0]).toBe('^mlb-[a-z0-9]+-[a-z0-9]+-\\d{4}-\\d{2}-\\d{2}$')
  })
})
