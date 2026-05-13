import { connection, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/auth-cron'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { fetchPolymarketGammaEvent } from '@/lib/polymarket/client'
import { getLeagueForGameSlug } from '@/lib/polymarket/games-leagues'
import {
  normalizeGamesDiscoveryPayload,
  serializeGamesDiscoveryPayload,
} from '@/lib/polymarket/normalize-games-discovery-payload'

// Long-running cron sync — match the legacy Kuest sync routes' ceiling.
export const maxDuration = 300

interface RefreshSyncResult {
  slug: string
  status: 'ok' | 'gamma_404' | 'normalize_skipped' | 'upsert_error' | 'network_error' | 'unknown_league'
  market_count?: number
  error?: string
}

interface RefreshResponse {
  ok: boolean
  disabled?: boolean
  refreshed?: number
  window_size?: number
  results?: RefreshSyncResult[]
}

/**
 * Per-game refresh window — rows whose `game_start_time` falls between
 * `now - 2h` and `now + 24h` get refreshed every cron tick. This covers:
 *   - Today's games before tipoff (live odds movement)
 *   - In-progress games (live during play)
 *   - Recently-completed games (resolution finalization)
 *   - Tomorrow's early games
 *
 * Anything outside the window is left untouched until the next discovery
 * sync repopulates / archives it.
 */
const WINDOW_PAST_MS = 2 * 60 * 60 * 1000
const WINDOW_FUTURE_MS = 24 * 60 * 60 * 1000

/**
 * GET / POST /api/sync/polymarket-games-refresh
 *
 * Per-game refresh sync (Phase B). Triggered every 5 min by pg_cron. For
 * each row whose `game_start_time` falls inside the active refresh window
 * AND is not archived:
 *   1. Re-fetches `GET /events?slug=<slug>` from Polymarket Gamma
 *   2. Normalizes + upserts (refreshing prices, is_active, is_closed)
 *   3. Calls `revalidateTag(discoveredGame(slug))` + `revalidatePath` per ok
 *
 * Default-off via `POLYMARKET_GAMES_DISCOVERY_ENABLED=false` env var.
 */
async function handleGamesRefreshSync(request: Request): Promise<NextResponse<RefreshResponse | { error: string }>> {
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  const flag = (process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED ?? 'false').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const now = Date.now()
  const windowStart = new Date(now - WINDOW_PAST_MS)
  const windowEnd = new Date(now + WINDOW_FUTURE_MS)

  const windowQuery = await DiscoveredGamesRepository.listInRefreshWindow({
    windowStart,
    windowEnd,
  })

  if (windowQuery.error || !windowQuery.data) {
    return NextResponse.json(
      { error: windowQuery.error || 'Failed to query refresh window.' },
      { status: 500 },
    )
  }

  const rows = windowQuery.data
  const results: RefreshSyncResult[] = []
  const successfulSlugs: string[] = []

  for (const row of rows) {
    const league = getLeagueForGameSlug(row.slug)
    if (!league) {
      // Defensive: a row's slug doesn't match any registered league pattern.
      // Could happen if a league was removed from the registry without
      // archiving the rows; skip rather than fail loudly.
      results.push({ slug: row.slug, status: 'unknown_league' })
      continue
    }

    try {
      const gammaEvent = await fetchPolymarketGammaEvent(row.slug)

      if (!gammaEvent) {
        await DiscoveredGamesRepository.markFailure({
          slug: row.slug,
          status: 'gamma_404',
          error: 'fetchPolymarketGammaEvent returned null (404 / network / Zod failure)',
        })
        results.push({ slug: row.slug, status: 'gamma_404' })
        continue
      }

      const normalized = normalizeGamesDiscoveryPayload(gammaEvent, league.slug)
      if (!normalized) {
        results.push({ slug: row.slug, status: 'normalize_skipped' })
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
          slug: row.slug,
          status: 'upsert_error',
          error: upsert.error || 'upsert returned no row',
        })
        results.push({
          slug: row.slug,
          status: 'upsert_error',
          error: upsert.error || undefined,
        })
        continue
      }

      successfulSlugs.push(normalized.slug)
      results.push({
        slug: normalized.slug,
        status: 'ok',
        market_count: normalized.payload.markets.length,
      })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      await DiscoveredGamesRepository.markFailure({
        slug: row.slug,
        status: 'network_error',
        error: message,
      })
      results.push({ slug: row.slug, status: 'network_error', error: message })
    }
  }

  // Fix F-1 (2026-05-12): this every-5-min route does NOT invalidate any
  // caches. It only writes fresh prices/lifecycle flags into the
  // `discovered_polymarket_games` rows; the next time a cached surface
  // revalidates (via the hourly `polymarket-games-discovery` sync's
  // `revalidateTag(discoveredGame/discoveredGamesList, 'max')` busts, or the
  // function's own `cacheLife` time-based revalidate) it picks up the new
  // values. Previously this route also called `revalidateTag(...,'max')` +
  // `revalidatePath('/event/${slug}')` per refreshed game and
  // `revalidateTag(discoveredGamesList(league),'max')` + per-league
  // `revalidatePath('/en/sports/.../games')` per touched league — every 5
  // minutes. That kept every in-window per-game page and every
  // `/sports/.../games` list page perpetually cold (the `revalidatePath`
  // calls force a blocking re-render; the `revalidateTag(...,'max')` SWR busts
  // mean every visit-after-stale kicks a background revalidation), so an
  // intent-prefetch fan-out (scrolling a card grid → ~25 prefetch RSC renders
  // of cold pages) exhausted the postgres.js pool → the 2026-05-12 cascade.
  // Per-game DETAIL pages still show live prices client-side (CLOB hooks);
  // SSR'd shelf/list-card prices are now ~15-min-to-1-hr fresh — accepted
  // tradeoff. Lifecycle changes (new games, closed games) are picked up by the
  // hourly discovery sync, which retains all its busts.

  return NextResponse.json({
    ok: true,
    refreshed: successfulSlugs.length,
    window_size: rows.length,
    results,
  })
}

export async function GET(request: Request) {
  return handleGamesRefreshSync(request)
}

export async function POST(request: Request) {
  return handleGamesRefreshSync(request)
}
