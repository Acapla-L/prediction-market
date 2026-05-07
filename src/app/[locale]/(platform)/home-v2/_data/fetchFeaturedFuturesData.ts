import type { HeroChartEntry } from '@/app/[locale]/(platform)/home-v2/_data/fetchHeroChartData'
import type { SupportedLocale } from '@/i18n/locales'
import type { DiscoveredEventRow } from '@/lib/db/queries/discovered-events'
import type { DiscoveredPolymarketSlug } from '@/lib/polymarket/constants'
import type { Event, Market } from '@/types'
import type { DataPoint } from '@/types/PredictionChartTypes'
import { inArray } from 'drizzle-orm'
import { cacheTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import { discovered_polymarket_events } from '@/lib/db/schema'
import { db } from '@/lib/drizzle'
import { fetchPolymarketPriceHistory } from '@/lib/polymarket/client'
import { POLYMARKET_OVERLAY_SLUGS } from '@/lib/polymarket/constants'
import { buildSyntheticEvent } from '@/lib/polymarket/discovery'
import 'server-only'

/**
 * Hero "featured" slate for Home v2.
 *
 * Replaces the legacy `fetchFeaturedEvents` + `fetchHeroChartData` pair (which
 * pulled top-trending Kuest events backed by Chainlink/Massive oracle feeds —
 * effectively crypto Up-or-Down dailies). The hero now showcases Phase A v2
 * Polymarket discovery futures (NBA Champion, MLB World Series, Stanley Cup,
 * Super Bowl, UCL Winner) with the leading-team probability charted from
 * Polymarket CLOB.
 *
 * Slug selection: Allan-curated deterministic order — the first three of
 * `FEATURED_FUTURES_SLUG_ORDER` whose sidecar row exists, is active, and has at
 * least one tradeable market. This keeps demo storytelling stable across
 * deploys (no surprise carousel reshuffles when one league happens to spike).
 */

// Locked, demo-relevant order. Top 3 are the most universally recognizable to
// the minister + regulators. Sidecar contains 5 active futures; FIFA lives in
// the main events table and is intentionally NOT included in this hero v1
// (deferred to v2 polish — see Step 6 cutover scope).
const FEATURED_FUTURES_SLUG_ORDER: readonly DiscoveredPolymarketSlug[] = [
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  'big-game-champion-2027',
  'uefa-champions-league-winner',
  '2026-nhl-stanley-cup-champion',
]

const FEATURED_COUNT = 3

// Polymarket CLOB caps multi-day windows at 14 days when both startTs+endTs
// supplied (see post-FIFA span-fix memo 2026-05-03). For the hero thumbnail
// we want the most recent ~14 days at chart-friendly granularity. Using `1d`
// interval gives ~14 daily samples which renders cleanly at thumbnail width.
const HISTORY_WINDOW_SECONDS = 14 * 24 * 60 * 60
const HISTORY_INTERVAL = '1d' as const

export interface FeaturedFuturesLeading {
  /** Display label for the leading market (e.g. "OKC Thunder"). */
  label: string
  /** Leading-outcome probability rounded to whole percent. */
  percent: number
  /** Count of OTHER tradeable markets in the event (for the "+N more" pill). */
  otherMarketsCount: number
}

export interface FeaturedFuturesData {
  events: Event[]
  chartData: Record<string, HeroChartEntry>
  leadingByEvent: Record<string, FeaturedFuturesLeading>
}

/**
 * Returns the leading market for an event by highest YES outcome price among
 * tradeable (active, unresolved) markets. Ties broken by `volume` desc, then
 * by stable insertion order.
 */
function pickLeadingMarket(markets: readonly Market[]): Market | null {
  const candidates = markets.filter(m => m.is_active && !m.is_resolved)
  if (candidates.length === 0) {
    return null
  }
  let best = candidates[0]!
  for (const m of candidates.slice(1)) {
    const aPrice = best.price ?? 0
    const bPrice = m.price ?? 0
    if (bPrice > aPrice) {
      best = m
      continue
    }
    if (bPrice === aPrice && (m.volume ?? 0) > (best.volume ?? 0)) {
      best = m
    }
  }
  return best
}

/**
 * Inline list helper. Kept here rather than expanded into the repository
 * surface to minimize cross-agent collisions (A2/A3 didn't extend the repo).
 */
async function listActiveDiscoveryRowsBySlugs(
  slugs: readonly string[],
): Promise<DiscoveredEventRow[]> {
  if (slugs.length === 0) {
    return []
  }
  try {
    const rows = await db
      .select()
      .from(discovered_polymarket_events)
      .where(inArray(discovered_polymarket_events.slug, slugs as string[]))
    return rows.map(entry => ({
      slug: entry.slug,
      polymarketEventId: entry.polymarket_event_id,
      title: entry.title,
      isActive: entry.is_active,
      endDate: entry.end_date ? entry.end_date.toISOString() : null,
      marketsPayload: entry.markets_payload,
      lastSyncedAt: entry.last_synced_at.toISOString(),
      lastSyncStatus: entry.last_sync_status,
      lastSyncError: entry.last_sync_error,
    }))
  }
  catch (err) {
    console.error('[fetchFeaturedFuturesData] sidecar list failed:', err)
    return []
  }
}

/**
 * Re-parse the markets_payload using a duplicated-but-narrow schema would
 * couple us to discovery.ts internals. Instead we use the existing
 * `buildSyntheticEvent` (already exported) which handles parsing internally
 * via its caller path. Since `buildSyntheticEvent` expects a parsed payload,
 * we delegate full row→Event projection to a thin local helper that mirrors
 * `loadDiscoveredEventPageData` minus the cache wrapping.
 */
function rowToSyntheticEvent(row: DiscoveredEventRow): Event | null {
  let raw: unknown
  try {
    raw = JSON.parse(row.marketsPayload)
  }
  catch {
    return null
  }
  // Defensive shape check (full schema validation already done at sync time).
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { markets?: unknown }).markets)) {
    return null
  }
  const payload = raw as Parameters<typeof buildSyntheticEvent>[1]
  const filteredMarkets = payload.markets.filter(m => m.is_active && !m.is_closed)
  if (filteredMarkets.length === 0) {
    return null
  }
  return buildSyntheticEvent(row, { ...payload, markets: filteredMarkets })
}

async function fetchLeadingMarketChart(
  tokenId: string,
): Promise<DataPoint[]> {
  if (!tokenId) {
    return []
  }
  const now = Math.floor(Date.now() / 1000)
  const startTs = now - HISTORY_WINDOW_SECONDS
  try {
    const result = await fetchPolymarketPriceHistory({
      token: tokenId,
      interval: HISTORY_INTERVAL,
      startTs,
      endTs: now,
    })
    if (!result) {
      return []
    }
    return result.history
      .filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p))
      .map(pt => ({
        date: new Date(pt.t * 1000),
        // Chart series key is shared via HeroChartEntry contract — see
        // HomeV2HeroSlide CHART_SERIES_KEY constant ('price').
        price: pt.p,
      }))
  }
  catch (err) {
    console.error('[fetchFeaturedFuturesData] price history fetch failed:', err)
    return []
  }
}

export async function fetchFeaturedFuturesData(
  _locale: SupportedLocale,
): Promise<FeaturedFuturesData> {
  'use cache'
  // Per-slug discovery cache tags so the discovery sync route's
  // `revalidateTag(cacheTags.discoveredEvent(slug))` busts the hero too.
  for (const slug of POLYMARKET_OVERLAY_SLUGS) {
    cacheTag(cacheTags.discoveredEvent(slug))
  }

  const rows = await listActiveDiscoveryRowsBySlugs(FEATURED_FUTURES_SLUG_ORDER)
  const rowsBySlug = new Map(rows.filter(r => r.isActive).map(r => [r.slug, r]))

  // Project in curated order; skip rows missing or with empty markets.
  const events: Event[] = []
  for (const slug of FEATURED_FUTURES_SLUG_ORDER) {
    if (events.length >= FEATURED_COUNT) {
      break
    }
    const row = rowsBySlug.get(slug)
    if (!row) {
      continue
    }
    if (row.lastSyncStatus !== 'ok' && (!row.marketsPayload || row.marketsPayload === '')) {
      continue
    }
    const event = rowToSyntheticEvent(row)
    if (!event) {
      continue
    }
    events.push(event)
  }

  // Per-event chart fetch (Polymarket CLOB) + leading-market label/percent.
  // Fan out in parallel — failures degrade to empty chartData entry; the slide
  // renders the existing skeleton in that case.
  const enriched = await Promise.all(events.map(async (event) => {
    const leadingMarket = pickLeadingMarket(event.markets)
    if (!leadingMarket) {
      return { event, chartEntry: null, leading: null }
    }
    const yesOutcome = leadingMarket.outcomes.find(o => o.outcome_index === 0)
    const tokenId = yesOutcome?.polymarket_token_id ?? yesOutcome?.token_id ?? ''
    const chartData = await fetchLeadingMarketChart(tokenId)
    const chartEntry: HeroChartEntry = {
      eventId: event.id,
      data: chartData,
      lineColor: 'var(--primary)',
    }
    const tradeableCount = event.markets.filter(m => m.is_active && !m.is_resolved).length
    const otherMarketsCount = Math.max(0, tradeableCount - 1)
    const leading: FeaturedFuturesLeading = {
      label: leadingMarket.short_title || leadingMarket.title,
      percent: Math.round(((leadingMarket.price ?? 0)) * 100),
      otherMarketsCount,
    }
    return { event, chartEntry, leading }
  }))

  const chartData: Record<string, HeroChartEntry> = {}
  const leadingByEvent: Record<string, FeaturedFuturesLeading> = {}
  for (const { event, chartEntry, leading } of enriched) {
    if (chartEntry) {
      chartData[event.id] = chartEntry
    }
    if (leading) {
      leadingByEvent[event.id] = leading
    }
  }

  return { events, chartData, leadingByEvent }
}
