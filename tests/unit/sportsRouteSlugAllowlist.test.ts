import { describe, expect, it } from 'vitest'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'
import { KNOWN_SPORT_ROUTE_SLUGS } from '@/lib/polymarket/sports-route-allowlist'

/**
 * Fix A5 — drift-lock for the `/sports/[sport]/games` route slug allowlist.
 *
 * Locks three invariants:
 *   1. SHAPE — the allowlist is a `ReadonlySet<string>` for O(1) membership.
 *   2. REGISTRY COVERAGE — every league's `slug` and `sportRouteSlug` from
 *      `DISCOVERED_GAMES_LEAGUES` is in the allowlist. This is the single
 *      source of truth for discovery dispatch; if a new league lands and the
 *      allowlist isn't regenerated, this test fails fast.
 *   3. FAST-404 BEHAVIOR — slugs that are NOT real route targets (i.e. not
 *      in the Kuest `sports_menu_items` snapshot and not in the discovery
 *      registry) MUST be rejected so they short-circuit to `notFound()`
 *      before the `'use cache'` fetcher ever runs.
 */
describe('KNOWN_SPORT_ROUTE_SLUGS — A5 fast-404 allowlist', () => {
  it('is a Set (constant-time membership lookup)', () => {
    expect(KNOWN_SPORT_ROUTE_SLUGS).toBeInstanceOf(Set)
  })

  it('contains every discovery registry `slug` value', () => {
    for (const league of DISCOVERED_GAMES_LEAGUES) {
      expect(KNOWN_SPORT_ROUTE_SLUGS.has(league.slug)).toBe(true)
    }
  })

  it('contains every discovery registry `sportRouteSlug` value', () => {
    for (const league of DISCOVERED_GAMES_LEAGUES) {
      expect(KNOWN_SPORT_ROUTE_SLUGS.has(league.sportRouteSlug)).toBe(true)
    }
  })

  it('contains the snapshot of Kuest canonical sport menu_slugs', () => {
    // Spot-check anchor slugs across categories that MUST stay listable.
    // If a Kuest schema change removes one of these, we want a loud failure.
    const requiredKuestSlugs = [
      'mlb', 'nba', 'nhl', 'nfl',
      'baseball', 'basketball', 'hockey',
      'epl', 'laliga', 'mls', 'ucl', 'ucol',
      'cbb', 'cfb', 'ufc',
      'fifa-world-cup',
    ] as const
    for (const slug of requiredKuestSlugs) {
      expect(KNOWN_SPORT_ROUTE_SLUGS.has(slug)).toBe(true)
    }
  })

  it('contains the snapshot of Kuest `url_aliases` values', () => {
    // Aliases flattened from `sports_menu_items.url_aliases` jsonb arrays.
    // These resolve to canonical slugs inside the fetcher; must be allowed
    // through the A5 short-circuit.
    const requiredAliases = ['brazil', 'cs2', 'lol', 'ncaab', 'legends-cricket-league']
    for (const alias of requiredAliases) {
      expect(KNOWN_SPORT_ROUTE_SLUGS.has(alias)).toBe(true)
    }
  })

  it('rejects slugs that are NOT real Kuest routes (fast-404 path)', () => {
    // These are the kind of strings bots construct that don't correspond to
    // ANY row in sports_menu_items and aren't in the discovery registry.
    // They must miss the allowlist so `notFound()` fires before the
    // `'use cache'` fetcher cold-fills.
    const unknownSlugs = [
      'foobar',
      'not-a-sport',
      'wp-admin',
      '../etc/passwd',
      'index.php',
      '', // empty string
      'sport', // generic placeholder
      'random-1234',
    ]
    for (const slug of unknownSlugs) {
      expect(KNOWN_SPORT_ROUTE_SLUGS.has(slug)).toBe(false)
    }
  })
})
