import type { QueryResult } from '@/types'
import { eq, sql } from 'drizzle-orm'
import { discovered_polymarket_events } from '@/lib/db/schema'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'

export interface DiscoveredEventRow {
  slug: string
  polymarketEventId: string
  title: string
  isActive: boolean
  endDate: string | null
  marketsPayload: string
  lastSyncedAt: string
  lastSyncStatus: string
  lastSyncError: string | null
}

export interface DiscoveredEventUpsertInput {
  slug: string
  polymarket_event_id: string
  title: string
  is_active: boolean
  end_date: Date | null
  markets_payload: string
}

export interface DiscoveredEventStatusInput {
  slug: string
  status: string
  error: string | null
}

function rowToReturn(entry: typeof discovered_polymarket_events.$inferSelect): DiscoveredEventRow {
  return {
    slug: entry.slug,
    polymarketEventId: entry.polymarket_event_id,
    title: entry.title,
    isActive: entry.is_active,
    endDate: entry.end_date ? entry.end_date.toISOString() : null,
    marketsPayload: entry.markets_payload,
    lastSyncedAt: entry.last_synced_at.toISOString(),
    lastSyncStatus: entry.last_sync_status,
    lastSyncError: entry.last_sync_error,
  }
}

export const DiscoveredEventsRepository = {
  async getBySlug(slug: string): Promise<QueryResult<DiscoveredEventRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .select()
        .from(discovered_polymarket_events)
        .where(eq(discovered_polymarket_events.slug, slug))
        .limit(1)

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },

  /**
   * Insert-or-update by slug. Refreshes the payload and resets the
   * sync-status fields to `ok` / null. Sets `last_synced_at = NOW()`.
   */
  async upsertSuccess(input: DiscoveredEventUpsertInput): Promise<QueryResult<DiscoveredEventRow>> {
    return runQuery(async () => {
      const [entry] = await db
        .insert(discovered_polymarket_events)
        .values({
          slug: input.slug,
          polymarket_event_id: input.polymarket_event_id,
          title: input.title,
          is_active: input.is_active,
          end_date: input.end_date,
          markets_payload: input.markets_payload,
          last_synced_at: new Date(),
          last_sync_status: 'ok',
          last_sync_error: null,
        })
        .onConflictDoUpdate({
          target: discovered_polymarket_events.slug,
          set: {
            polymarket_event_id: sql`EXCLUDED.polymarket_event_id`,
            title: sql`EXCLUDED.title`,
            is_active: sql`EXCLUDED.is_active`,
            end_date: sql`EXCLUDED.end_date`,
            markets_payload: sql`EXCLUDED.markets_payload`,
            last_synced_at: sql`EXCLUDED.last_synced_at`,
            last_sync_status: sql`EXCLUDED.last_sync_status`,
            last_sync_error: sql`EXCLUDED.last_sync_error`,
          },
        })
        .returning()

      if (!entry) {
        return { data: null, error: 'Failed to upsert discovered Polymarket event.' }
      }

      return {
        data: rowToReturn(entry),
        error: null,
      }
    })
  },

  /**
   * Records a sync failure for a slug WITHOUT touching `markets_payload` —
   * the previously-known-good payload remains served until next success.
   * Used for Gamma 404, network errors, and Zod parse failures.
   *
   * If no row exists yet for the slug, this becomes a no-op (we never
   * create a failure-only row — first sync must succeed before a row exists).
   */
  async markFailure(input: DiscoveredEventStatusInput): Promise<QueryResult<DiscoveredEventRow | null>> {
    return runQuery(async () => {
      const [entry] = await db
        .update(discovered_polymarket_events)
        .set({
          last_sync_status: input.status,
          last_sync_error: input.error,
          last_synced_at: new Date(),
        })
        .where(eq(discovered_polymarket_events.slug, input.slug))
        .returning()

      return {
        data: entry ? rowToReturn(entry) : null,
        error: null,
      }
    })
  },
}
