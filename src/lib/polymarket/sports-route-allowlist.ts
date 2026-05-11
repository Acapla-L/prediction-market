/**
 * Fix A5 — connection-pool-hardening.
 *
 * Static allowlist of known `/sports/[sport]/games` URL tokens. Used by the
 * OUTER (non-cached) callers in `sports-games-list-data.tsx` to short-circuit
 * unknown sport-slug URLs with a fast `notFound()` BEFORE any DB-touching code
 * (and BEFORE entering the `'use cache'` boundary).
 *
 * Why this exists:
 *   Bots/crawlers walk the route surface and hit ~130 distinct `/sports/{slug}/games`
 *   paths. Without this short-circuit, each unknown slug cold-renders the
 *   `fetchSportsGamesListCachedData` `'use cache'` fetcher (2 DB queries + a
 *   potential 7-league discovery fan-out), each of which holds a Supavisor
 *   :6543 transaction-pool connection for up to 60s under contention. The
 *   Supavisor cap is 200 clients — pool exhaustion is a P0.
 *
 * Cache-boundary discipline:
 *   The check MUST run in the OUTER caller (outside `'use cache'`). Calling
 *   `notFound()` inside `'use cache'` causes the documented React #419 /
 *   HTTP 200 hydration mismatch (see CLAUDE.md "Server/Client Boundary"
 *   section and the Phase A v2 P0 fix at commit `9c250959`).
 *
 * Maintenance contract:
 *   - Sources:
 *     1. `DISCOVERED_GAMES_LEAGUES` entries (derived dynamically — both the
 *        `slug` and `sportRouteSlug` fields).
 *     2. Snapshot of `sports_menu_items.menu_slug` (enabled rows) and the
 *        flattened `url_aliases` values from production Supabase, taken
 *        2026-05-11 as part of the A5 hardening pass.
 *   - If Kuest adds a new canonical sport (new `sports_menu_items` row) or
 *     a new `url_aliases` entry, add it to `KUEST_SNAPSHOT_SLUGS` below AND
 *     update the drift-lock test (`tests/unit/sportsRouteSlugAllowlist.test.ts`).
 *   - If a new league is added to `DISCOVERED_GAMES_LEAGUES`, the registry-
 *     derived entries below pick it up automatically (no edit needed here).
 *   - Tracked alongside related B4 (route-surface hardening) work.
 */

import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'

/**
 * Snapshot of every distinct `menu_slug` from `sports_menu_items` where
 * `enabled = true` and `menu_slug IS NOT NULL`, plus every value found in
 * the flattened `url_aliases` jsonb array. Captured 2026-05-11 from
 * production Supabase.
 *
 * Note: some of these slugs (e.g. `bkcl`, `euroleague`, `chess`, `golf`,
 * `wtt-mens-singles`) are real Kuest menu entries even though they may have
 * no upstream events. The route returns an empty grid (or 404 from the
 * existing inner-fetcher check) in that case — which is the intended
 * behavior. The A5 allowlist's only job is to short-circuit slugs that are
 * NOT real route targets at all.
 */
const KUEST_SNAPSHOT_SLUGS: readonly string[] = [
  // menu_slug values
  'acn', 'afc-wc', 'ahl', 'arg', 'atp', 'aus',
  'bkarg', 'bkcba', 'bkcl', 'bkfr1', 'bkkbl', 'bkligend', 'bknbl', 'bkseriea',
  'bl2', 'bol1', 'boxing', 'bra', 'bra2', 'bundesliga',
  'caf', 'call-of-duty', 'cbb', 'cde', 'cdr', 'cehl', 'cfb', 'chess', 'chi1',
  'col1', 'concacaf', 'conl', 'conmebol', 'counter-strike',
  'cricbbl', 'cricbpl', 'criccpl', 'criccsat20w', 'cricilt20', 'cricipl',
  'criclcl', 'cricmlc', 'cricpakt20cup', 'cricpsl', 'cricsa20', 'cricsm',
  'crict20blast', 'crict20lpl', 'crict20plw', 'cricwncl', 'crint',
  'csl', 'cwbb', 'cze1',
  'dehl', 'den', 'dfb', 'dota-2',
  'efl-cup', 'egy1', 'elc', 'epl', 'ere', 'es2', 'euroleague',
  'f1', 'fa-cup', 'fifa-friendlies', 'fifa-world-cup', 'fr2',
  'golf',
  'honor-of-kings',
  'isp', 'itc', 'itsb',
  'ja2', 'jap',
  'kbo', 'khl', 'kor',
  'laliga', 'league-of-legends', 'lib', 'ligue-1',
  'mar1', 'mex', 'mlb', 'mls', 'mobile-legends-bang-bang', 'mwoh',
  'nba', 'nfl', 'nhl', 'nor',
  'oceania-wc-qualifiers', 'overwatch',
  'per1', 'pickleball', 'por',
  'rainbow-six-siege', 'rocket-league', 'rou1',
  'ruchamp', 'rueuchamp', 'ruprem', 'rus', 'rusixnat', 'rusrp', 'rutopft', 'ruurc',
  'scop', 'sea', 'shl', 'snhl', 'spl', 'ssc',
  'starcraft-2', 'starcraft-brood-war', 'sud',
  'tur',
  'ucl', 'ucol', 'uef-qualifiers', 'uel', 'ufc', 'ukr1', 'uwcl',
  'valorant',
  'wbc', 'winter-olympics-all', 'wta', 'wtt-mens-singles', 'wtt-womens-singles', 'wwoh',
  'zuffa',
  // url_aliases values (flattened from jsonb arrays)
  'brazil', 'cs2', 'legends-cricket-league', 'lol', 'ncaab',
]

/**
 * Discovery registry entries — both `slug` and `sportRouteSlug` fields.
 * Derived dynamically from `DISCOVERED_GAMES_LEAGUES` so adding a new league
 * (e.g. soccer in Phase B v2 v3) auto-extends the allowlist.
 */
const REGISTRY_SLUGS: readonly string[] = DISCOVERED_GAMES_LEAGUES.flatMap(
  league => [league.slug, league.sportRouteSlug],
)

/**
 * The final allowlist. Readonly `Set<string>` for O(1) membership lookup.
 */
export const KNOWN_SPORT_ROUTE_SLUGS: ReadonlySet<string> = new Set<string>([
  ...KUEST_SNAPSHOT_SLUGS,
  ...REGISTRY_SLUGS,
])
