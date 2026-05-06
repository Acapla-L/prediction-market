import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import type { EventPageContentData } from '@/lib/event-page-data'
import type { DiscoveredGameMarketsPayload } from '@/lib/polymarket/normalize-games-discovery-payload'
import type { ThemeSiteIdentity } from '@/lib/theme-site-identity'
import type { Event, Market, Outcome } from '@/types'
import { cacheTag } from 'next/cache'
import { z } from 'zod'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { getLeagueForGameSlug, isDiscoveryGameSlug } from '@/lib/polymarket/games-leagues'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import 'server-only'

const DiscoveredGameMarketsPayloadSchema = z.object({
  event_created_at: z.string(),
  game_start_time: z.string(),
  markets: z.array(z.object({
    polymarket_market_id: z.string(),
    slug: z.string(),
    question: z.string(),
    market_type: z.literal('moneyline'),
    outcomes: z.tuple([z.string(), z.string()]).nullable(),
    outcome_prices: z.tuple([z.string(), z.string()]).nullable(),
    clob_token_ids: z.tuple([z.string(), z.string()]).nullable(),
    volume: z.number().nullable(),
    is_active: z.boolean(),
    is_closed: z.boolean(),
    icon_url: z.string().nullable(),
  })),
})

/**
 * Phase B per-game synthetic write-side prefix. The colon is appended by
 * `buildSyntheticGameConditionId`. The matching READ-side prefix lives in
 * `synthetic-prefixes.ts:SYNTHETIC_CONDITION_PREFIXES` and is used by client
 * hooks (useEventMidPrices, useEventLastTrades) to filter synthetic targets.
 */
export const SYNTHETIC_GAME_CONDITION_PREFIX = 'polymarket-discovered-game'

export function buildSyntheticGameConditionId(slug: string, polymarketMarketId: string): string {
  return `${SYNTHETIC_GAME_CONDITION_PREFIX}:${slug}:${polymarketMarketId}`
}

/**
 * Returns true if discovery should attempt the per-game sidecar fallback for
 * `slug`. Gated by `POLYMARKET_GAMES_DISCOVERY_ENABLED` env var (default
 * `'false'` for MVP — explicit opt-in required to enable in production).
 */
export function isGamesDiscoveryEnabledForSlug(slug: string): boolean {
  const flag = (process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED ?? 'false').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return false
  }
  return isDiscoveryGameSlug(slug)
}

function parsePayload(serialized: string): DiscoveredGameMarketsPayload | null {
  let data: unknown
  try {
    data = JSON.parse(serialized)
  }
  catch {
    return null
  }
  const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

function buildSyntheticGameOutcome(
  conditionId: string,
  index: 0 | 1,
  outcomeText: string,
  tokenId: string,
  price: number | null,
  syncedAtIso: string,
): Outcome {
  return {
    condition_id: conditionId,
    outcome_text: outcomeText,
    outcome_index: index,
    // Both fields point to the SAME polymarket token id — there is no Kuest
    // mirror condition for discovered per-game events. Identical pattern to
    // Phase A v2 discovery.ts.
    token_id: tokenId,
    polymarket_token_id: tokenId,
    is_winning_outcome: false,
    buy_price: price ?? 0,
    sell_price: price ?? 0,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
  }
}

function buildSyntheticGameMarket(
  eventId: string,
  slug: string,
  payloadEntry: DiscoveredGameMarketsPayload['markets'][number],
  syncedAtIso: string,
  endDateIso: string | null,
): Market {
  const conditionId = buildSyntheticGameConditionId(slug, payloadEntry.polymarket_market_id)
  const homePrice = payloadEntry.outcome_prices ? Number.parseFloat(payloadEntry.outcome_prices[0]) : null
  const awayPrice = payloadEntry.outcome_prices ? Number.parseFloat(payloadEntry.outcome_prices[1]) : null
  const homeToken = payloadEntry.clob_token_ids?.[0] ?? ''
  const awayToken = payloadEntry.clob_token_ids?.[1] ?? ''
  const homeLabel = payloadEntry.outcomes?.[0] ?? 'Home'
  const awayLabel = payloadEntry.outcomes?.[1] ?? 'Away'
  const volume = payloadEntry.volume ?? 0
  const probability = homePrice != null ? homePrice * 100 : 0

  const outcomes: Outcome[] = [
    buildSyntheticGameOutcome(conditionId, 0, homeLabel, homeToken, homePrice, syncedAtIso),
    buildSyntheticGameOutcome(conditionId, 1, awayLabel, awayToken, awayPrice, syncedAtIso),
  ]

  return {
    condition_id: conditionId,
    question_id: '',
    event_id: eventId,
    title: payloadEntry.question,
    slug: payloadEntry.slug,
    short_title: payloadEntry.question,
    icon_url: payloadEntry.icon_url ?? '',
    is_active: payloadEntry.is_active,
    is_resolved: payloadEntry.is_closed,
    block_number: 0,
    block_timestamp: syncedAtIso,
    volume_24h: 0,
    volume,
    end_time: endDateIso,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
    price: homePrice ?? 0,
    probability,
    outcomes,
    // Per-game IS NOT neg-risk — Polymarket Gamma returns negRisk=false /
    // enableNegRisk=false for these. We mirror that truth. EventChart's
    // shouldHideChart gate at line 388 short-circuits via `isSingleMarket`
    // because the synthetic Event below has `total_markets_count: 1`.
    neg_risk: false,
    condition: {
      id: conditionId,
      oracle: SYNTHETIC_GAME_CONDITION_PREFIX,
      question_id: '',
      outcome_slot_count: 2,
      resolved: payloadEntry.is_closed,
      volume,
      open_interest: 0,
      active_positions_count: 0,
      created_at: syncedAtIso,
      updated_at: syncedAtIso,
    },
  }
}

export function buildSyntheticGameEvent(
  row: DiscoveredGameRow,
  payload: DiscoveredGameMarketsPayload,
): Event {
  const eventId = `${SYNTHETIC_GAME_CONDITION_PREFIX}:${row.slug}`
  const syncedAtIso = row.lastSyncedAt
  const endDateIso = row.endDate
  const league = getLeagueForGameSlug(row.slug)
  const mainTag = league?.mainTag ?? 'sports'

  const markets: Market[] = payload.markets.map(entry =>
    buildSyntheticGameMarket(eventId, row.slug, entry, syncedAtIso, endDateIso),
  )

  const activeCount = markets.filter(m => m.is_active && !m.is_resolved).length
  const totalVolume = markets.reduce((sum, m) => sum + (m.volume ?? 0), 0)
  const status: Event['status'] = activeCount > 0 ? 'active' : 'resolved'
  const firstIcon = markets.find(m => m.icon_url)?.icon_url ?? ''

  return {
    id: eventId,
    slug: row.slug,
    title: row.title,
    creator: SYNTHETIC_GAME_CONDITION_PREFIX,
    icon_url: firstIcon,
    show_market_icons: true,
    status,
    active_markets_count: activeCount,
    // MVP: moneyline-only → exactly 1 market. This satisfies
    // EventChart.shouldHideChart (`isSingleMarket=true`) so the chart renders
    // even though `enable_neg_risk` is undefined for per-game events.
    total_markets_count: markets.length,
    volume: totalVolume,
    end_date: endDateIso,
    created_at: payload.event_created_at,
    updated_at: syncedAtIso,
    markets,
    tags: [],
    main_tag: mainTag,
    is_bookmarked: false,
    is_trending: false,
    // Phase B per-game events are NOT neg-risk multi-outcome futures.
    // `enable_neg_risk` and `neg_risk` are intentionally undefined so the
    // synthetic Event accurately reflects Polymarket Gamma's source data
    // (negRisk: false, enableNegRisk: false for per-game).
  }
}

/**
 * Sidecar loader for Phase B per-game discovery events. Returns null when:
 *   - `POLYMARKET_GAMES_DISCOVERY_ENABLED` flag is off (kill switch)
 *   - No row exists in the per-game sidecar
 *   - Last sync failed AND no prior payload exists
 *   - Payload JSON parse fails
 *   - All markets in payload are filtered out (closed games already pruned
 *     out at the markets-array level — page falls through to 404)
 *
 * Wrapped in `'use cache'` with the per-slug discoveredGame tag so the sync
 * route's `revalidateTag(cacheTags.discoveredGame(slug))` busts cleanly.
 */
export async function loadDiscoveredGamePageData(slug: string): Promise<EventPageContentData | null> {
  'use cache'
  cacheTag(cacheTags.discoveredGame(slug))

  const { data: row, error } = await DiscoveredGamesRepository.getBySlug(slug)
  if (error || !row) {
    return null
  }
  if (row.isArchived) {
    return null
  }
  if (row.lastSyncStatus !== 'ok' && (!row.marketsPayload || row.marketsPayload === '')) {
    return null
  }

  const rawPayload = parsePayload(row.marketsPayload)
  if (!rawPayload) {
    return null
  }

  const payload: DiscoveredGameMarketsPayload = {
    ...rawPayload,
    markets: rawPayload.markets.filter(m => m.is_active),
  }
  if (payload.markets.length === 0) {
    return null
  }

  const event = buildSyntheticGameEvent(row, payload)

  return {
    event,
    marketContextEnabled: false,
    changeLogEntries: [],
    seriesEvents: [],
    liveChartConfig: null,
  }
}

export interface DiscoveredGameShellData {
  row: DiscoveredGameRow | null
  site: ThemeSiteIdentity
}

/**
 * Sidecar shell loader for `generateMetadata`. Mirrors
 * `loadDiscoveredEventShellData` (Phase A v2) for the per-game code path.
 *
 * Why this exists: per-game slugs aren't in the Kuest events table, so the
 * Kuest path's metadata builder calls notFound(). That fires from inside
 * `generateMetadata` and Next.js streams it independently via RSC, injecting
 * `NEXT_HTTP_ERROR_FALLBACK;404` into the stream after the page has rendered
 * with valid synthetic data — flipping a correctly-rendered page to the
 * not-found boundary mid-render (React error #419 hydration mismatch).
 *
 * Wrapped in `'use cache'` with the per-slug discoveredGame tag (so the sync
 * route's `revalidateTag` busts metadata cleanly) and the settings tag (so
 * site-name changes from the admin panel propagate to discovery metadata).
 * Symmetric with the Phase A v2 path.
 */
export async function loadDiscoveredGameShellData(slug: string): Promise<DiscoveredGameShellData> {
  'use cache'
  cacheTag(cacheTags.discoveredGame(slug))
  cacheTag(cacheTags.settings)

  const [{ data: row }, runtimeTheme] = await Promise.all([
    DiscoveredGamesRepository.getBySlug(slug),
    loadRuntimeThemeState(),
  ])

  return {
    row: row ?? null,
    site: runtimeTheme.site,
  }
}
