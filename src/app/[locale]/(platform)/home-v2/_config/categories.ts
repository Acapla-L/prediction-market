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
 * Soccer is reserved as a `placeholder: true` league section — Phase B v2 v3
 * will populate the sidecar; until then the fetcher returns an empty array
 * and the section renders as `null`.
 *
 * Section IDs double as anchor targets: `/home-v2#basketball` will scroll to
 * the basketball section. Step 4 wires the nav tabs that depend on these IDs.
 */

import type { DiscoveredGamesLeagueSlug } from '@/lib/polymarket/games-leagues'

export type HomeV2SectionId = 'baseball' | 'basketball' | 'hockey' | 'soccer'

export interface HomeV2TagSectionConfig {
  kind: 'tag'
  id: 'sports'
  tagSlug: 'sports'
  titleKey: 'Sports'
  href: string
}

export interface HomeV2LeagueSectionConfig {
  kind: 'league'
  id: 'baseball' | 'basketball' | 'hockey' | 'soccer'
  /**
   * League slug from `DISCOVERED_GAMES_LEAGUES` registry. Optional — Soccer
   * has no sidecar coverage yet (Phase B v2 v3 follow-up); when absent the
   * section MUST also set `placeholder: true` and the fetcher returns `[]`.
   */
  leagueSlug?: DiscoveredGamesLeagueSlug
  titleKey: 'Baseball' | 'Basketball' | 'Hockey' | 'Soccer'
  href: string
  /**
   * When true, the league fetcher short-circuits to an empty list without
   * touching the DB. Used for Soccer until Phase B v2 v3 ships.
   */
  placeholder?: true
}

export type HomeV2SectionConfig = HomeV2TagSectionConfig | HomeV2LeagueSectionConfig

/**
 * Render order for Step 3:
 *   Baseball → Basketball → Hockey → Soccer.
 */
export const HOME_V2_CATEGORIES: readonly HomeV2SectionConfig[] = [
  { kind: 'league', id: 'baseball', leagueSlug: 'mlb', titleKey: 'Baseball', href: '/sports/baseball/games' },
  { kind: 'league', id: 'basketball', leagueSlug: 'nba', titleKey: 'Basketball', href: '/sports/basketball/games' },
  { kind: 'league', id: 'hockey', leagueSlug: 'nhl', titleKey: 'Hockey', href: '/sports/hockey/games' },
  { kind: 'league', id: 'soccer', titleKey: 'Soccer', href: '/sports/soccer/games', placeholder: true },
] as const
