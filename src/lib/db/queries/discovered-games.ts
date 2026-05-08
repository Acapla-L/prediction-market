import type { QueryResult } from '@/types'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { discovered_polymarket_games } from '@/lib/db/schema'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'

export interface DiscoveredGameRow {
  slug: string
  league: string
  polymarketEventId: string
  title: string
  homeTeamLabel: string | null
  awayTeamLabel: string | null
  gameStartTime: string
  isActive: boolean
  isClosed: boolean
  isArchived: boolean
  endDate: string | null
  marketsPayload: string
  lastSyncedAt: string
  lastSyncStatus: string
  lastSyncError: string | null
}

export interface DiscoveredGameUpsertInput {
  slug: string
  league: string
  polymarket_event_id: string
  title: string
  home_team_label: string | null
  away_team_label: string | null
  game_start_time: Date
  is_active: boolean
  is_closed: boolean
  end_date: Date | null
  markets_payload: string
}

export interface DiscoveredGameStatusInput {
  slug: string
  status: string
  error: string | null
}

export interface DiscoveredGameWindowQuery {
  windowStart: Date
  windowEnd: Date
}

function rowToReturn(entry: typeof discovered_polymarket_games.$inferSelect): DiscoveredGameRow {
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

export const DiscoveredGamesRepository = {
  async getBySlug(slug: string): Promise<QueryResult<DiscoveredGameRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .select()
        .from(discovered_polymarket_games)
        .where(eq(discovered_polymarket_games.slug, slug))
        .limit(1)

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },

  /**
   * List rows whose `game_start_time` falls inside the refresh window AND
   * are not archived. Used by the per-game refresh cron to decide which
   * sidecar rows need a Polymarket Gamma re-fetch.
   */
  async listInRefreshWindow(query: DiscoveredGameWindowQuery): Promise<QueryResult<DiscoveredGameRow[]>> {
    return runQuery(async () => {
      const entries = await db
        .select()
        .from(discovered_polymarket_games)
        .where(and(
          gte(discovered_polymarket_games.game_start_time, query.windowStart),
          lte(discovered_polymarket_games.game_start_time, query.windowEnd),
          eq(discovered_polymarket_games.is_archived, false),
        ))

      return {
        data: entries.map(rowToReturn),
        error: null,
      }
    })
  },

  /**
   * List active (non-archived) rows for a league, ordered by game_start_time
   * ASC. Caller filters further (e.g. is_closed=false) as needed.
   */
  async listActiveByLeague(league: string): Promise<QueryResult<DiscoveredGameRow[]>> {
    return runQuery(async () => {
      const entries = await db
        .select()
        .from(discovered_polymarket_games)
        .where(and(
          eq(discovered_polymarket_games.league, league),
          eq(discovered_polymarket_games.is_archived, false),
        ))
        .orderBy(asc(discovered_polymarket_games.game_start_time))

      return {
        data: entries.map(rowToReturn),
        error: null,
      }
    })
  },

  /**
   * List upcoming non-archived, non-closed, active games for a league,
   * ordered by `game_start_time` ASC and capped at `limit`. The window
   * starts at `now - 1 hour` so an in-progress game (started up to an hour
   * ago) still surfaces on the homepage shelf. Used by the home-v2
   * `fetchLeagueEvents` data layer.
   */
  async listUpcomingByLeague(
    league: string,
    limit: number,
    now: Date,
  ): Promise<QueryResult<DiscoveredGameRow[]>> {
    return runQuery(async () => {
      const windowStart = new Date(now.getTime() - 60 * 60 * 1000)
      const entries = await db
        .select()
        .from(discovered_polymarket_games)
        .where(and(
          eq(discovered_polymarket_games.league, league),
          eq(discovered_polymarket_games.is_active, true),
          eq(discovered_polymarket_games.is_archived, false),
          eq(discovered_polymarket_games.is_closed, false),
          gte(discovered_polymarket_games.game_start_time, windowStart),
        ))
        .orderBy(asc(discovered_polymarket_games.game_start_time))
        .limit(limit)

      return {
        data: entries.map(rowToReturn),
        error: null,
      }
    })
  },

  /**
   * Insert-or-update by slug. Refreshes the payload + lifecycle flags and
   * resets the sync-status fields to `ok` / null. Sets
   * `last_synced_at = NOW()`. The PRIMARY KEY conflict target is `slug`.
   */
  async upsertSuccess(input: DiscoveredGameUpsertInput): Promise<QueryResult<DiscoveredGameRow>> {
    return runQuery(async () => {
      const [entry] = await db
        .insert(discovered_polymarket_games)
        .values({
          slug: input.slug,
          league: input.league,
          polymarket_event_id: input.polymarket_event_id,
          title: input.title,
          home_team_label: input.home_team_label,
          away_team_label: input.away_team_label,
          game_start_time: input.game_start_time,
          is_active: input.is_active,
          is_closed: input.is_closed,
          // is_archived intentionally not set on upsert — it's flipped only
          // by archiveStaleGames(). Default false on first insert.
          end_date: input.end_date,
          markets_payload: input.markets_payload,
          last_synced_at: new Date(),
          last_sync_status: 'ok',
          last_sync_error: null,
        })
        .onConflictDoUpdate({
          target: discovered_polymarket_games.slug,
          set: {
            league: sql`EXCLUDED.league`,
            polymarket_event_id: sql`EXCLUDED.polymarket_event_id`,
            title: sql`EXCLUDED.title`,
            home_team_label: sql`EXCLUDED.home_team_label`,
            away_team_label: sql`EXCLUDED.away_team_label`,
            game_start_time: sql`EXCLUDED.game_start_time`,
            is_active: sql`EXCLUDED.is_active`,
            is_closed: sql`EXCLUDED.is_closed`,
            end_date: sql`EXCLUDED.end_date`,
            markets_payload: sql`EXCLUDED.markets_payload`,
            last_synced_at: sql`EXCLUDED.last_synced_at`,
            last_sync_status: sql`EXCLUDED.last_sync_status`,
            last_sync_error: sql`EXCLUDED.last_sync_error`,
          },
        })
        .returning()

      if (!entry) {
        return { data: null, error: 'Failed to upsert discovered Polymarket game.' }
      }

      return {
        data: rowToReturn(entry),
        error: null,
      }
    })
  },

  /**
   * Archive rows whose game finished long enough ago that they no longer
   * belong on active listings. Sets `is_archived = true` for any row where
   * `is_closed = true AND game_start_time < cutoff`. Sidecar rows are NEVER
   * deleted — chart history depends on them.
   *
   * Returns `archivedCount` for observability.
   */
  async archiveStaleGames(cutoff: Date): Promise<QueryResult<{ archivedCount: number }>> {
    return runQuery(async () => {
      const updated = await db
        .update(discovered_polymarket_games)
        .set({ is_archived: true })
        .where(and(
          eq(discovered_polymarket_games.is_closed, true),
          eq(discovered_polymarket_games.is_archived, false),
          lte(discovered_polymarket_games.game_start_time, cutoff),
        ))
        .returning({ slug: discovered_polymarket_games.slug })

      return {
        data: { archivedCount: updated.length },
        error: null,
      }
    })
  },

  /**
   * Records a sync failure for a slug WITHOUT touching `markets_payload` —
   * the previously-known-good payload remains served until next success.
   * If no row exists yet for the slug, this becomes a no-op.
   */
  async markFailure(input: DiscoveredGameStatusInput): Promise<QueryResult<DiscoveredGameRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .update(discovered_polymarket_games)
        .set({
          last_sync_status: input.status,
          last_sync_error: input.error,
          last_synced_at: new Date(),
        })
        .where(eq(discovered_polymarket_games.slug, input.slug))
        .returning()

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },
}
