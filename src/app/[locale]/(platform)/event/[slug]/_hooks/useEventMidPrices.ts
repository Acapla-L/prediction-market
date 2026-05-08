import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { normalizeClobMarketPrice } from '@/lib/clob-price'
import { isSyntheticConditionId } from '@/lib/polymarket/synthetic-prefixes'

interface PriceApiResponse {
  [tokenId: string]: { BUY?: string, SELL?: string } | undefined
}

interface MidpointsApiResponse {
  [tokenId: string]: string | undefined
}

export interface MarketQuote {
  bid: number | null
  ask: number | null
  mid: number | null
}

export type MarketQuotesByMarket = Record<string, MarketQuote>

const PRICE_REFRESH_INTERVAL_MS = 60_000
const CLOB_BASE_URL = process.env.CLOB_URL

// Stream 2 (Phase B v2 v3) Bug C fix (2026-05-08): Kuest CLOB caps batched
// POSTs at 500 items per request — sending more returns HTTP 400. Sports
// list pages routinely exceed the cap (~50 games × multi-market × 2
// outcomes ~= 500+ tokens). Chunk at 400 (defensive margin) and Promise.all
// the resulting batches. Mirrors the chunking pattern in useEventLastTrades.
const CLOB_BATCH_LIMIT = 400

function chunkTokenObjects(tokenIds: string[]): { token_id: string }[][] {
  const chunks: { token_id: string }[][] = []
  for (let i = 0; i < tokenIds.length; i += CLOB_BATCH_LIMIT) {
    chunks.push(tokenIds.slice(i, i + CLOB_BATCH_LIMIT).map(token_id => ({ token_id })))
  }
  return chunks
}

async function fetchPricesChunk(chunk: { token_id: string }[]): Promise<PriceApiResponse> {
  // Per-chunk graceful fallback. A single failed chunk degrades to empty
  // (callers fall back to bid/ask=null) instead of unmounting the list.
  try {
    const response = await fetch(`${CLOB_BASE_URL}/prices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    })
    if (!response.ok) {
      console.warn(`prices chunk failed (${response.status} ${response.statusText}); chunk size=${chunk.length}`)
      return {}
    }
    return await response.json() as PriceApiResponse
  }
  catch (err) {
    console.warn('prices chunk threw', err)
    return {}
  }
}

async function fetchMidpointsChunk(chunk: { token_id: string }[]): Promise<MidpointsApiResponse> {
  try {
    const response = await fetch(`${CLOB_BASE_URL}/midpoints`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    })
    if (!response.ok) {
      // Midpoints endpoint legitimately 404s for tokens with no liquidity
      // (Phase B v2 ports the upstream batched-midpoints contract from
      // Kuest PR #957). Suppress noisy warnings for 404; warn on others.
      if (response.status !== 404) {
        console.warn(`midpoints chunk failed (${response.status} ${response.statusText}); chunk size=${chunk.length}`)
      }
      return {}
    }
    return await response.json() as MidpointsApiResponse
  }
  catch (err) {
    console.warn('midpoints chunk threw', err)
    return {}
  }
}

// Synthetic condition_ids minted by the Polymarket discovery layer
// (Phase A v2 futures: `polymarket-discovered:`; Phase B per-game:
// `polymarket-discovered-game:`). These are NOT valid Kuest CLOB tokens —
// POSTing them to /prices or /midpoints returns 404. Filter them out at the
// hook layer to avoid console noise + nonfunctional real-time subscriptions
// for discovery events. Imported from `synthetic-prefixes.ts` (no `server-only`
// chain) so server and client share a single source of truth.
function isSyntheticTarget(target: MarketTokenTarget): boolean {
  return isSyntheticConditionId(target.conditionId)
}

function normalizePrice(value: string | number | undefined | null) {
  return normalizeClobMarketPrice(value)
}

function resolveQuote(
  priceBySide: { BUY?: string, SELL?: string } | undefined,
  midpoint: number | null,
): MarketQuote {
  // CLOB /prices returns BUY as best ask and SELL as best bid for the token.
  const ask = normalizePrice(priceBySide?.BUY)
  const bid = normalizePrice(priceBySide?.SELL)
  const normalizedMidpoint = normalizePrice(midpoint)
  const mid = bid != null && ask != null
    ? (normalizedMidpoint ?? (bid + ask) / 2)
    : (normalizedMidpoint ?? ask ?? bid ?? null)

  return { bid, ask, mid }
}

export async function fetchQuotesByMarket(targets: MarketTokenTarget[]): Promise<MarketQuotesByMarket> {
  // Skip synthetic discovery targets — their condition_ids are namespaced
  // placeholders (no Kuest CLOB liquidity exists for them).
  const kuestTargets = targets.filter(target => !isSyntheticTarget(target))

  const uniqueTokenIds = Array.from(
    new Set(kuestTargets.map(target => target.tokenId).filter(Boolean)),
  )

  if (!uniqueTokenIds.length) {
    return {}
  }

  if (!CLOB_BASE_URL) {
    throw new Error('CLOB URL is not configured.')
  }

  // Stream 2 (Phase B v2 v3) Bug C fix: chunk into ≤ CLOB_BATCH_LIMIT batches
  // for both /prices and /midpoints; merge results. Per-chunk failures
  // degrade to empty result (caller falls back to bid/ask=null).
  const chunks = chunkTokenObjects(uniqueTokenIds)
  const [priceResults, midpointResults] = await Promise.all([
    Promise.all(chunks.map(chunk => fetchPricesChunk(chunk))),
    Promise.all(chunks.map(chunk => fetchMidpointsChunk(chunk))),
  ])

  // Merge per-chunk maps into single lookups.
  const data: PriceApiResponse = Object.assign({}, ...priceResults)
  const midpointsData: MidpointsApiResponse = Object.assign({}, ...midpointResults)

  const quotesByToken = new Map<string, MarketQuote>()

  uniqueTokenIds.forEach((tokenId) => {
    const midpoint = normalizePrice(midpointsData[tokenId])
    quotesByToken.set(tokenId, resolveQuote(data?.[tokenId], midpoint))
  })

  return kuestTargets.reduce<MarketQuotesByMarket>((acc, target) => {
    const quote = quotesByToken.get(target.tokenId)
    if (quote) {
      acc[target.conditionId] = quote
    }
    return acc
  }, {})
}

interface UseEventMarketQuotesOptions {
  enabled?: boolean
  refetchIntervalMs?: number | false
}

export function useEventMarketQuotes(targets: MarketTokenTarget[], options: UseEventMarketQuotesOptions = {}) {
  const {
    enabled = true,
    refetchIntervalMs = PRICE_REFRESH_INTERVAL_MS,
  } = options

  const tokenSignature = useMemo(
    () => targets.map(target => `${target.conditionId}:${target.tokenId}`).sort().join(','),
    [targets],
  )

  const { data } = useQuery({
    queryKey: ['event-market-quotes', tokenSignature],
    queryFn: () => fetchQuotesByMarket(targets),
    enabled: enabled && targets.length > 0,
    staleTime: 'static',
    gcTime: PRICE_REFRESH_INTERVAL_MS,
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
    retry: false,
  })

  return data ?? {}
}
