import type { SupportedLocale } from '@/i18n/locales'
import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import { and, eq, sql } from 'drizzle-orm'
import { cacheTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import {
  discovered_polymarket_events,
  discovered_polymarket_games,
} from '@/lib/db/schema'
import { db } from '@/lib/drizzle'
import { DISCOVERED_SLUG_METADATA } from '@/lib/polymarket/discovered-slugs'
import { DiscoveredGameMarketsPayloadSchema } from '@/lib/polymarket/normalize-games-discovery-payload'
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
 * Derives the leading team and percentage for a sidebar row from the game's
 * moneyline market. Polymarket per-game moneylines have 2 outcomes whose
 * labels ARE the team names (e.g. `["New York Yankees", "Boston Red Sox"]`)
 * and whose prices express implied win probability. The higher-priced
 * outcome's label + percent is the "leading team" we want to surface in
 * place of the raw start time.
 *
 * Returns `null` if the payload can't be parsed, the moneyline market is
 * absent, prices/outcomes are missing, or both prices parse to NaN — the
 * sidebar card renders without a secondary span in that case.
 */
function deriveLeadingTeam(
  marketsPayload: string,
): { label: string, percent: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(marketsPayload)
  }
  catch {
    return null
  }

  const result = DiscoveredGameMarketsPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  const moneyline = result.data.markets.find(m => m.market_type === 'moneyline')
  if (!moneyline) {
    return null
  }
  if (!moneyline.outcomes || !moneyline.outcome_prices) {
    return null
  }

  const price0 = Number(moneyline.outcome_prices[0])
  const price1 = Number(moneyline.outcome_prices[1])
  if (Number.isNaN(price0) && Number.isNaN(price1)) {
    return null
  }

  const useFirst = (Number.isNaN(price1)) || (price0 >= price1)
  const winningPrice = useFirst ? price0 : price1
  const winningLabel = useFirst ? moneyline.outcomes[0] : moneyline.outcomes[1]
  if (!winningLabel || Number.isNaN(winningPrice)) {
    return null
  }

  return {
    label: winningLabel,
    percent: Math.round(winningPrice * 100),
  }
}

function attachLeading(row: DiscoveredGameRow): SidebarGameWithLeading {
  return {
    row,
    leading: deriveLeadingTeam(row.marketsPayload),
  }
}

async function fetchRandomDiscoveredGames(limit: number): Promise<DiscoveredGameRow[]> {
  const entries = await db
    .select()
    .from(discovered_polymarket_games)
    .where(and(
      eq(discovered_polymarket_games.is_active, true),
      eq(discovered_polymarket_games.is_archived, false),
      eq(discovered_polymarket_games.is_closed, false),
    ))
    .orderBy(sql`random()`)
    .limit(limit)

  return entries.map(gameRowFromEntry)
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
