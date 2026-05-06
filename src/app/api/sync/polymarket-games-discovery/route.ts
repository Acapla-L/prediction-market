import { revalidatePath, revalidateTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/auth-cron'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { fetchPolymarketGammaEventsBySeries } from '@/lib/polymarket/client'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'
import {
  normalizeGamesDiscoveryPayload,
  serializeGamesDiscoveryPayload,
} from '@/lib/polymarket/normalize-games-discovery-payload'

interface SlugSyncResult {
  slug: string
  league: string
  status: 'ok' | 'normalize_skipped' | 'upsert_error' | 'network_error'
  market_count?: number
  error?: string
}

interface DiscoverySyncResult {
  ok: boolean
  disabled?: boolean
  league_count?: number
  events_processed?: number
  events_archived?: number
  results?: SlugSyncResult[]
}

/**
 * Archive stale games whose `is_closed=true` AND `game_start_time` is older
 * than this cutoff. Default 24h preserves recent results for "Final score"
 * UI on the event page; archived rows are excluded from listings but
 * preserved for chart history (sidecar rows are NEVER deleted).
 */
const ARCHIVE_CUTOFF_MS = 24 * 60 * 60 * 1000

/**
 * GET / POST /api/sync/polymarket-games-discovery
 *
 * Per-league discovery sync (Phase B). Triggered hourly by pg_cron at :13.
 * For each enabled league:
 *   1. Polls `GET /events?series_id=<N>&active=true&closed=false&limit=50`
 *   2. Normalizes each per-game event to the per-game payload shape
 *   3. Upserts the row into `discovered_polymarket_games`
 *   4. Calls `revalidateTag(discoveredGame(slug))` + `revalidatePath` per ok
 *
 * After per-league processing, archives any rows whose game ended >24h ago
 * (sets `is_archived=true` — rows are NEVER deleted).
 *
 * Default-off via `POLYMARKET_GAMES_DISCOVERY_ENABLED=false` env var. When
 * disabled, returns `{ ok: true, disabled: true }` immediately without
 * making any external calls.
 */
async function handleGamesDiscoverySync(request: Request): Promise<NextResponse<DiscoverySyncResult | { error: string }>> {
  // Cache Components: opt this route out of static rendering.
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  // Kill switch check — short-circuits before any Polymarket calls. Allows
  // operators to disable Phase B from Vercel env panel without redeploy.
  const flag = (process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED ?? 'false').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const results: SlugSyncResult[] = []
  const successfulSlugs: string[] = []

  for (const league of DISCOVERED_GAMES_LEAGUES) {
    let events: readonly import('@/lib/polymarket/types').PolymarketEvent[] | null
    try {
      events = await fetchPolymarketGammaEventsBySeries(league.seriesId)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      results.push({
        slug: `<league:${league.slug}>`,
        league: league.slug,
        status: 'network_error',
        error: message,
      })
      continue
    }

    if (events === null) {
      results.push({
        slug: `<league:${league.slug}>`,
        league: league.slug,
        status: 'network_error',
        error: 'fetchPolymarketGammaEventsBySeries returned null (transport or schema failure)',
      })
      continue
    }

    for (const event of events) {
      try {
        const normalized = normalizeGamesDiscoveryPayload(event, league.slug)
        if (!normalized) {
          results.push({
            slug: event.slug,
            league: league.slug,
            status: 'normalize_skipped',
          })
          continue
        }

        const upsert = await DiscoveredGamesRepository.upsertSuccess({
          slug: normalized.slug,
          league: normalized.league,
          polymarket_event_id: normalized.polymarket_event_id,
          title: normalized.title,
          home_team_label: normalized.home_team_label,
          away_team_label: normalized.away_team_label,
          game_start_time: normalized.game_start_time,
          is_active: normalized.is_active,
          is_closed: normalized.is_closed,
          end_date: normalized.end_date,
          markets_payload: serializeGamesDiscoveryPayload(normalized.payload),
        })

        if (upsert.error || !upsert.data) {
          await DiscoveredGamesRepository.markFailure({
            slug: normalized.slug,
            status: 'upsert_error',
            error: upsert.error || 'upsert returned no row',
          })
          results.push({
            slug: normalized.slug,
            league: league.slug,
            status: 'upsert_error',
            error: upsert.error || undefined,
          })
          continue
        }

        successfulSlugs.push(normalized.slug)
        results.push({
          slug: normalized.slug,
          league: league.slug,
          status: 'ok',
          market_count: normalized.payload.markets.length,
        })
      }
      catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        await DiscoveredGamesRepository.markFailure({
          slug: event.slug,
          status: 'network_error',
          error: message,
        })
        results.push({
          slug: event.slug,
          league: league.slug,
          status: 'network_error',
          error: message,
        })
      }
    }
  }

  // Archive stale games — closed games whose start time is more than 24h ago.
  // Idempotent: rows already archived are filtered out by the query.
  const cutoff = new Date(Date.now() - ARCHIVE_CUTOFF_MS)
  const archive = await DiscoveredGamesRepository.archiveStaleGames(cutoff)
  const archivedCount = archive.data?.archivedCount ?? 0

  for (const slug of successfulSlugs) {
    revalidateTag(cacheTags.discoveredGame(slug), 'max')
    revalidatePath(`/event/${slug}`)
  }
  if (successfulSlugs.length > 0) {
    revalidateTag(cacheTags.eventsList, 'max')
  }

  return NextResponse.json({
    ok: true,
    league_count: DISCOVERED_GAMES_LEAGUES.length,
    events_processed: results.length,
    events_archived: archivedCount,
    results,
  })
}

export async function GET(request: Request) {
  return handleGamesDiscoverySync(request)
}

export async function POST(request: Request) {
  return handleGamesDiscoverySync(request)
}
