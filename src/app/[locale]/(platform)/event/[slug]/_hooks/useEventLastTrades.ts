import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { LastTradePriceEntry } from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { normalizeClobMarketPrice } from '@/lib/clob-price'
import { isSyntheticConditionId } from '@/lib/polymarket/synthetic-prefixes'

const CLOB_BASE_URL = process.env.CLOB_URL
const LAST_TRADE_REFRESH_INTERVAL_MS = 60_000

// Stream 2 (Phase B v2 v3) Bug C fix (2026-05-08): Kuest CLOB caps batched
// POSTs at 500 items per request — sending more returns HTTP 400
// `{"error":"maximum of 500 items allowed"}` and (pre-fix) cascaded into
// React error #418, leaving the entire sports list page with empty content.
// Sports list pages routinely exceed the cap (~50 games × 5 markets × 2
// outcomes ~= 500+ tokens). We chunk at 400 (defensive margin against
// off-by-one boundary) and Promise.all the resulting batches.
const CLOB_BATCH_LIMIT = 400

function chunkTokenIds(tokenIds: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < tokenIds.length; i += CLOB_BATCH_LIMIT) {
    chunks.push(tokenIds.slice(i, i + CLOB_BATCH_LIMIT))
  }
  return chunks
}

// Synthetic condition_ids minted by the Polymarket discovery layer
// (Phase A v2 futures: `polymarket-discovered:`; Phase B per-game:
// `polymarket-discovered-game:`). Filter them out so we don't POST invalid
// token_ids to Kuest's /last-trades-prices. Imported from
// `synthetic-prefixes.ts` (no `server-only` chain) so server and client share
// a single source of truth.
function isSyntheticTarget(target: MarketTokenTarget): boolean {
  return isSyntheticConditionId(target.conditionId)
}

function normalizePrice(value: string | undefined) {
  return normalizeClobMarketPrice(value)
}

async function fetchLastTradesChunk(tokenIds: string[]): Promise<LastTradePriceEntry[]> {
  // Per-chunk fetch — failures degrade gracefully (return []), so a single
  // bad chunk does not blank the whole sports list. The hook's react-query
  // wrapping retains the previous good payload via `keepPreviousData`.
  try {
    const response = await fetch(`${CLOB_BASE_URL}/last-trades-prices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tokenIds.map(tokenId => ({ token_id: tokenId }))),
    })
    if (!response.ok) {
      console.warn(`last-trades-prices chunk failed (${response.status} ${response.statusText}); chunk size=${tokenIds.length}`)
      return []
    }
    return await response.json() as LastTradePriceEntry[]
  }
  catch (err) {
    console.warn('last-trades-prices chunk threw', err)
    return []
  }
}

async function fetchLastTradesByMarket(targets: MarketTokenTarget[]) {
  const kuestTargets = targets.filter(target => !isSyntheticTarget(target))
  const uniqueTokenIds = Array.from(new Set(kuestTargets.map(target => target.tokenId).filter(Boolean)))

  if (!uniqueTokenIds.length) {
    return {}
  }

  if (!CLOB_BASE_URL) {
    throw new Error('CLOB URL is not configured.')
  }

  // Chunk into ≤ CLOB_BATCH_LIMIT batches; merge entries.
  const chunks = chunkTokenIds(uniqueTokenIds)
  const chunkResults = await Promise.all(chunks.map(chunk => fetchLastTradesChunk(chunk)))
  const payload: LastTradePriceEntry[] = chunkResults.flat()

  const lastTradesByToken = new Map<string, number>()

  payload.forEach((entry) => {
    const normalized = normalizePrice(entry?.price)
    if (normalized != null && entry?.token_id) {
      lastTradesByToken.set(entry.token_id, normalized)
    }
  })

  return kuestTargets.reduce<Record<string, number>>((acc, target) => {
    const lastTrade = lastTradesByToken.get(target.tokenId)
    if (lastTrade != null) {
      acc[target.conditionId] = lastTrade
    }
    return acc
  }, {})
}

export function useEventLastTrades(targets: MarketTokenTarget[]) {
  const tokenSignature = useMemo(
    () => targets.map(target => `${target.conditionId}:${target.tokenId}`).sort().join(','),
    [targets],
  )

  const { data } = useQuery({
    queryKey: ['event-last-trades', tokenSignature],
    queryFn: () => fetchLastTradesByMarket(targets),
    enabled: targets.length > 0,
    staleTime: 'static',
    gcTime: LAST_TRADE_REFRESH_INTERVAL_MS,
    refetchInterval: LAST_TRADE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  })

  return data ?? {}
}
