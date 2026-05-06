import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DISCOVERED_POLYMARKET_SLUGS, FIFA_EVENT_SLUG } from '@/lib/polymarket/constants'
import {
  DISCOVERED_GAMES_LEAGUES,
  isDiscoveryGameSlug,
} from '@/lib/polymarket/games-leagues'

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

/**
 * Phase B v2 §E (URL routing strategy) — drift-lock the redirect pattern
 * against Phase A v2 regression. The redirect in `event/[slug]/page.tsx`
 * gates on `isDiscoveryGameSlug(slug)`. Phase A v2 futures slugs MUST NOT
 * match — otherwise the redirect would intercept futures pages and break
 * the still-live Phase A v2 dispatch.
 *
 * Iterating each Phase A v2 slug explicitly (rather than relying on the
 * `DISCOVERED_POLYMARKET_SLUGS` constant alone) means a regression
 * surfaces with a clear failure message naming the offending slug.
 */
describe('isDiscoveryGameSlug — Phase A v2 futures non-match invariant', () => {
  // The 6 slugs that MUST continue rendering at /event/[slug] unchanged:
  // 5 from DISCOVERED_POLYMARKET_SLUGS (the Phase A v2 sidecar allowlist) +
  // FIFA_EVENT_SLUG (the original Polymarket overlay slug).
  const PHASE_A_V2_FUTURES_SLUGS = [
    '2026-fifa-world-cup-winner-595',
    '2026-nba-champion',
    'mlb-world-series-champion-2026',
    '2026-nhl-stanley-cup-champion',
    'big-game-champion-2027',
    'uefa-champions-league-winner',
  ] as const

  it('all 6 Phase A v2 futures slugs are NOT matched by the per-game pattern', () => {
    PHASE_A_V2_FUTURES_SLUGS.forEach((slug) => {
      // Asserted per-slug so the failure message names the offending slug
      // (e.g. "expected isDiscoveryGameSlug('mlb-world-series-champion-2026')
      // to be false, was true").
      expect(isDiscoveryGameSlug(slug), `slug ${slug} matched the per-game pattern but is a Phase A v2 futures slug`).toBe(false)
    })
  })

  it('the Phase A v2 source-of-truth list is identical to the locked drift-lock list', () => {
    // Defense in depth: if `DISCOVERED_POLYMARKET_SLUGS` or `FIFA_EVENT_SLUG`
    // ever changes upstream, this test detects the divergence so the locked
    // PHASE_A_V2_FUTURES_SLUGS list above is updated in the same PR. Without
    // this, a slug added to `DISCOVERED_POLYMARKET_SLUGS` would silently
    // bypass the Phase A v2 invariant test above.
    const expectedSet = new Set([FIFA_EVENT_SLUG, ...DISCOVERED_POLYMARKET_SLUGS])
    const lockedSet = new Set(PHASE_A_V2_FUTURES_SLUGS)
    expect(lockedSet).toEqual(expectedSet)
  })

  it('a sample of Phase B per-game slugs DO match the per-game pattern', () => {
    // Positive control — drift-locks against a future regression that
    // accidentally tightens the regex and breaks legitimate per-game slugs.
    const PER_GAME_SLUGS = [
      'mlb-tor-tb-2026-05-06',
      'mlb-mil-stl-2026-05-05',
      'mlb-nym-col-2026-05-05',
    ]
    PER_GAME_SLUGS.forEach((slug) => {
      expect(isDiscoveryGameSlug(slug), `slug ${slug} did NOT match the per-game pattern but should`).toBe(true)
    })
  })

  it('every Phase A v2 futures slug fails EVERY league pattern individually', () => {
    // Future-proofing: when more leagues are registered, this asserts NO
    // league's pattern accidentally widens to match a Phase A v2 futures slug.
    PHASE_A_V2_FUTURES_SLUGS.forEach((slug) => {
      DISCOVERED_GAMES_LEAGUES.forEach((league) => {
        expect(
          league.slugPattern.test(slug),
          `slug ${slug} matched league pattern ${league.slugPattern.source} (${league.slug})`,
        ).toBe(false)
      })
    })
  })
})
