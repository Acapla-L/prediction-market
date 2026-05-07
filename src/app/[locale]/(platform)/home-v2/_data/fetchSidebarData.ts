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
import 'server-only'

export interface SidebarFutureRow {
  slug: string
  title: string
  href: string
}

export interface SidebarData {
  trendingGames: DiscoveredGameRow[]
  newGames: DiscoveredGameRow[]
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
  const trendingGames = games.slice(0, SIDEBAR_GAMES_PER_SECTION)
  const newGames = games.slice(SIDEBAR_GAMES_PER_SECTION, SIDEBAR_GAMES_PER_SECTION * 2)

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
