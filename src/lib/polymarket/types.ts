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

// ---- MLB per-game overlay types -------------------------------------------

export type MlbSportsMarketType = 'moneyline' | 'nrfi' | 'spreads' | 'totals'

/**
 * MLB-specific Gamma market shape. Adds `sportsMarketType` and `line` to the
 * base PolymarketMarket fields. Both are required on the MLB side because
 * the overlay key depends on them — if they were missing we'd have no way
 * to route the stitch. The FIFA Gamma response does not include these
 * fields; FIFA uses `groupItemTitle` (country name) as its sole
 * discriminator, which is orthogonal. Parallel, not shared.
 */
export interface MlbGammaMarket {
  id: string
  conditionId: string
  sportsMarketType: MlbSportsMarketType
  /** Non-null for 'spreads' and 'totals'; null for 'moneyline' and 'nrfi'. */
  line: number | null
  active: boolean
  closed: boolean
  /** Pair of outcome labels as returned by Polymarket, pre-normalization. */
  outcomes: readonly [string, string]
  outcomePrices: readonly [number, number]
  clobTokenIds: readonly [string, string]
  volume: number
}

export interface MlbGammaEvent {
  slug: string
  markets: readonly MlbGammaMarket[]
}

/**
 * One Polymarket market's worth of data after normalization, keyed by
 * DB-canonical outcome text (e.g. 'Yes Run' / 'No Run' for NRFI — Polymarket
 * returns 'Yes' / 'No'). The loader matches a DB market to this overlay
 * entry via the composite overlay key (see `mlb-game-overlay.ts`
 * `makeOverlayKey`), then looks up each outcome by its `outcome_text` in
 * this `outcomesByLabel` map.
 */
export interface MlbGameOverlayMarketOutcome {
  price: number | null
  tokenId: string
}

export interface MlbGameOverlayMarket {
  marketType: MlbSportsMarketType
  /** Non-null for 'spreads' and 'totals'; null otherwise. */
  line: number | null
  /** DB-canonical outcome text (post-normalization) → { price, tokenId }. */
  outcomesByLabel: Record<string, MlbGameOverlayMarketOutcome>
  volume: number
  closed: boolean
}

export interface MlbGameOverlayResult {
  /** Event slug the overlay was built for; helps the loader sanity-check. */
  slug: string
  /**
   * Composite overlay key (see `makeOverlayKey`) → overlay market. The loader
   * computes the same key from each DB market and looks up a match. Missing
   * keys pass through untouched.
   */
  marketsByKey: Record<string, MlbGameOverlayMarket>
  /** True when upstream fetch failed and we're serving an empty or cached payload. */
  stale: boolean
  lastUpdatedAt: Date
}
