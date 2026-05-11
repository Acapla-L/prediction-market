import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Drift-lock for Fix A1 (connection-pool hardening 2026-05-11).
 *
 * `fetchLeagueEvents` (home-v2 league section data fetcher) MUST use the
 * batched `TeamsCacheRepository.listByLeague` + in-memory `Map<abbreviation,
 * TeamCacheRow>` pattern — identical in shape to the sibling list-route
 * helper `loadDiscoveredGameSportsCardsByLeague` in
 * `src/lib/polymarket/synthesize-sports-card.ts`.
 *
 * It MUST NOT use the per-row `TeamsCacheRepository.getByAbbreviation` fan-out
 * (the prior pattern: `Promise.all(rows.map(r => Promise.all([
 *   getByAbbreviation(league, home), getByAbbreviation(league, away)
 * ])))`) which was the dominant amplifier in the 2026-05-11 EMAXCONN cascade:
 *
 *   pre-A1 per league section:  1 + 2*LEAGUE_GRID_SIZE = 9 DB queries
 *                                peak 8 simultaneous Supavisor :6543 checkouts
 *   post-A1 per league section: 2 DB queries (rows + teams in one Promise.all)
 *                                peak 2 simultaneous checkouts
 *
 * Combined with A2 (sequential `for...of` over `HOME_V2_CATEGORIES`), the
 * home-v2 cold-render peak collapses to ~2 simultaneous pooler checkouts
 * regardless of league count — well under the Supavisor 200-client cap even
 * at high concurrent-cold-render rates.
 *
 * A pure-runtime test would require running `'use cache'` under the Next.js
 * 16 Cache Components pipeline against a mocked Drizzle module graph — too
 * brittle. Static source check + the sibling `synthesizeSportsCard.test.ts`
 * runtime coverage of the same projection logic = belt and suspenders.
 *
 * Pattern mirror: `sportsCacheNotFoundBoundary.test.ts` (the Phase B v2
 * cache-boundary drift-lock).
 */

const FETCH_LEAGUE_EVENTS_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/home-v2/_data/fetchLeagueEvents.ts',
)

const SYNTHESIZE_SPORTS_CARD_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/lib/polymarket/synthesize-sports-card.ts',
)

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('fetchLeagueEvents — A1 batched-pattern drift-lock', () => {
  const source = readSource(FETCH_LEAGUE_EVENTS_PATH)

  it('imports TeamsCacheRepository (it owns the team-lookup path)', () => {
    expect(source).toMatch(/import\s*\{[^}]*TeamsCacheRepository[^}]*\}\s*from\s*['"]@\/lib\/db\/queries\/teams-cache['"]/)
  })

  it('imports the TeamCacheRow type (needed for the in-memory Map)', () => {
    expect(source).toMatch(/import\s+type\s*\{[^}]*TeamCacheRow[^}]*\}\s*from\s*['"]@\/lib\/db\/queries\/teams-cache['"]/)
  })

  it('calls TeamsCacheRepository.listByLeague — the batched lookup', () => {
    expect(source).toMatch(/TeamsCacheRepository\.listByLeague\s*\(/)
  })

  it('builds an in-memory Map<string, TeamCacheRow> for O(1) abbreviation lookups', () => {
    // The exact whitespace inside the angle brackets can drift; the type
    // parameter is what we care about.
    expect(source).toMatch(/new\s+Map\s*<\s*string\s*,\s*TeamCacheRow\s*>/)
  })

  it('does NOT call TeamsCacheRepository.getByAbbreviation anywhere (the per-row N+1 was the EMAXCONN amplifier)', () => {
    expect(source).not.toMatch(/TeamsCacheRepository\.getByAbbreviation/)
  })

  it('does NOT nest a Promise.all of team lookups inside rows.map (the pre-A1 shape that produced 2N simultaneous pooler checkouts)', () => {
    // Reject the pre-A1 shape: `rows.map(... Promise.all([..., ...]) ...)`
    // where the inner Promise.all references team-lookup calls. We use a
    // permissive cross-line regex anchored on `rows.map` + `Promise.all`
    // appearing together.
    expect(source).not.toMatch(/rows\.map\s*\([\s\S]{0,400}?Promise\.all\s*\(\s*\[\s*TeamsCacheRepository/)
  })

  it('issues exactly ONE `await Promise.all(` call (rows + teams), not a per-row fan-out', () => {
    // Count only `await Promise.all(` call sites (so JSDoc references to the
    // pre-A1 shape — which lack a preceding `await` — are excluded). The
    // batched pattern uses exactly one such call (the rows+teams batch). The
    // pre-A1 shape used two (the outer rows-map + the inner per-row team-
    // lookup pair).
    const matches = source.match(/await\s+Promise\.all\s*\(/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('fetchLeagueEvents — pattern parity with loadDiscoveredGameSportsCardsByLeague', () => {
  const fetchLeagueEventsSource = readSource(FETCH_LEAGUE_EVENTS_PATH)
  const synthesizeSource = readSource(SYNTHESIZE_SPORTS_CARD_PATH)

  it('the sibling list-route helper uses the same batched pattern (the reference implementation)', () => {
    // Sanity: `loadDiscoveredGameSportsCardsByLeague` is the reference batched
    // helper the home-v2 fetcher is now aligned with. If THIS regresses to a
    // per-row N+1, the drift-lock for the home-v2 fetcher above becomes
    // misleading — so we lock the reference too.
    expect(synthesizeSource).toMatch(/TeamsCacheRepository\.listByLeague\s*\(/)
    expect(synthesizeSource).toMatch(/new\s+Map\s*<\s*string\s*,\s*TeamCacheRow\s*>/)
  })

  it('home-v2 fetcher imports the same listByLeague method the sibling uses', () => {
    // Both call `TeamsCacheRepository.listByLeague(<leagueSlug>)`. We don't
    // require byte-identical call sites (the variable names differ), just
    // that both sources reference the method.
    expect(fetchLeagueEventsSource).toMatch(/TeamsCacheRepository\.listByLeague/)
    expect(synthesizeSource).toMatch(/TeamsCacheRepository\.listByLeague/)
  })
})
