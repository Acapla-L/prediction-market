/**
 * Home-v2 sports-forward section configuration.
 *
 * Step 3 (sports pivot): replaced legacy political/finance/tech sections with
 * sport-specific shelves driven by the Phase B per-game discovery sidecar.
 *
 * Two section kinds:
 *   - `tag`     — generic Sports overview pulled via `EventRepository.listEvents`
 *                 filtered by `tagSlug`. Existing Step-1/2 fetcher
 *                 (`fetchCategoryEvents`) handles this kind.
 *   - `league`  — top N upcoming games for one league pulled from
 *                 `discovered_polymarket_games`. New fetcher
 *                 (`fetchLeagueEvents`) handles this kind.
 *
 * Soccer is a multi-league section (Phase B v2 v3): it merges EPL + La Liga +
 * MLS discovery cards via `sportRouteSlug: 'soccer'` rather than a single
 * `leagueSlug`. FIFA World Cup gets its own single-league section
 * (`leagueSlug: 'fifwc'`). Both render `null` until the discovery sidecar
 * populates.
 *
 * Section IDs double as anchor targets: `/home-v2#basketball` will scroll to
 * the basketball section.
 */

import type { DiscoveredGamesLeagueSlug } from '@/lib/polymarket/games-leagues'

export type HomeV2SectionId = 'baseball' | 'basketball' | 'hockey' | 'soccer' | 'fifa-world-cup'

export interface HomeV2TagSectionConfig {
  kind: 'tag'
  id: 'sports'
  tagSlug: 'sports'
  titleKey: 'Sports'
  href: string
}

export interface HomeV2LeagueSectionConfig {
  kind: 'league'
  id: 'baseball' | 'basketball' | 'hockey' | 'soccer' | 'fifa-world-cup'
  /**
   * Single league slug from `DISCOVERED_GAMES_LEAGUES` registry. Use this for
   * one-league sections (baseball/basketball/hockey/fifa-world-cup). Mutually
   * exclusive with `sportRouteSlug`.
   */
  leagueSlug?: DiscoveredGamesLeagueSlug
  /**
   * Sport-route alias from the registry (`sportRouteSlug` field). When set,
   * the fetcher merges ALL leagues sharing this alias — e.g. `'soccer'`
   * merges EPL + La Liga + MLS. Mutually exclusive with `leagueSlug`.
   */
  sportRouteSlug?: string
  titleKey: 'Baseball' | 'Basketball' | 'Hockey' | 'Soccer' | 'FIFA World Cup 2026'
  href: string
  /**
   * When true, the league fetcher short-circuits to an empty list without
   * touching the DB. Currently unused — kept for forward compatibility.
   */
  placeholder?: true
}

export type HomeV2SectionConfig = HomeV2TagSectionConfig | HomeV2LeagueSectionConfig

/**
 * Render order:
 *   Baseball → Basketball → Hockey → Soccer (EPL+La Liga+MLS) → FIFA World Cup.
 */
export const HOME_V2_CATEGORIES: readonly HomeV2SectionConfig[] = [
  { kind: 'league', id: 'baseball', leagueSlug: 'mlb', titleKey: 'Baseball', href: '/sports/baseball/games' },
  { kind: 'league', id: 'basketball', leagueSlug: 'nba', titleKey: 'Basketball', href: '/sports/basketball/games' },
  { kind: 'league', id: 'hockey', leagueSlug: 'nhl', titleKey: 'Hockey', href: '/sports/hockey/games' },
  { kind: 'league', id: 'soccer', sportRouteSlug: 'soccer', titleKey: 'Soccer', href: '/sports/soccer/games' },
  {
    kind: 'league',
    id: 'fifa-world-cup',
    leagueSlug: 'fifwc',
    titleKey: 'FIFA World Cup 2026',
    href: '/sports/fifa-world-cup/games',
  },
] as const
