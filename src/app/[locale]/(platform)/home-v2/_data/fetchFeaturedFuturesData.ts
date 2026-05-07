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
 * Hero "featured" slate for Home v2 — multi-line variant.
 *
 * Replaces the legacy single-line leading-outcome chart with a Polymarket-style
 * multi-line chart showing the TOP 4 outcomes per event. Mirrors the visual
 * pattern used on the production /event/2026-nba-champion page (4 colored
 * lines + per-outcome label/percent header).
 *
 * Selection: top 4 ACTIVE markets per event sorted by current YES price desc.
 * Fetches Polymarket CLOB price history per outcome in parallel; pivots into
 * a single DataPoint[] keyed by polymarket_market_id (or condition_id fallback)
 * so PredictionChart can render N lines off the same x-axis.
 */

// Locked, demo-relevant order. Top 3 are the most universally recognizable to
// the minister + regulators. Sidecar contains 5 active futures; FIFA lives in
// the main events table and is intentionally NOT included in this hero v1.
const FEATURED_FUTURES_SLUG_ORDER: readonly DiscoveredPolymarketSlug[] = [
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  'big-game-champion-2027',
  'uefa-champions-league-winner',
  '2026-nhl-stanley-cup-champion',
]

const FEATURED_COUNT = 3
const TOP_N_OUTCOMES = 4

// Polymarket CLOB caps multi-day windows at 14 days when both startTs+endTs
// supplied (post-FIFA span-fix memo 2026-05-03). 14 days is exactly the cap,
// so endTs is allowed. fidelity=30 matches `useEventPriceHistory.ts`'s
// `resolveFidelityForSpan` for spans in (7, 30] day range.
const HISTORY_WINDOW_SECONDS = 14 * 24 * 60 * 60
const HISTORY_FIDELITY = 30

// Top-4 chart colors — matches production /event chart palette.
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
] as const

export interface HeroSeriesEntry {
  /** Stable key — polymarket_market_id when available, else condition_id. */
  key: string
  /** Display label (team name / outcome short_title). */
  label: string
  /** CSS color token (var(--chart-1) … var(--chart-4)). */
  color: string
  /** Current YES price as whole-percent integer (for the header row). */
  currentPercent: number
}

export interface HeroChartConfig {
  /** Pivoted multi-series rows: { date, [seriesKey]: percent, … }. */
  dataPoints: DataPoint[]
  /** Series metadata for PredictionChart + the header label row. */
  series: HeroSeriesEntry[]
}

export interface FeaturedFuturesData {
  events: Event[]
  /** Per-event chart config. Missing entry => slide renders skeleton. */
  chartDataByEvent: Record<string, HeroChartConfig>
}

/**
 * Top-N markets by current YES price descending. Filters to active markets;
 * ties broken by `volume` desc, then by stable insertion order.
 */
function pickTopNMarkets(markets: readonly Market[], n: number): Market[] {
  const candidates = markets.filter(m => m.is_active && !m.is_resolved)
  const sorted = [...candidates].sort((a, b) => {
    const aPrice = a.price ?? 0
    const bPrice = b.price ?? 0
    if (bPrice !== aPrice) {
      return bPrice - aPrice
    }
    return (b.volume ?? 0) - (a.volume ?? 0)
  })
  return sorted.slice(0, n)
}

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

function rowToSyntheticEvent(row: DiscoveredEventRow): Event | null {
  let raw: unknown
  try {
    raw = JSON.parse(row.marketsPayload)
  }
  catch {
    return null
  }
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

interface OutcomeSeriesFetch {
  market: Market
  /** YES outcome's polymarket token id (preferred) or token_id. */
  tokenId: string
  /** Stable series key. */
  key: string
}

function buildOutcomeFetches(markets: Market[]): OutcomeSeriesFetch[] {
  const fetches: OutcomeSeriesFetch[] = []
  for (const market of markets) {
    const yesOutcome = market.outcomes.find(o => o.outcome_index === 0)
    const tokenId = yesOutcome?.polymarket_token_id ?? yesOutcome?.token_id ?? ''
    if (!tokenId) {
      continue
    }
    // condition_id is namespaced (polymarket-discovered:<slug>:<market_id>)
    // and unique per outcome — sufficient as a stable series key.
    const key = market.condition_id
    fetches.push({ market, tokenId, key })
  }
  return fetches
}

async function fetchOutcomeHistory(
  tokenId: string,
): Promise<Array<{ t: number, p: number }> | null> {
  const now = Math.floor(Date.now() / 1000)
  const startTs = now - HISTORY_WINDOW_SECONDS
  try {
    const result = await fetchPolymarketPriceHistory({
      token: tokenId,
      fidelity: HISTORY_FIDELITY,
      startTs,
      endTs: now,
    })
    if (!result) {
      return null
    }
    return result.history.filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p))
  }
  catch (err) {
    console.error('[fetchFeaturedFuturesData] outcome chart failed', { tokenId, err })
    return null
  }
}

/**
 * Fetch top-N outcomes' history in parallel and pivot into a multi-key
 * DataPoint[] keyed on series.key. Each unique timestamp → one row with all
 * available series values. Missing values are simply omitted from that row
 * (PredictionChart's per-series scale handles undefined gracefully via
 * its bisector + value lookup).
 */
async function fetchTopOutcomesChart(
  markets: Market[],
  slug: string,
): Promise<HeroChartConfig | null> {
  const fetches = buildOutcomeFetches(markets)
  if (fetches.length === 0) {
    return null
  }

  const histories = await Promise.all(
    fetches.map(async (f) => {
      const history = await fetchOutcomeHistory(f.tokenId)
      if (!history || history.length === 0) {
        console.warn('[fetchFeaturedFuturesData] outcome chart empty', { slug, key: f.key })
        return null
      }
      return { fetch: f, history }
    }),
  )

  const successful = histories.filter((h): h is NonNullable<typeof h> => h !== null)
  if (successful.length === 0) {
    return null
  }

  // Pivot: collect every unique timestamp, then for each timestamp build a row
  // populated with every series that has a sample at that exact timestamp.
  const timestampSet = new Set<number>()
  for (const { history } of successful) {
    for (const pt of history) {
      timestampSet.add(pt.t)
    }
  }
  const timestamps = [...timestampSet].sort((a, b) => a - b)

  // Per-series timestamp → percent lookup for fast pivot.
  const lookups = successful.map(({ fetch, history }) => {
    const map = new Map<number, number>()
    for (const pt of history) {
      // Polymarket prices are 0..1 probabilities; chart shows percent.
      map.set(pt.t, pt.p * 100)
    }
    return { key: fetch.key, map }
  })

  const dataPoints: DataPoint[] = timestamps.map((t) => {
    const row: DataPoint = { date: new Date(t * 1000) }
    for (const { key, map } of lookups) {
      const v = map.get(t)
      if (v !== undefined) {
        row[key] = v
      }
    }
    return row
  })

  // Series metadata in stable order matching `successful` ordering (which
  // mirrors top-N market order by YES price desc).
  const series: HeroSeriesEntry[] = successful.map(({ fetch }, idx) => ({
    key: fetch.key,
    label: fetch.market.short_title || fetch.market.title,
    color: SERIES_COLORS[idx % SERIES_COLORS.length]!,
    currentPercent: Math.round((fetch.market.price ?? 0) * 100),
  }))

  return { dataPoints, series }
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
  const eventToSlug = new Map<string, string>()
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
    eventToSlug.set(event.id, slug)
  }

  // Per-event multi-line chart fetch. Failures degrade to omitted entry; the
  // slide renders the existing skeleton when chartDataByEvent[event.id] is
  // undefined.
  const enriched = await Promise.all(events.map(async (event) => {
    const topMarkets = pickTopNMarkets(event.markets, TOP_N_OUTCOMES)
    if (topMarkets.length === 0) {
      return { eventId: event.id, config: null }
    }
    const slug = eventToSlug.get(event.id) ?? event.slug
    const config = await fetchTopOutcomesChart(topMarkets, slug)
    return { eventId: event.id, config }
  }))

  const chartDataByEvent: Record<string, HeroChartConfig> = {}
  for (const { eventId, config } of enriched) {
    if (config) {
      chartDataByEvent[eventId] = config
    }
  }

  return { events, chartDataByEvent }
}
