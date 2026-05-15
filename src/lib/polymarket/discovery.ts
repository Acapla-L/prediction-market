import type { DiscoveredEventRow } from '@/lib/db/queries/discovered-events'
import type { EventPageContentData } from '@/lib/event-page-data'
import type { DiscoveredPolymarketSlug } from '@/lib/polymarket/constants'
import type { DiscoveredMarketsPayload } from '@/lib/polymarket/normalize-discovery-payload'
import type { TeamLogoLookup } from '@/lib/polymarket/team-logo-lookup'
import type { ThemeSiteIdentity } from '@/lib/theme-site-identity'
import type { Event, Market, Outcome } from '@/types'
import { cacheTag } from 'next/cache'
import { z } from 'zod'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import {
  DISCOVERED_POLYMARKET_SLUGS,

} from '@/lib/polymarket/constants'
import { getDiscoveredSlugMetadata } from '@/lib/polymarket/discovered-slugs'
import { buildTeamLogoLookup } from '@/lib/polymarket/team-logo-lookup'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import 'server-only'

const DiscoveredMarketsPayloadSchema = z.object({
  // Optional for backwards compatibility with rows synced before this field
  // was added. Falls back to row.lastSyncedAt in `buildSyntheticEvent` when
  // absent. Next hourly sync overwrites with real Polymarket creation date.
  event_created_at: z.string().optional(),
  markets: z.array(z.object({
    polymarket_market_id: z.string(),
    slug: z.string().nullable(),
    short_title: z.string(),
    is_active: z.boolean(),
    is_closed: z.boolean(),
    outcome_prices: z.tuple([z.string(), z.string()]).nullable(),
    clob_token_ids: z.tuple([z.string(), z.string()]).nullable(),
    volume: z.number().nullable(),
    icon_url: z.string().nullable(),
  })),
})

export const SYNTHETIC_CONDITION_PREFIX = 'polymarket-discovered'

export function buildSyntheticConditionId(slug: string, polymarketMarketId: string): string {
  return `${SYNTHETIC_CONDITION_PREFIX}:${slug}:${polymarketMarketId}`
}

export function isPolymarketDiscoverySlug(slug: string): slug is DiscoveredPolymarketSlug {
  return (DISCOVERED_POLYMARKET_SLUGS as readonly string[]).includes(slug)
}

/**
 * Returns true if the page route may fall through to the discovery sidecar
 * for the given slug. Gated by the POLYMARKET_DISCOVERY_ENABLED env var so
 * the entire feature can be killed without a redeploy.
 */
export function isDiscoveryEnabledForSlug(slug: string): boolean {
  const flag = (process.env.POLYMARKET_DISCOVERY_ENABLED ?? 'true').toLowerCase()
  if (flag === 'false' || flag === '0') {
    return false
  }
  return isPolymarketDiscoverySlug(slug)
}

function parsePayload(serialized: string): DiscoveredMarketsPayload | null {
  let data: unknown
  try {
    data = JSON.parse(serialized)
  }
  catch {
    return null
  }
  const parsed = DiscoveredMarketsPayloadSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

function buildSyntheticOutcome(
  conditionId: string,
  index: 0 | 1,
  tokenId: string,
  price: number | null,
  syncedAtIso: string,
): Outcome {
  return {
    condition_id: conditionId,
    outcome_text: index === 0 ? 'Yes' : 'No',
    outcome_index: index,
    // Both fields point to the SAME polymarket token id — there is no Kuest
    // mirror condition for discovered events. The chart hook routes via the
    // Polymarket proxy because the slug is allowlisted; the proxy keys on
    // `polymarket_token_id`, so `token_id` is set defensively for any
    // Kuest-typed consumer that happens to read it.
    token_id: tokenId,
    polymarket_token_id: tokenId,
    is_winning_outcome: false,
    buy_price: price ?? 0,
    sell_price: price ?? 0,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
  }
}

function buildSyntheticMarket(
  eventId: string,
  slug: string,
  payloadEntry: DiscoveredMarketsPayload['markets'][number],
  syncedAtIso: string,
  endDateIso: string | null,
  teamLookup: TeamLogoLookup | null,
): Market {
  const conditionId = buildSyntheticConditionId(slug, payloadEntry.polymarket_market_id)
  const yesPrice = payloadEntry.outcome_prices ? Number.parseFloat(payloadEntry.outcome_prices[0]) : null
  const noPrice = payloadEntry.outcome_prices ? Number.parseFloat(payloadEntry.outcome_prices[1]) : null
  const yesToken = payloadEntry.clob_token_ids?.[0] ?? ''
  const noToken = payloadEntry.clob_token_ids?.[1] ?? ''
  const volume = payloadEntry.volume ?? 0
  const probability = yesPrice != null ? yesPrice * 100 : 0

  const outcomes: Outcome[] = [
    buildSyntheticOutcome(conditionId, 0, yesToken, yesPrice, syncedAtIso),
    buildSyntheticOutcome(conditionId, 1, noToken, noPrice, syncedAtIso),
  ]

  // Bundle B (futures logos): prefer a per-team logo from `teams_cache` over
  // the Polymarket generic event banner. Polymarket's `/events?slug=X`
  // response returns the same banner for every market on these 5 futures
  // slugs (NBA / NHL / MLB / NFL / UCL Championship). The `/teams?league=X`
  // endpoint has per-team logos; the teams sync cron caches them.
  const teamLogoUrl = teamLookup?.find(payloadEntry.short_title) ?? null

  return {
    condition_id: conditionId,
    question_id: '',
    event_id: eventId,
    title: payloadEntry.short_title,
    slug: payloadEntry.slug ?? payloadEntry.polymarket_market_id,
    short_title: payloadEntry.short_title,
    icon_url: teamLogoUrl ?? payloadEntry.icon_url ?? '',
    is_active: payloadEntry.is_active,
    is_resolved: payloadEntry.is_closed,
    block_number: 0,
    block_timestamp: syncedAtIso,
    volume_24h: 0,
    volume,
    end_time: endDateIso,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
    price: yesPrice ?? 0,
    probability,
    outcomes,
    // All discovered Polymarket events are neg-risk multi-outcome futures by
    // contract — see DISCOVERED_POLYMARKET_SLUGS in lib/polymarket/constants.ts.
    // The flag is read by `resolution-timeline-builder` (cosmetic) and by
    // `EventOrderPanelForm` as fallback for `isNegRiskMarket`. Mirrors the
    // `negRisk: true` value Polymarket Gamma returns for every market on these
    // event types.
    neg_risk: true,
    condition: {
      id: conditionId,
      oracle: SYNTHETIC_CONDITION_PREFIX,
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

export function buildSyntheticEvent(
  row: DiscoveredEventRow,
  payload: DiscoveredMarketsPayload,
  teamLookup: TeamLogoLookup | null = null,
): Event {
  // Synthetic event id namespaced by the discovery prefix to avoid colliding
  // with Kuest's ULID space.
  const eventId = `${SYNTHETIC_CONDITION_PREFIX}:${row.slug}`
  const syncedAtIso = row.lastSyncedAt
  const endDateIso = row.endDate
  const metadata = getDiscoveredSlugMetadata(row.slug)
  const mainTag = metadata?.league ?? 'sports'

  const markets: Market[] = payload.markets.map(entry =>
    buildSyntheticMarket(eventId, row.slug, entry, syncedAtIso, endDateIso, teamLookup),
  )

  const activeCount = markets.filter(m => m.is_active && !m.is_resolved).length
  const totalVolume = markets.reduce((sum, m) => sum + (m.volume ?? 0), 0)
  const status: Event['status'] = activeCount > 0 ? 'active' : 'resolved'
  const firstIcon = markets.find(m => m.icon_url)?.icon_url ?? ''

  // Prefer the Polymarket Gamma event creation timestamp (captured during
  // sync) so the chart's "ALL" range covers full Polymarket history. Falls
  // back to `lastSyncedAt` when the field is absent — case occurs only for
  // rows synced before this fix landed; next hourly sync overwrites them.
  const eventCreatedAt = payload.event_created_at ?? syncedAtIso

  return {
    id: eventId,
    slug: row.slug,
    title: row.title,
    creator: SYNTHETIC_CONDITION_PREFIX,
    icon_url: firstIcon,
    show_market_icons: true,
    status,
    active_markets_count: activeCount,
    total_markets_count: markets.length,
    volume: totalVolume,
    end_date: endDateIso,
    created_at: eventCreatedAt,
    updated_at: syncedAtIso,
    markets,
    tags: [],
    main_tag: mainTag,
    is_bookmarked: false,
    is_trending: false,
    // All discovered Polymarket events are neg-risk multi-outcome futures
    // (winner-take-all over N exclusive teams/clubs) — this is the design
    // contract of the DISCOVERED_POLYMARKET_SLUGS allowlist. Without these
    // flags, EventChart short-circuits at line 1086 (`shouldHideChart`) and
    // renders only meta-info instead of the price-history chart, even though
    // useEventPriceHistory successfully fetches Polymarket data. Mirrors the
    // `enableNegRisk: true` / `negRisk: true` values Polymarket Gamma returns
    // for these event types.
    enable_neg_risk: true,
    neg_risk: true,
  }
}

/**
 * Sidecar loader for discovered Polymarket events. Returns null when the
 * sidecar has no usable row, which the page route surfaces as `notFound()`.
 *
 * Wrapped in `'use cache'` with the per-slug discoveredEvent tag so the sync
 * route's `revalidateTag(cacheTags.discoveredEvent(slug))` busts this output
 * cleanly.
 */
export async function loadDiscoveredEventPageData(slug: string): Promise<EventPageContentData | null> {
  'use cache'
  cacheTag(cacheTags.discoveredEvent(slug))

  const { data: row, error } = await DiscoveredEventsRepository.getBySlug(slug)
  if (error || !row) {
    return null
  }
  if (row.lastSyncStatus !== 'ok' && (!row.marketsPayload || row.marketsPayload === '')) {
    return null
  }

  const rawPayload = parsePayload(row.marketsPayload)
  if (!rawPayload) {
    return null
  }

  // Only show tradeable (in-contention) markets. Eliminated teams have
  // is_closed=true with prices [0, 1]; placeholder slots have is_active=false.
  const payload = {
    ...rawPayload,
    markets: rawPayload.markets.filter(m => m.is_active && !m.is_closed),
  }
  if (payload.markets.length === 0) {
    return null
  }

  // Bundle B (futures logos): when the slug has a registered league with a
  // `teams_cache` league key (currently all 5 day-1 slugs do), preload the
  // league's teams in one DB round-trip and build an in-memory lookup. This
  // gets passed to `buildSyntheticEvent` → `buildSyntheticMarket` so each
  // market's `icon_url` can be overridden with the per-team logo. Pure-
  // synchronous lookups per market; one DB call per page render at the
  // `'use cache'` boundary.
  //
  // The `cacheTag(cacheTags.teamsCache(league))` makes this output get busted
  // when the teams-cache sync route fires `revalidateTag(teamsCache(league))`.
  const metadata = getDiscoveredSlugMetadata(slug)
  let teamLookup: TeamLogoLookup | null = null
  if (metadata) {
    cacheTag(cacheTags.teamsCache(metadata.league))
    const { data: teamRows } = await TeamsCacheRepository.listByLeague(metadata.league)
    if (teamRows && teamRows.length > 0) {
      teamLookup = buildTeamLogoLookup(teamRows, metadata.league)
    }
  }

  const event = buildSyntheticEvent(row, payload, teamLookup)

  return {
    event,
    marketContextEnabled: false,
    changeLogEntries: [],
    seriesEvents: [],
    liveChartConfig: null,
  }
}

export interface DiscoveredEventShellData {
  row: DiscoveredEventRow | null
  site: ThemeSiteIdentity
}

/**
 * Sidecar shell loader for `generateMetadata`. Mirrors `loadEventPageShellData`
 * (event-page-data.ts) for the discovery code path.
 *
 * Why this exists: discovery slugs are NOT in the Kuest events table, so the
 * Kuest path's `loadEventPageShellData` returns `title: null` and
 * `buildEventPageMetadata` calls `notFound()`. That `notFound()` fires from
 * inside `generateMetadata` — Next.js streams it independently via RSC and
 * injects `NEXT_HTTP_ERROR_FALLBACK;404` into the stream after the page has
 * already rendered, flipping a correctly-rendered discovery page to the
 * not-found boundary mid-render (React error #419 hydration mismatch).
 *
 * Wrapped in `'use cache'` with the per-slug discoveredEvent tag (so the sync
 * route's `revalidateTag` busts metadata cleanly) and the settings tag (so
 * site-name changes from the admin panel propagate to discovery metadata).
 * Symmetric with the Kuest path's caching contract.
 */
export async function loadDiscoveredEventShellData(slug: string): Promise<DiscoveredEventShellData> {
  'use cache'
  cacheTag(cacheTags.discoveredEvent(slug))
  cacheTag(cacheTags.settings)

  const [{ data: row }, runtimeTheme] = await Promise.all([
    DiscoveredEventsRepository.getBySlug(slug),
    loadRuntimeThemeState(),
  ])

  return {
    row: row ?? null,
    site: runtimeTheme.site,
  }
}
