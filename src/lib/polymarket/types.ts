// Polymarket integration types.
//
// No `'server-only'` import here — types are erased at compile time, so client
// components can `import type` from this module without pulling any runtime
// server code into their bundle.

// ---- Polymarket Gamma API (event + markets) --------------------------------

export interface PolymarketMarket {
  id: string
  conditionId: string
  groupItemTitle: string
  active: boolean
  closed: boolean
  /**
   * Parsed from JSON-encoded string in the raw Gamma response.
   * Optional: Polymarket returns placeholder markets for future qualifying
   * teams (Team AM, Team AI, Other) with these fields undefined. Filtered
   * in `buildFifaOverlay`.
   */
  outcomes?: readonly [string, string]
  /** Parsed from JSON-encoded string + coerced to numbers. Optional (see `outcomes`). */
  outcomePrices?: readonly [number, number]
  /** Parsed from JSON-encoded string. Optional (see `outcomes`). */
  clobTokenIds?: readonly [string, string]
  bestBid: number | null
  bestAsk: number | null
  lastTradePrice: number | null
  volume: number
  volume24hr: number | null
}

export interface PolymarketEvent {
  slug: string
  markets: readonly PolymarketMarket[]
}

// ---- Polymarket CLOB API (price history) -----------------------------------

export interface PolymarketPriceHistoryPoint {
  /** Unix seconds. */
  t: number
  /** Probability in [0, 1]. */
  p: number
}

export interface PolymarketPriceHistoryResponse {
  history: readonly PolymarketPriceHistoryPoint[]
}

// ---- Internal overlay types (consumed by the loader + hook) ----------------

/**
 * One market's worth of Polymarket data, keyed by the normalized country name
 * that matches our DB's `markets.short_title`. Produced by `fifa-overlay.ts`
 * and stitched onto `event.markets[i]` + `outcomes[j]` by `event-page-data.ts`.
 */
export interface FifaOverlayMarket {
  country: string
  yesPrice: number | null
  noPrice: number | null
  volume: number
  closed: boolean
  yesTokenId: string
  noTokenId: string
}

export interface FifaOverlayResult {
  marketsByCountry: Record<string, FifaOverlayMarket>
  /** True when upstream fetch failed and we're serving an empty or cached payload. */
  stale: boolean
  lastUpdatedAt: Date
}
