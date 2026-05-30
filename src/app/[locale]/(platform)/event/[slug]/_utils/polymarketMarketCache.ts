import type { QueryClient } from '@tanstack/react-query'
import type { MarketQuote, MarketQuotesByMarket } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import type { OrderbookLevelSummary, OrderBookSummariesResponse } from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'
// platform/src/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache.ts
import type { Market } from '@/types'

const YES_OUTCOME_INDEX = 0

export interface YesTokenMapping {
  tokenIds: string[]
  tokenIdToConditionId: Map<string, string>
}

export function buildYesTokenMapping(markets: Market[]): YesTokenMapping {
  const tokenIdToConditionId = new Map<string, string>()
  const seen = new Set<string>()
  const tokenIds: string[] = []

  for (const market of markets) {
    if (!market?.condition_id || market.is_active === false || market.is_resolved === true) {
      continue
    }
    const yes = market.outcomes?.find(o => o.outcome_index === YES_OUTCOME_INDEX)
    const tokenId = yes?.polymarket_token_id ? String(yes.polymarket_token_id) : null
    if (!tokenId || seen.has(tokenId)) {
      continue
    }
    seen.add(tokenId)
    tokenIds.push(tokenId)
    tokenIdToConditionId.set(tokenId, market.condition_id)
  }
  return { tokenIds, tokenIdToConditionId }
}

// ---------------------------------------------------------------------------
// Cache writers — mirrors the pure logic in EventMarketChannelProvider.tsx
// (adapted for standalone use so the Polymarket WS unit is self-contained)
// ---------------------------------------------------------------------------

function normalizePrice(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return null
  }
  if (parsed < 0) {
    return 0
  }
  if (parsed > 1) {
    return 1
  }
  return parsed
}

function resolveQuote(bestBid: unknown, bestAsk: unknown): MarketQuote {
  const bid = normalizePrice(bestBid)
  const ask = normalizePrice(bestAsk)
  const mid = bid != null && ask != null ? (bid + ask) / 2 : (ask ?? bid ?? null)
  return { bid, ask, mid }
}

function coerceBookLevels(value: unknown): OrderbookLevelSummary[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((e) => {
      if (!e || typeof e !== 'object') {
        return null
      }
      const price = (e as { price?: unknown }).price
      const size = (e as { size?: unknown }).size
      if (typeof price !== 'string' || typeof size !== 'string') {
        return null
      }
      return { price, size }
    })
    .filter((e): e is OrderbookLevelSummary => e !== null)
}

function updateOrderBookCaches(
  qc: QueryClient,
  tokenId: string,
  updater: (c: OrderBookSummariesResponse | undefined) => OrderBookSummariesResponse,
) {
  qc.getQueryCache().findAll({ queryKey: ['orderbook-summary'] }).forEach((query) => {
    const key = typeof query.queryKey[1] === 'string' ? query.queryKey[1] : ''
    if (!key.split(',').includes(tokenId)) {
      return
    }
    qc.setQueryData<OrderBookSummariesResponse>(query.queryKey, updater)
  })
}

function updateQuoteCaches(qc: QueryClient, conditionId: string, tokenId: string, quote: MarketQuote) {
  const signature = `${conditionId}:${tokenId}`
  qc.getQueryCache().findAll({ queryKey: ['event-market-quotes'] }).forEach((query) => {
    const sig = typeof query.queryKey[1] === 'string' ? query.queryKey[1] : ''
    if (!sig.includes(signature)) {
      return
    }
    qc.setQueryData<MarketQuotesByMarket>(query.queryKey, (current) => {
      const existing = current ?? {}
      const prev = existing[conditionId]
      if (prev && prev.bid === quote.bid && prev.ask === quote.ask && prev.mid === quote.mid) {
        return existing
      }
      return { ...existing, [conditionId]: quote }
    })
  })
}

/**
 * Route one parsed Polymarket WS payload into the React Query caches
 * `['orderbook-summary']` and `['event-market-quotes']`.
 *
 * Pure / side-effect-free outside of QueryClient mutations — safe to call
 * from tests without a React rendering context.
 */
export function applyPolymarketMessage(qc: QueryClient, mapping: YesTokenMapping, payload: any): void {
  if (!payload || typeof payload !== 'object') {
    return
  }
  const tokenId = String(payload.asset_id ?? '')
  switch (payload.event_type) {
    case 'book': {
      if (!tokenId) {
        return
      }
      updateOrderBookCaches(qc, tokenId, (current) => {
        const existing = current ?? {}
        const prev = existing[tokenId]
        return {
          ...existing,
          [tokenId]: {
            bids: coerceBookLevels(payload.bids),
            asks: coerceBookLevels(payload.asks),
            last_trade_price: prev?.last_trade_price,
            last_trade_side: prev?.last_trade_side,
          },
        }
      })
      return
    }
    case 'price_change': {
      const changes = Array.isArray(payload.price_changes) ? payload.price_changes : []
      for (const c of changes) {
        const cid = mapping.tokenIdToConditionId.get(String(c.asset_id ?? ''))
        if (cid) {
          updateQuoteCaches(qc, cid, String(c.asset_id), resolveQuote(c.best_bid, c.best_ask))
        }
      }
      return
    }
    case 'best_bid_ask': {
      const cid = mapping.tokenIdToConditionId.get(tokenId)
      if (cid) {
        updateQuoteCaches(qc, cid, tokenId, resolveQuote(payload.best_bid, payload.best_ask))
      }
      return
    }
    case 'last_trade_price': {
      if (!tokenId) {
        return
      }
      updateOrderBookCaches(qc, tokenId, (current) => {
        const existing = current ?? {}
        const prev = existing[tokenId]
        const price = typeof payload.price === 'string' ? payload.price : String(payload.price ?? '')
        const side = payload.side === 'BUY' || payload.side === 'SELL' ? payload.side : undefined
        return {
          ...existing,
          [tokenId]: {
            bids: prev?.bids ?? [],
            asks: prev?.asks ?? [],
            last_trade_price: price || prev?.last_trade_price,
            last_trade_side: side ?? prev?.last_trade_side,
          },
        }
      })
    }
    // no default — unknown event types are silently ignored
  }
}
