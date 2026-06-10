import type { SportsGamesTeam } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { SupportedLocale } from '@/i18n/locales'
import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import { and, eq, gte, sql } from 'drizzle-orm'
import { cacheTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import {
  discovered_polymarket_events,
  discovered_polymarket_games,
} from '@/lib/db/schema'
import { db } from '@/lib/drizzle'
import { buildChanceByMarket } from '@/lib/market-chance'
import { DISCOVERED_SLUG_METADATA } from '@/lib/polymarket/discovered-slugs'
import { getLeagueForGameSlug } from '@/lib/polymarket/games-leagues'
import { DiscoveredGameMarketsPayloadSchema } from '@/lib/polymarket/normalize-games-discovery-payload'
import { buildSyntheticEvent, parseGameSlugTeams } from '@/lib/polymarket/synthesize-sports-card'
import { buildHomeSportsMoneylineModel, resolveHomeSportsButtonChance } from '@/lib/sports-home-card'
import 'server-only'

export interface SidebarFutureRow {
  slug: string
  title: string
  href: string
}

/**
 * A leading-team derivation paired with the underlying discovered-game row.
 * `leading` is `null` when the moneyline market couldn't be parsed (missing
 * payload, missing prices, missing outcome labels, schema mismatch). The
 * sidebar card renders the team-row without secondary text in that case.
 */
export interface SidebarGameWithLeading {
  row: DiscoveredGameRow
  leading: { label: string, percent: number } | null
}

export interface SidebarData {
  trendingGames: SidebarGameWithLeading[]
  newGames: SidebarGameWithLeading[]
  futures: SidebarFutureRow[]
  futuresShowAllHref: string
}

const SIDEBAR_GAMES_PER_SECTION = 3
const SIDEBAR_FUTURES_LIMIT = 3
// FIFA is intentionally excluded from the futures sidebar — see Allan's
// directive in the home-v2 sidebar curation step. The 5 Phase A v2 discovery
// slugs are sufficient; FIFA can be revisited later for a dedicated surface.
const FUTURES_SLUG_BLOCKLIST: ReadonlySet<string> = new Set<string>()

function gameRowFromEntry(entry: typeof discovered_polymarket_games.$inferSelect): DiscoveredGameRow {
  return {
    slug: entry.slug,
    league: entry.league,
    polymarketEventId: entry.polymarket_event_id,
    title: entry.title,
    homeTeamLabel: entry.home_team_label,
    awayTeamLabel: entry.away_team_label,
    gameStartTime: entry.game_start_time.toISOString(),
    isActive: entry.is_active,
    isClosed: entry.is_closed,
    isArchived: entry.is_archived,
    endDate: entry.end_date ? entry.end_date.toISOString() : null,
    marketsPayload: entry.markets_payload,
    lastSyncedAt: entry.last_synced_at.toISOString(),
    lastSyncStatus: entry.last_sync_status,
    lastSyncError: entry.last_sync_error,
  }
}

/**
 * Shortens a Polymarket outcome label to just the team nickname, stripping
 * the city/location prefix that Polymarket sometimes (but not always) emits.
 *
 * Polymarket team-name conventions are inconsistent across leagues: MLB/NBA
 * tend to use `City Team` (e.g. `New York Yankees`, `San Antonio Spurs`),
 * while NHL labels are sometimes just the nickname (`Sabres`). We normalize
 * to the trailing nickname so the sidebar's secondary text is consistent.
 *
 * Rule:
 *   1. 1 word → return as-is (already short, e.g. `Sabres`, `Athletics`).
 *   2. 2+ words ending in `Sox` or `Jays` → return last 2 words
 *      (`Boston Red Sox` → `Red Sox`, `Toronto Blue Jays` → `Blue Jays`).
 *   3. Otherwise → return last word (`New York Yankees` → `Yankees`,
 *      `Oklahoma City Thunder` → `Thunder`).
 */
export function shortenTeamName(fullName: string): string {
  const trimmed = fullName.trim()
  if (trimmed.length === 0) {
    return trimmed
  }
  const words = trimmed.split(/\s+/)
  if (words.length === 1) {
    return words[0]!
  }
  const last = words.at(-1)!
  if (last === 'Sox' || last === 'Jays') {
    return `${words[words.length - 2]!} ${last}`
  }
  return last
}

/**
 * Build the `SportsGamesTeam` the shared resolver expects from a sidecar row's
 * persisted team label + slug-derived abbreviation. The label (e.g.
 * "Switzerland", "Boston Red Sox") is the FULL team name the resolver matches
 * on (`doesTextMatchTeam` does an includes-match against the name), so it must
 * be the label, not the abbreviation.
 */
function toSidebarTeam(
  label: string | null,
  abbreviation: string,
  hostStatus: 'home' | 'away',
): SportsGamesTeam {
  return {
    name: label?.trim() || abbreviation.toUpperCase(),
    abbreviation,
    record: null,
    color: null,
    logoUrl: null,
    hostStatus,
  }
}

/**
 * Derives the leading team + win% for a sidebar game row by REUSING the exact
 * resolver the home-v2 sport-section cards use — never a parallel copy:
 *   row → buildSyntheticEvent → buildHomeSportsMoneylineModel + buildChanceByMarket
 *       → resolveHomeSportsButtonChance per team → the higher-chance team wins.
 *
 * This is soccer-aware: soccer / World Cup games encode their moneyline as 3
 * separate Yes/No legs (Home / Draw / Away), and `buildSeparatedMoneylineModel`
 * matches each leg to its team and reads the YES side — so "Switzerland 61%"
 * renders instead of the naive first-leg "No 84%". MLB/NBA/NHL (2-outcome
 * team-name moneyline) flow through the SAME resolver via
 * `buildBinaryMoneylineModel` and are unchanged.
 *
 * Returns `null` (sidebar card renders without a secondary span) when the
 * payload can't be parsed, the slug isn't a base game, or no moneyline model
 * resolves. Sub-event rows (`-player-props`, `-more-markets`, …) are filtered
 * out upstream in `fetchRandomDiscoveredGames`, so they never reach here.
 */
function deriveLeadingTeam(
  row: DiscoveredGameRow,
): { label: string, percent: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.marketsPayload)
  }
  catch {
    return null
  }

  const result = DiscoveredGameMarketsPayloadSchema.safeParse(parsed)
  if (!result.success || result.data.markets.length === 0) {
    return null
  }

  const league = getLeagueForGameSlug(row.slug)
  const slugTeams = parseGameSlugTeams(row.slug, league?.teamOrderConvention)
  if (!slugTeams) {
    return null
  }

  try {
    const event = buildSyntheticEvent(
      row,
      result.data,
      toSidebarTeam(row.homeTeamLabel, slugTeams.homeAbbr, 'home'),
      toSidebarTeam(row.awayTeamLabel, slugTeams.awayAbbr, 'away'),
      league?.sportRouteSlug ?? row.league,
    )
    const model = buildHomeSportsMoneylineModel(event)
    if (!model) {
      return null
    }

    const chanceByMarket = buildChanceByMarket(event.markets)
    const team1Percent = Math.round(
      resolveHomeSportsButtonChance(chanceByMarket[model.team1Button.conditionId], model.team1Button.outcomeIndex),
    )
    const team2Percent = Math.round(
      resolveHomeSportsButtonChance(chanceByMarket[model.team2Button.conditionId], model.team2Button.outcomeIndex),
    )

    const leadingTeam = team1Percent >= team2Percent ? model.team1 : model.team2
    const leadingPercent = Math.max(team1Percent, team2Percent)
    if (leadingPercent <= 0) {
      return null
    }
    return {
      label: shortenTeamName(leadingTeam.name),
      percent: leadingPercent,
    }
  }
  catch {
    return null
  }
}

function attachLeading(row: DiscoveredGameRow): SidebarGameWithLeading {
  return {
    row,
    leading: deriveLeadingTeam(row),
  }
}

// Over-fetch so the base-game filter below still yields a full set. Per-game
// SUB-EVENT rows (`-player-props`, `-more-markets`, `-exact-score`, …) share a
// base game's teams but carry no moneyline market, so they'd render as blank,
// duplicate sidebar cards — and they are ~63% of the eligible pool (80% for
// FIFA World Cup). 60 leaves ample headroom above the 6 base games the sidebar
// needs.
const SIDEBAR_RANDOM_OVERFETCH = 60

async function fetchRandomDiscoveredGames(limit: number): Promise<DiscoveredGameRow[]> {
  // Only upcoming/in-window games. Mirrors the `now - 1h` guard in
  // DiscoveredGamesRepository.listUpcomingByLeague (discovered-games.ts:144,153)
  // that the homepage sections and sports-list route already use. Without it the
  // `is_closed = false` filter is NOT sufficient: the discovery sync keeps a
  // concluded game `is_active = true / is_closed = false` for hours-to-days
  // (Polymarket sync lag), so `ORDER BY random()` would surface past/concluded
  // games in the sidebar (~half the eligible pool were stale before this guard).
  const windowStart = new Date(Date.now() - 60 * 60 * 1000)
  const entries = await db
    .select()
    .from(discovered_polymarket_games)
    .where(and(
      eq(discovered_polymarket_games.is_active, true),
      eq(discovered_polymarket_games.is_archived, false),
      eq(discovered_polymarket_games.is_closed, false),
      gte(discovered_polymarket_games.game_start_time, windowStart),
    ))
    .orderBy(sql`random()`)
    .limit(SIDEBAR_RANDOM_OVERFETCH)

  // Keep only BASE-GAME rows. `parseGameSlugTeams` returns null for any slug
  // that isn't the `{league}-{away}-{home}-{YYYY}-{MM}-{DD}` shape — the SAME
  // base-game detection the home-v2 sport sections use to skip sub-events
  // (fetchLeagueEvents.ts), so the sidebar agrees with the cards on what a game
  // is and they can't drift apart.
  return entries
    .map(gameRowFromEntry)
    .filter(row => parseGameSlugTeams(row.slug) !== null)
    .slice(0, limit)
}

async function fetchActiveFuturesSlugs(): Promise<Set<string>> {
  const entries = await db
    .select({ slug: discovered_polymarket_events.slug })
    .from(discovered_polymarket_events)
    .where(eq(discovered_polymarket_events.is_active, true))

  return new Set(entries.map(e => e.slug))
}

export async function fetchSidebarData(locale: SupportedLocale): Promise<SidebarData> {
  'use cache'
  cacheTag(cacheTags.discoveredGamesSidebar)
  cacheTag(cacheTags.sportsFuturesSidebar)

  // Single query of 6 random rows, split 3/3 to guarantee disjointness between
  // the trending and new sections. ORDER BY random() is acceptable for the
  // small `discovered_polymarket_games` table (~80 rows).
  const games = await fetchRandomDiscoveredGames(SIDEBAR_GAMES_PER_SECTION * 2)
  const trendingGames = games.slice(0, SIDEBAR_GAMES_PER_SECTION).map(attachLeading)
  const newGames = games.slice(SIDEBAR_GAMES_PER_SECTION, SIDEBAR_GAMES_PER_SECTION * 2).map(attachLeading)

  const activeSlugs = await fetchActiveFuturesSlugs()
  const futures: SidebarFutureRow[] = DISCOVERED_SLUG_METADATA
    .filter(meta => activeSlugs.has(meta.slug) && !FUTURES_SLUG_BLOCKLIST.has(meta.slug))
    .slice(0, SIDEBAR_FUTURES_LIMIT)
    .map((meta) => {
      // Phase A v2 discovery slugs route via /event/[slug] (render-time
      // dispatch). Per-row cache tag so a single-slug sync invalidates this
      // sidebar list along with the event page itself.
      cacheTag(cacheTags.discoveredEvent(meta.slug))
      return {
        slug: meta.slug,
        title: meta.display_label,
        href: `/${locale}/event/${meta.slug}`,
      }
    })

  return {
    trendingGames,
    newGames,
    futures,
    futuresShowAllHref: `/${locale}/sports/futures`,
  }
}
