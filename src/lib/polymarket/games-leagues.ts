/**
 * Phase B per-game discovery — league registry.
 *
 * MVP shipped: MLB (Phase B v2 v1, 2026-05-06).
 * Phase B v2 v2 ship (2026-05-06): NBA + NHL.
 *
 * Each league entry pairs:
 *   - `slug`             — short identifier used in our slug pattern + URL
 *   - `seriesId`         — Polymarket Gamma `series_id` from `GET /sports`
 *   - `slugPattern`      — regex matching valid per-game slugs for the league
 *   - `mainTag`          — the `main_tag` value on the synthetic Event
 *   - `sportRouteSlug`   — the SPORT slug used by Kuest's `/sports/[sport]/[event]`
 *                          route (e.g., MLB → 'baseball'). Resolved by
 *                          `SportsMenuRepository.resolveCanonicalSlugByAlias`.
 *                          See plan §E (URL routing strategy) and §K resolution #6.
 *
 * The slug pattern source MUST stay byte-identical with the inline mirror in
 * `useEventPriceHistory.ts`. The Phase B drift detector test asserts equality.
 *
 * Slug examples:
 *   - `mlb-tex-nyy-2026-05-05`         — Texas at Yankees, May 5, 2026
 *   - `mlb-cin-chc-2026-05-05`         — Cincinnati at Cubs, May 5, 2026
 *   - `nba-min-sas-2026-05-06`         — Minnesota at San Antonio, May 6, 2026
 *   - `nhl-ana-las-2026-05-06`         — Anaheim at Las Vegas, May 6, 2026
 */

export interface DiscoveredGamesLeague {
  slug: string
  seriesId: string
  slugPattern: RegExp
  mainTag: string
  sportRouteSlug: string
  /**
   * Per-league all-star / exhibition placeholder abbreviations to filter from
   * the teams_cache sync. Optional; defaults to empty Set for leagues without
   * placeholder entries in Polymarket's /teams response.
   *
   * Source-of-truth migration (Phase B v2 v2): replaces the hardcoded
   * `LEAGUE_PLACEHOLDER_ABBREVIATIONS` Set previously in
   * `polymarket-teams/route.ts`. The route now reads this field per-league.
   */
  placeholderAbbreviations?: ReadonlySet<string>
  /**
   * Optional event-level filter applied during discovery sync. Returns true if
   * the slug should be persisted; false to skip. Default behavior (when
   * undefined): persist every event. Phase B v2 v3 (soccer) will use this to
   * filter UCL sub-events; Phase B v2 v2 leagues all leave it undefined.
   */
  subEventFilter?: (eventSlug: string) => boolean
}

export const DISCOVERED_GAMES_LEAGUES: readonly DiscoveredGamesLeague[] = [
  {
    slug: 'mlb',
    seriesId: '3',
    slugPattern: /^mlb-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/,
    mainTag: 'mlb',
    sportRouteSlug: 'baseball',
    placeholderAbbreviations: new Set(['al', 'nl']),
  },
  {
    slug: 'nba',
    seriesId: '10345',
    slugPattern: /^nba-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/,
    mainTag: 'nba',
    sportRouteSlug: 'basketball',
    placeholderAbbreviations: new Set(['crs', 'cgs', 'sog', 'kys', 'world', 'stars', 'stripes']),
  },
  {
    slug: 'nhl',
    seriesId: '10346',
    slugPattern: /^nhl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/,
    mainTag: 'nhl',
    sportRouteSlug: 'hockey',
    placeholderAbbreviations: new Set(['finnhl', 'cannhl', 'swenhl', 'usanhl']),
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

/**
 * Returns the league entry whose `sportRouteSlug` field matches `sportRouteSlug`,
 * or `undefined` if no registered league uses that URL segment. Used by
 * Stream 2's list-route dispatch to map URL tokens like `'baseball'` onto
 * the discovery sidecar `league` value (`'mlb'`).
 */
export function getLeagueBySportRouteSlug(
  sportRouteSlug: string,
): DiscoveredGamesLeague | undefined {
  return DISCOVERED_GAMES_LEAGUES.find(league => league.sportRouteSlug === sportRouteSlug)
}

/**
 * Returns the league entry whose `slug` matches `slug`, or `undefined`. Used
 * by Stream 2's list-route dispatch as the canonical-token fallback when the
 * URL token equals the registry's league slug directly (e.g., `/sports/mlb/games`).
 */
export function getLeagueBySlug(slug: string): DiscoveredGamesLeague | undefined {
  return DISCOVERED_GAMES_LEAGUES.find(league => league.slug === slug)
}
