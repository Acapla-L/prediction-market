import type { Market } from '@/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { OUTCOME_INDEX } from '@/lib/constants'

// Inline constant — MUST NOT import from '@/lib/polymarket/constants' because
// that module transitively carries `'server-only'` concerns (it is imported
// by `fifa-overlay.ts` which imports `client.ts` which imports `server-only`).
// This hook is used by `'use client'` components, so any runtime import from
// the polymarket server chain would break the Turbopack build. Keep in sync
// with `FIFA_EVENT_SLUG` at `platform/src/lib/polymarket/constants.ts`.
const FIFA_EVENT_SLUG_INLINE = '2026-fifa-world-cup-winner-595' as const

export type TimeRange = '1H' | '6H' | '1D' | '1W' | '1M' | 'ALL'

interface PriceHistoryPoint {
  t: number
  p: number
}

interface PriceHistoryResponse {
  history?: PriceHistoryPoint[]
}

export interface MarketTokenTarget {
  conditionId: string
  /**
   * Always the Kuest CLOB `token_id`. Consumed by `useEventMarketQuotes`,
   * `useEventLastTrades`, and `useEventPriceHistory`'s Kuest-CLOB path.
   * MUST NOT be overwritten with a Polymarket token — doing so breaks the
   * shared consumers that POST this into Kuest's `/prices` endpoint.
   */
  tokenId: string
  /**
   * Polymarket CLOB token ID, when the FIFA overlay guard clause in
   * `event-page-data.ts` populated `outcome.polymarket_token_id`. Consumed
   * ONLY by `useEventPriceHistory`'s Polymarket proxy path (see
   * `resolvePriceHistoryEndpoint`). Undefined for non-FIFA events and for
   * FIFA markets that didn't get a matching overlay entry (Revision 4
   * cold-cache fallback).
   */
  polymarketTokenId?: string
}

export interface PriceHistoryEndpoint {
  baseUrl: string
  tokenParamName: 'market' | 'token'
  source: 'kuest-clob' | 'polymarket-proxy'
}

/**
 * Decide which backend to hit for price history based on the parent event's
 * slug and whether any target has a Polymarket token.
 *
 * Rules:
 *   - Non-FIFA event → Kuest CLOB (status quo).
 *   - FIFA event + at least one target with `polymarketTokenId` populated →
 *     our server-side proxy at `/api/polymarket/prices-history`.
 *   - FIFA event + zero polymarket targets (cold-cache fallback per
 *     Revision 4 of the plan) → Kuest CLOB. Preserves the "never worse
 *     than today" invariant when the overlay was empty.
 */
export function resolvePriceHistoryEndpoint(
  eventSlug: string,
  targets: MarketTokenTarget[],
): PriceHistoryEndpoint {
  const hasPolymarketTarget = targets.some(target => target.polymarketTokenId !== undefined)
  const usePolymarketProxy = eventSlug === FIFA_EVENT_SLUG_INLINE && hasPolymarketTarget

  if (usePolymarketProxy) {
    return {
      baseUrl: '/api/polymarket/prices-history',
      tokenParamName: 'token',
      source: 'polymarket-proxy',
    }
  }

  return {
    baseUrl: `${process.env.CLOB_URL!}/prices-history`,
    tokenParamName: 'market',
    source: 'kuest-clob',
  }
}

interface RangeFilters {
  fidelity: string
  interval?: string
  startTs?: string
  endTs?: string
}

type PriceHistoryByMarket = Record<string, PriceHistoryPoint[]>

interface NormalizedHistoryResult {
  points: Array<Record<string, number | Date> & { date: Date }>
  latestSnapshot: Record<string, number>
  latestRawPrices: Record<string, number>
}

const RANGE_CONFIG: Record<Exclude<TimeRange, 'ALL'>, { interval: string, fidelity: number }> = {
  '1H': { interval: '1h', fidelity: 1 },
  '6H': { interval: '6h', fidelity: 1 },
  '1D': { interval: '1d', fidelity: 5 },
  '1W': { interval: '1w', fidelity: 30 },
  '1M': { interval: '1m', fidelity: 180 },
}
const ALL_FIDELITY = 720
const RANGE_WINDOW_SECONDS: Record<Exclude<TimeRange, 'ALL'>, number> = {
  '1H': 60 * 60,
  '6H': 6 * 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
}

export const TIME_RANGES: TimeRange[] = ['1H', '6H', '1D', '1W', '1M', 'ALL']
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const CURSOR_STEP_MS: Record<TimeRange, number> = {
  'ALL': 12 * HOUR_MS,
  '1M': 3 * HOUR_MS,
  '1W': 30 * MINUTE_MS,
  '1D': 5 * MINUTE_MS,
  '6H': MINUTE_MS,
  '1H': MINUTE_MS,
}
const PRICE_REFRESH_INTERVAL_MS = 60_000

function parseResolvedAtSeconds(resolvedAt?: string | null) {
  if (!resolvedAt) {
    return Number.NaN
  }

  const resolved = new Date(resolvedAt)
  const resolvedMs = resolved.getTime()
  if (!Number.isFinite(resolvedMs)) {
    return Number.NaN
  }

  return Math.floor(resolvedMs / 1000)
}

function resolveCreatedRange(createdAt: string, resolvedAt?: string | null) {
  const created = new Date(createdAt)
  const createdSeconds = Number.isFinite(created.getTime())
    ? Math.floor(created.getTime() / 1000)
    : Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 30)
  const realNowSeconds = Math.floor(Date.now() / 1000)
  const resolvedSeconds = parseResolvedAtSeconds(resolvedAt)
  const baseEndSeconds = Number.isFinite(resolvedSeconds)
    ? Math.min(realNowSeconds, resolvedSeconds)
    : realNowSeconds
  const nowSeconds = Math.max(createdSeconds + 60, baseEndSeconds)
  const ageSeconds = Math.max(0, nowSeconds - createdSeconds)
  return { createdSeconds, nowSeconds, ageSeconds }
}

function resolveFidelityForSpan(spanSeconds: number) {
  if (spanSeconds <= 2 * 24 * 60 * 60) {
    return 5
  }
  if (spanSeconds <= 7 * 24 * 60 * 60) {
    return 30
  }
  if (spanSeconds <= 30 * 24 * 60 * 60) {
    return 180
  }
  return ALL_FIDELITY
}

function buildTimeRangeFilters(range: TimeRange, createdAt: string, resolvedAt?: string | null): RangeFilters {
  const resolvedSeconds = parseResolvedAtSeconds(resolvedAt)
  const hasResolvedAnchor = Number.isFinite(resolvedSeconds)
  const { createdSeconds, nowSeconds, ageSeconds } = resolveCreatedRange(createdAt, resolvedAt)

  if (range === 'ALL') {
    return {
      fidelity: resolveFidelityForSpan(ageSeconds).toString(),
      startTs: createdSeconds.toString(),
      endTs: nowSeconds.toString(),
    }
  }

  const config = RANGE_CONFIG[range]
  const windowSeconds = RANGE_WINDOW_SECONDS[range]
  const isLongRange = range === '1D' || range === '1W' || range === '1M'

  // Preserve the previous query shape for active markets because CLOB expects
  // interval-only filters for short ranges.
  if (!hasResolvedAnchor) {
    if (isLongRange && ageSeconds < windowSeconds) {
      return {
        fidelity: resolveFidelityForSpan(ageSeconds).toString(),
        startTs: createdSeconds.toString(),
        endTs: nowSeconds.toString(),
      }
    }

    return {
      fidelity: config.fidelity.toString(),
      interval: config.interval,
    }
  }

  // For resolved markets, anchor non-ALL ranges to the resolution timestamp
  // and avoid mixing interval with explicit time bounds.
  const startSeconds = Math.max(createdSeconds, nowSeconds - windowSeconds)
  const fidelity = isLongRange && ageSeconds < windowSeconds
    ? resolveFidelityForSpan(ageSeconds)
    : config.fidelity

  return {
    fidelity: fidelity.toString(),
    startTs: startSeconds.toString(),
    endTs: nowSeconds.toString(),
  }
}

async function fetchTokenPriceHistory(
  tokenId: string,
  filters: RangeFilters,
  endpoint: PriceHistoryEndpoint,
): Promise<PriceHistoryPoint[]> {
  const searchParams = new URLSearchParams()
  searchParams.set(endpoint.tokenParamName, tokenId)

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, value)
    }
  })

  const url = `${endpoint.baseUrl}?${searchParams.toString()}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch price history')
  }

  const payload = await response.json() as PriceHistoryResponse
  return (payload.history ?? [])
    .map(point => ({
      t: Number(point.t),
      p: Number(point.p),
    }))
    .filter(point => Number.isFinite(point.t) && Number.isFinite(point.p))
}

async function fetchEventPriceHistory(
  eventSlug: string,
  targets: MarketTokenTarget[],
  range: TimeRange,
  eventCreatedAt: string,
  eventResolvedAt?: string | null,
): Promise<PriceHistoryByMarket> {
  if (!targets.length) {
    return {}
  }

  const filters = buildTimeRangeFilters(range, eventCreatedAt, eventResolvedAt)
  const endpoint = resolvePriceHistoryEndpoint(eventSlug, targets)
  const entries = await Promise.all(
    targets.map(async (target) => {
      // Use Polymarket token when routing to the Polymarket proxy, Kuest
      // token otherwise. For mixed batches (some targets without a
      // polymarketTokenId), the polymarket-proxy branch falls back to the
      // Kuest token — the proxy will return an empty `{history: []}` for
      // those, which the chart renders as "no data". Acceptable per
      // Revision 4 fallback semantics.
      const tokenForEndpoint = endpoint.source === 'polymarket-proxy'
        ? (target.polymarketTokenId ?? target.tokenId)
        : target.tokenId
      try {
        const history = await fetchTokenPriceHistory(tokenForEndpoint, filters, endpoint)
        return [target.conditionId, history] as const
      }
      catch {
        return [target.conditionId, []] as const
      }
    }),
  )

  return Object.fromEntries(entries)
}

function clampPrice(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

export function buildNormalizedHistory(historyByMarket: PriceHistoryByMarket): NormalizedHistoryResult {
  const timeline = new Map<number, Map<string, number>>()
  Object.entries(historyByMarket).forEach(([conditionId, history]) => {
    history.forEach((point) => {
      const timestampMs = Math.floor(point.t) * 1000
      if (!timeline.has(timestampMs)) {
        timeline.set(timestampMs, new Map())
      }
      timeline.get(timestampMs)!.set(conditionId, clampPrice(point.p))
    })
  })

  const sortedTimestamps = Array.from(timeline.keys()).sort((a, b) => a - b)
  const lastKnownPrice = new Map<string, number>()
  const points: NormalizedHistoryResult['points'] = []
  const latestRawPrices: Record<string, number> = {}

  sortedTimestamps.forEach((timestamp) => {
    const updates = timeline.get(timestamp)
    updates?.forEach((price, marketKey) => {
      lastKnownPrice.set(marketKey, price)
    })

    if (!lastKnownPrice.size) {
      return
    }

    const point: Record<string, number | Date> & { date: Date } = { date: new Date(timestamp) }

    lastKnownPrice.forEach((price, marketKey) => {
      latestRawPrices[marketKey] = price
      point[marketKey] = price * 100
    })
    points.push(point)
  })

  const latestSnapshot: Record<string, number> = {}
  const latestPoint = points.at(-1)
  if (latestPoint) {
    Object.entries(latestPoint).forEach(([key, value]) => {
      if (key !== 'date' && typeof value === 'number' && Number.isFinite(value)) {
        latestSnapshot[key] = value
      }
    })
  }

  return { points, latestSnapshot, latestRawPrices }
}

function clipNormalizedHistoryToResolvedAt(
  normalized: NormalizedHistoryResult,
  resolvedAt?: string | null,
): NormalizedHistoryResult {
  if (!resolvedAt) {
    return normalized
  }

  const resolvedMs = new Date(resolvedAt).getTime()
  if (!Number.isFinite(resolvedMs)) {
    return normalized
  }

  const clippedPoints = normalized.points.filter(point => point.date.getTime() <= resolvedMs)
  if (clippedPoints.length === normalized.points.length) {
    return normalized
  }

  const clippedLatestSnapshot: Record<string, number> = {}
  const clippedLatestRawPrices: Record<string, number> = {}
  const lastPoint = clippedPoints.at(-1)

  if (lastPoint) {
    Object.entries(lastPoint).forEach(([key, value]) => {
      if (key === 'date' || typeof value !== 'number' || !Number.isFinite(value)) {
        return
      }
      clippedLatestSnapshot[key] = value
      clippedLatestRawPrices[key] = value / 100
    })
  }

  return {
    points: clippedPoints,
    latestSnapshot: clippedLatestSnapshot,
    latestRawPrices: clippedLatestRawPrices,
  }
}

interface UseEventPriceHistoryParams {
  eventId: string
  /**
   * Parent event's slug. Used to decide whether to route the history fetch
   * to the Polymarket proxy (FIFA event only) or to Kuest CLOB (every other
   * event). The slug is not part of the React Query key since `eventId` is
   * 1:1 with the slug in practice.
   */
  eventSlug: string
  range: TimeRange
  targets: MarketTokenTarget[]
  eventCreatedAt: string
  eventResolvedAt?: string | null
}

export function useEventPriceHistory({
  eventId,
  eventSlug,
  range,
  targets,
  eventCreatedAt,
  eventResolvedAt,
}: UseEventPriceHistoryParams) {
  const tokenSignature = useMemo(
    () => targets.map(target => `${target.conditionId}:${target.tokenId}`).sort().join(','),
    [targets],
  )

  const { data: priceHistoryByMarket } = useQuery({
    queryKey: ['event-price-history', eventId, range, tokenSignature, eventResolvedAt ?? ''],
    queryFn: () => fetchEventPriceHistory(eventSlug, targets, range, eventCreatedAt, eventResolvedAt),
    enabled: targets.length > 0,
    staleTime: PRICE_REFRESH_INTERVAL_MS,
    gcTime: PRICE_REFRESH_INTERVAL_MS,
    refetchInterval: PRICE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  })

  const normalizedHistory = useMemo(() => {
    const normalized = buildNormalizedHistory(priceHistoryByMarket ?? {})
    return clipNormalizedHistoryToResolvedAt(normalized, eventResolvedAt)
  }, [priceHistoryByMarket, eventResolvedAt])

  return {
    normalizedHistory: normalizedHistory.points,
    latestSnapshot: normalizedHistory.latestSnapshot,
    latestRawPrices: normalizedHistory.latestRawPrices,
  }
}

export function buildMarketTargets(
  markets: Market[],
  outcomeIndex: typeof OUTCOME_INDEX.YES | typeof OUTCOME_INDEX.NO = OUTCOME_INDEX.YES,
): MarketTokenTarget[] {
  return markets
    .map((market): MarketTokenTarget | null => {
      const matchingOutcome = market.outcomes.find(outcome => outcome.outcome_index === outcomeIndex)
        ?? market.outcomes[0]
      if (!matchingOutcome?.token_id) {
        return null
      }
      // `tokenId` is ALWAYS the Kuest token — it is consumed by
      // `useEventMarketQuotes` and `useEventLastTrades` which POST it to
      // Kuest's `/prices` endpoint. Overwriting with the Polymarket token
      // caused a 404 cascade for FIFA in production (session 026). The
      // Polymarket token rides along as `polymarketTokenId` and is only
      // read by the chart hook when routing to the Polymarket proxy.
      const target: MarketTokenTarget = {
        conditionId: market.condition_id,
        tokenId: matchingOutcome.token_id,
      }
      if (matchingOutcome.polymarket_token_id) {
        target.polymarketTokenId = matchingOutcome.polymarket_token_id
      }
      return target
    })
    .filter((target): target is MarketTokenTarget => target !== null)
}
