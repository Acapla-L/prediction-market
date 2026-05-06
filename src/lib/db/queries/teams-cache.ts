import type { QueryResult } from '@/types'
import { and, eq, sql } from 'drizzle-orm'
import { teams_cache } from '@/lib/db/schema'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'

export interface TeamCacheRow {
  league: string
  teamId: string
  name: string
  alias: string | null
  abbreviation: string
  logoUrl: string | null
  color: string | null
  record: string | null
  lastSyncedAt: string
  lastSyncStatus: string
  lastSyncError: string | null
}

export interface TeamUpsertInput {
  league: string
  team_id: string
  name: string
  alias: string | null
  abbreviation: string
  logo_url: string | null
  color: string | null
  record: string | null
}

export interface TeamStatusInput {
  league: string
  abbreviation: string
  error: string
}

function rowToReturn(entry: typeof teams_cache.$inferSelect): TeamCacheRow {
  return {
    league: entry.league,
    teamId: entry.team_id,
    name: entry.name,
    alias: entry.alias,
    abbreviation: entry.abbreviation,
    logoUrl: entry.logo_url,
    color: entry.color,
    record: entry.record,
    lastSyncedAt: entry.last_synced_at.toISOString(),
    lastSyncStatus: entry.last_sync_status,
    lastSyncError: entry.last_sync_error,
  }
}

export const TeamsCacheRepository = {
  /**
   * Lookup a single team row by `(league, abbreviation)`. Used by the
   * projection layer when rendering a per-game page (slug parsing yields
   * `league` + `away`/`home` abbreviations).
   */
  async getByAbbreviation(
    league: string,
    abbreviation: string,
  ): Promise<QueryResult<TeamCacheRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .select()
        .from(teams_cache)
        .where(and(
          eq(teams_cache.league, league),
          eq(teams_cache.abbreviation, abbreviation),
        ))
        .limit(1)

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },

  /**
   * List all teams cached for a league, ordered alphabetically by
   * abbreviation. Used by the sync route diagnostics endpoint.
   */
  async listByLeague(league: string): Promise<QueryResult<TeamCacheRow[]>> {
    return runQuery(async () => {
      const entries = await db
        .select()
        .from(teams_cache)
        .where(eq(teams_cache.league, league))
        .orderBy(teams_cache.abbreviation)

      return {
        data: entries.map(rowToReturn),
        error: null,
      }
    })
  },

  /**
   * Insert-or-update by `(league, abbreviation)`. Refreshes all metadata
   * fields and resets sync-status to `ok` / null. Sets
   * `last_synced_at = NOW()`. Conflict target is the composite primary key.
   */
  async upsertSuccess(input: TeamUpsertInput): Promise<QueryResult<TeamCacheRow>> {
    return runQuery(async () => {
      const [entry] = await db
        .insert(teams_cache)
        .values({
          league: input.league,
          team_id: input.team_id,
          name: input.name,
          alias: input.alias,
          abbreviation: input.abbreviation,
          logo_url: input.logo_url,
          color: input.color,
          record: input.record,
          last_synced_at: new Date(),
          last_sync_status: 'ok',
          last_sync_error: null,
        })
        .onConflictDoUpdate({
          target: [teams_cache.league, teams_cache.abbreviation],
          set: {
            team_id: sql`EXCLUDED.team_id`,
            name: sql`EXCLUDED.name`,
            alias: sql`EXCLUDED.alias`,
            logo_url: sql`EXCLUDED.logo_url`,
            color: sql`EXCLUDED.color`,
            record: sql`EXCLUDED.record`,
            last_synced_at: sql`EXCLUDED.last_synced_at`,
            last_sync_status: sql`EXCLUDED.last_sync_status`,
            last_sync_error: sql`EXCLUDED.last_sync_error`,
          },
        })
        .returning()

      if (!entry) {
        return { data: null, error: 'Failed to upsert team cache row.' }
      }

      return {
        data: rowToReturn(entry),
        error: null,
      }
    })
  },

  /**
   * Records a sync failure for a single team WITHOUT touching the metadata
   * fields (`name`, `alias`, `logo_url`, `color`, `record`, `team_id`) — the
   * previously-known-good values remain served until the next success.
   * Updates only `last_sync_status='failure'` and `last_sync_error`.
   *
   * If no row exists yet for `(league, abbreviation)`, this is a no-op
   * (we never create a failure-only row — first sync must succeed).
   */
  async markFailure(input: TeamStatusInput): Promise<QueryResult<TeamCacheRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .update(teams_cache)
        .set({
          last_sync_status: 'failure',
          last_sync_error: input.error,
        })
        .where(and(
          eq(teams_cache.league, input.league),
          eq(teams_cache.abbreviation, input.abbreviation),
        ))
        .returning()

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },
}
