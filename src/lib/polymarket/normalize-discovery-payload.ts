import type { PolymarketEvent } from '@/lib/polymarket/types'

/**
 * Trimmed projection of `event.markets[]` persisted into
 * `discovered_polymarket_events.markets_payload`. Only fields the render
 * layer actually consumes — see Phase A v2 plan §A.2.
 *
 * Persisted as JSON-stringified text (parity with `markets.metadata`),
 * parsed at read time.
 */
export interface DiscoveredMarketPayloadEntry {
  polymarket_market_id: string
  slug: string | null
  short_title: string
  is_active: boolean
  is_closed: boolean
  /** [yesPrice, noPrice] as numeric strings. Null when Gamma omitted prices (placeholder market). */
  outcome_prices: readonly [string, string] | null
  /** [yesToken, noToken]. Null when Gamma omitted tokens (placeholder market). */
  clob_token_ids: readonly [string, string] | null
  volume: number | null
  icon_url: string | null
}

export interface DiscoveredMarketsPayload {
  markets: ReadonlyArray<DiscoveredMarketPayloadEntry>
}

/**
 * Maps the typed Polymarket Gamma event into the trimmed sidecar shape.
 * Pure function — no I/O, no env reads. Skips placeholder markets that
 * lack BOTH prices and tokens (Polymarket "Other" / "Team AM" entries
 * are kept for breadth even if prices are absent — see FIFA placeholder
 * regression at session 026).
 */
export function normalizeDiscoveryPayload(event: PolymarketEvent): DiscoveredMarketsPayload {
  return {
    markets: event.markets.map((m): DiscoveredMarketPayloadEntry => ({
      polymarket_market_id: m.id,
      slug: m.slug ?? null,
      short_title: m.groupItemTitle,
      is_active: m.active,
      is_closed: m.closed,
      outcome_prices: m.outcomePrices
        ? [m.outcomePrices[0].toString(), m.outcomePrices[1].toString()] as const
        : null,
      clob_token_ids: m.clobTokenIds
        ? [m.clobTokenIds[0], m.clobTokenIds[1]] as const
        : null,
      volume: typeof m.volume === 'number' ? m.volume : null,
      icon_url: m.iconUrl ?? null,
    })),
  }
}

export function serializeDiscoveryPayload(payload: DiscoveredMarketsPayload): string {
  return JSON.stringify(payload)
}
