import type {
  ClobOrderbookSummary,
  LastTradePriceEntry,
  OrderBookLevel,
  OrderbookLevelSummary,
  OrderBookSnapshot,
  OrderBookSummariesResponse,
  OrderBookSummaryResponse,
} from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'
import type { Market, Outcome } from '@/types'
import { fetchClobJson, getRoundedCents } from '@/lib/clob'
import { MICRO_UNIT, OUTCOME_INDEX } from '@/lib/constants'
import { formatCentsLabel, formatSharesLabel, toCents } from '@/lib/formatters'

const DEFAULT_MAX_LEVELS = 12

// PR #22 B3 (2026-05-13): Kuest CLOB caps batched POSTs at 500 items per
// request. The homepage's order-panel call site has been observed posting
// 878 tokens in a single batch → HTTP 400 `{"error":"maximum of 500 items
// allowed"}` on BOTH `/books` and `/last-trades-prices`. PR #18 fixed the
// same class of bug in `useEventLastTrades.ts` + `useEventMidPrices.ts`
// (the `_hooks/` directory) but missed this third call site under `_utils/`.
// Mirror the same pattern: chunk at 400 (defensive margin below the 500 cap),
// `Promise.all` the chunks, per-chunk graceful fallback so a single failure
// degrades to an empty array for that chunk rather than nulling the whole
// call. Output `OrderBookSummariesResponse` shape is byte-identical.
const CLOB_BATCH_LIMIT = 400

function chunkTokenIds(tokenIds: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < tokenIds.length; i += CLOB_BATCH_LIMIT) {
    chunks.push(tokenIds.slice(i, i + CLOB_BATCH_LIMIT))
  }
  return chunks
}

async function fetchOrderbookChunk(chunk: string[]): Promise<ClobOrderbookSummary[]> {
  const payload = chunk.map(tokenId => ({ token_id: tokenId }))
  try {
    const result = await fetchClobJson<ClobOrderbookSummary[]>('/books', payload)
    if (!Array.isArray(result)) {
      console.warn(`/books chunk returned non-array (size=${chunk.length}); coercing to []`)
      return []
    }
    return result
  }
  catch (err) {
    console.warn(`/books chunk failed (size=${chunk.length})`, err)
    return []
  }
}

async function fetchLastTradesChunk(chunk: string[]): Promise<LastTradePriceEntry[]> {
  const payload = chunk.map(tokenId => ({ token_id: tokenId }))
  try {
    const result = await fetchClobJson<LastTradePriceEntry[]>('/last-trades-prices', payload)
    if (!Array.isArray(result)) {
      console.warn(`/last-trades-prices chunk returned non-array (size=${chunk.length}); coercing to []`)
      return []
    }
    return result
  }
  catch (err) {
    console.warn(`/last-trades-prices chunk failed (size=${chunk.length})`, err)
    return []
  }
}

export { getRoundedCents }

export async function fetchOrderBookSummaries(tokenIds: string[]): Promise<OrderBookSummariesResponse> {
  if (!tokenIds.length) {
    return {}
  }

  const chunks = chunkTokenIds(tokenIds)

  const [orderBookChunks, lastTradeChunks] = await Promise.all([
    Promise.all(chunks.map(fetchOrderbookChunk)),
    Promise.all(chunks.map(fetchLastTradesChunk)),
  ])

  const orderBooks: ClobOrderbookSummary[] = orderBookChunks.flat()
  const lastTrades: LastTradePriceEntry[] = lastTradeChunks.flat()

  const orderBookByToken = new Map<string, ClobOrderbookSummary>()
  orderBooks.forEach((entry) => {
    if (entry?.asset_id) {
      orderBookByToken.set(entry.asset_id, entry)
    }
  })

  const lastTradesByToken = new Map<string, LastTradePriceEntry>()
  lastTrades.forEach((entry) => {
    if (entry?.token_id) {
      lastTradesByToken.set(entry.token_id, entry)
    }
  })

  const combined: Record<string, OrderBookSummaryResponse> = {}

  tokenIds.forEach((tokenId) => {
    const orderbookEntry = orderBookByToken.get(tokenId)
    const lastTradeEntry = lastTradesByToken.get(tokenId)

    combined[tokenId] = {
      bids: orderbookEntry?.bids ?? [],
      asks: orderbookEntry?.asks ?? [],
      last_trade_price: lastTradeEntry?.price,
      last_trade_side: lastTradeEntry?.side,
    }
  })

  return combined
}

export function buildOrderBookSnapshot(
  summary: OrderBookSummaryResponse | null,
  market: Market,
  outcome: Outcome | undefined,
): OrderBookSnapshot {
  const outcomeToUse = outcome ?? market.outcomes[0]
  const normalizedAsks = normalizeLevels(summary?.asks, 'ask')
  const normalizedBids = normalizeLevels(summary?.bids, 'bid')
  const maxTotal = Math.max(
    1,
    normalizedAsks.reduce((max, level) => Math.max(max, level.total), 0),
    normalizedBids.reduce((max, level) => Math.max(max, level.total), 0),
  )

  const bestAsk = normalizedAsks[0]?.priceCents
  const bestBid = normalizedBids[0]?.priceCents
  const lastTradeOverride = toCents(summary?.last_trade_price)
  const lastPrice = lastTradeOverride ?? null

  const spread = typeof bestAsk === 'number' && typeof bestBid === 'number'
    ? Math.max(0, Number((bestAsk - bestBid).toFixed(1)))
    : null

  return {
    asks: normalizedAsks,
    bids: normalizedBids,
    maxTotal,
    lastPrice,
    spread,
    outcomeLabel: outcomeToUse?.outcome_text?.trim() || (outcomeToUse?.outcome_index === OUTCOME_INDEX.NO ? 'No' : 'Yes'),
  }
}

export function getExecutableLimitPrice(level: OrderBookLevel) {
  return getRoundedCents(level.rawPrice, level.side).toFixed(1)
}

function normalizeLevels(levels: OrderbookLevelSummary[] | undefined, side: 'ask' | 'bid'): OrderBookLevel[] {
  if (!levels?.length) {
    return []
  }

  const parsed = levels
    .map((entry) => {
      const price = Number(entry.price)
      const size = Number(entry.size)
      if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) {
        return null
      }

      return { price, size }
    })
    .filter((entry): entry is { price: number, size: number } => entry !== null)

  const sorted = parsed
    .sort((a, b) => (side === 'ask' ? a.price - b.price : b.price - a.price))
    .map(entry => ({
      price: entry.price,
      size: Number(entry.size.toFixed(2)),
    }))
    .filter(entry => entry.size > 0)
    .slice(0, DEFAULT_MAX_LEVELS)

  let runningTotal = 0
  let runningShares = 0

  return sorted.map((entry) => {
    const displayCents = getRoundedCents(entry.price, side)
    runningTotal += entry.price * entry.size
    runningShares = Number((runningShares + entry.size).toFixed(2))

    return {
      side,
      rawPrice: entry.price,
      priceCents: displayCents,
      shares: entry.size,
      cumulativeShares: runningShares,
      total: runningTotal,
    }
  })
}

export function getOrderBookUserKey(side: 'ask' | 'bid', priceCents: number) {
  return `${side}:${priceCents.toFixed(1)}`
}

export function microToUnit(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return value / MICRO_UNIT
}

export function formatSharesInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }

  return Number(value.toFixed(2)).toString()
}

export function calculateLimitAmount(priceCents: string, shares: string) {
  const priceValue = Number.parseFloat(priceCents)
  const sharesValue = Number.parseFloat(shares)

  if (!Number.isFinite(priceValue) || !Number.isFinite(sharesValue)) {
    return null
  }

  const total = (priceValue * sharesValue) / 100
  if (!Number.isFinite(total) || total <= 0) {
    return null
  }

  return total.toFixed(2)
}

export function formatTooltipShares(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return formatSharesLabel(value)
}

export function formatOrderBookPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return formatCentsLabel(null)
  }

  const normalized = value <= 1 ? value / 100 : value
  return formatCentsLabel(normalized)
}
