/**
 * Phase B per-game discovery — league registry.
 *
 * MVP: MLB only. The Phase B execution plan §H locks single-league + single
 * market-type to keep the first ship narrow. Adding NBA, NHL, NFL, EPL is
 * one ship per league per the v2 plan.
 *
 * Each league entry pairs:
 *   - `slug`             — short identifier used in our slug pattern + URL
 *   - `seriesId`         — Polymarket Gamma `series_id` from `GET /sports`
 *   - `slugPattern`      — regex matching valid per-game slugs for the league
 *   - `mainTag`          — the `main_tag` value on the synthetic Event
 *
 * The slug pattern source MUST stay byte-identical with the inline mirror in
 * `useEventPriceHistory.ts`. The Phase B drift detector test asserts equality.
 *
 * Slug examples:
 *   - `mlb-tex-nyy-2026-05-05`         — Texas at Yankees, May 5, 2026
 *   - `mlb-cin-chc-2026-05-05`         — Cincinnati at Cubs, May 5, 2026
 *
 * Future leagues (NOT yet active):
 *   - NBA series_id 10345, slug pattern /^nba-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/
 *   - NHL series_id 10346, slug pattern /^nhl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/
 *   - NFL series_id 10187, slug pattern /^nfl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/
 *   - EPL series_id 10188, slug pattern /^epl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/
 */

export interface DiscoveredGamesLeague {
  slug: string
  seriesId: string
  slugPattern: RegExp
  mainTag: string
}

export const DISCOVERED_GAMES_LEAGUES: readonly DiscoveredGamesLeague[] = [
  {
    slug: 'mlb',
    seriesId: '3',
    slugPattern: /^mlb-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/,
    mainTag: 'mlb',
  },
] as const

export type DiscoveredGamesLeagueSlug = (typeof DISCOVERED_GAMES_LEAGUES)[number]['slug']

/**
 * Returns the league entry whose slug pattern matches `slug`, or `undefined`
 * for non-discovery slugs. Used by render-time dispatch and the per-game
 * refresh sync.
 */
export function getLeagueForGameSlug(slug: string): DiscoveredGamesLeague | undefined {
  return DISCOVERED_GAMES_LEAGUES.find(league => league.slugPattern.test(slug))
}

/**
 * Returns true if `slug` matches any registered per-game slug pattern.
 * Distinct from Phase A v2's `isPolymarketDiscoverySlug` (literal allowlist
 * of futures slugs).
 */
export function isDiscoveryGameSlug(slug: string): boolean {
  return getLeagueForGameSlug(slug) !== undefined
}
