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

// Locked, demo-relevant order. The hero surfaces the first 3 eligible slugs
// (see FEATURED_COUNT); slots 4+ are live fallbacks if an earlier slug is
// missing or has ended (see isFeaturedCandidateEnded). NBA / MLB World Series /
// the World Cup are the most universally recognizable to the minister +
// regulators — the World Cup (discovery-sidecar slug 'world-cup-winner') now
// fills slot 3. NHL precedes UCL deliberately: UCL's final has already happened,
// so NHL is the live fallback while UCL is the last resort.
const FEATURED_FUTURES_SLUG_ORDER: readonly DiscoveredPolymarketSlug[] = [
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  'world-cup-winner',
  '2026-nhl-stanley-cup-champion',
  'uefa-champions-league-winner',
]

const FEATURED_COUNT = 3
const TOP_N_OUTCOMES = 4

// 90-day trend window at 6-hour fidelity. Polymarket CLOB rejects any
// [startTs, endTs] window longer than 14 days ("interval is too long"), so to
// exceed that cap we OMIT endTs in `fetchOutcomeHistory` — Polymarket then
// returns startTs → latest. fidelity=360 (6h buckets) yields ~280-320
// samples/series over 90 days (verified live 2026-06-09 for NBA / MLB / World
// Cup top tokens, all created >90d ago) — a richer trend AND a LIGHTER payload
// than the former 14d/fidelity-30 (~669 samples/series). Forward-filled
// downstream by `buildForwardFilledDataPoints`.
const HISTORY_WINDOW_SECONDS = 90 * 24 * 60 * 60
const HISTORY_FIDELITY = 360

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
 * A featured candidate is ineligible once its event has ended — prevents a
 * concluded futures event (e.g. a finished UEFA Champions League whose markets
 * linger before on-chain resolution) from silently filling a hero slot. A null
 * or unparseable endDate is treated as eligible (fail-open — a parse glitch
 * must never blank a hero slot).
 */
export function isFeaturedCandidateEnded(endDateIso: string | null, nowMs: number): boolean {
  if (!endDateIso) {
    return false
  }
  const end = new Date(endDateIso).getTime()
  if (!Number.isFinite(end)) {
    return false
  }
  return end < nowMs
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
      // endTs intentionally omitted: Polymarket caps [startTs, endTs] windows at
      // 14 days; omitting endTs returns startTs → latest, covering the full 90d.
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
 * Forward-fill pivot. Polymarket timestamps each token on its own jittered
 * ~30-min grid, so a union-of-timestamps pivot that only writes exact-match
 * samples leaves ~92% of rows with a single series defined — which
 * PredictionChart's `defined={...}` then renders as hundreds of disconnected
 * fragments. Carrying each series' last-known value into every row (the same
 * approach as the event page's `buildNormalizedHistory`) yields one continuous
 * line per series. A series with no sample yet is simply absent until its first
 * sample (matches the event page).
 */
export function buildForwardFilledDataPoints(
  lookups: ReadonlyArray<{ key: string, map: Map<number, number> }>,
  timestamps: readonly number[],
): DataPoint[] {
  const lastKnown = new Map<string, number>()
  const rows: DataPoint[] = []
  for (const t of timestamps) {
    for (const { key, map } of lookups) {
      const v = map.get(t)
      if (v !== undefined) {
        lastKnown.set(key, v)
      }
    }
    if (lastKnown.size === 0) {
      continue
    }
    const row: DataPoint = { date: new Date(t * 1000) }
    for (const [key, val] of lastKnown) {
      row[key] = val
    }
    rows.push(row)
  }
  return rows
}

/**
 * Fetch top-N outcomes' history in parallel and pivot into a multi-key
 * DataPoint[] keyed on series.key, forward-filled so every row carries each
 * series' last-known value (see `buildForwardFilledDataPoints`). This yields
 * one continuous line per series — Polymarket's per-token timestamp grids are
 * jittered and rarely align, so an exact-match pivot would leave per-series
 * gaps that PredictionChart's `defined={...}` renders as fragmented lines.
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

  // Collect every unique timestamp across all series; the forward-fill pivot
  // below builds one row per timestamp carrying each series' last-known value.
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

  const dataPoints = buildForwardFilledDataPoints(lookups, timestamps)

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
  const nowMs = Date.now()
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
    if (isFeaturedCandidateEnded(row.endDate, nowMs)) {
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
