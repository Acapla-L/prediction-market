import type { PolymarketEvent } from '@/lib/polymarket/types'

/**
 * Per-market entry in the Phase B per-game JSON envelope. Distinct from
 * Phase A v2's `DiscoveredMarketPayloadEntry` because Phase B carries
 * `market_type` (always `'moneyline'` in MVP) and `question` (Polymarket-
 * supplied label), and omits `short_title` (futures-specific).
 */
export interface DiscoveredGameMarketEntry {
  polymarket_market_id: string
  slug: string
  question: string
  market_type: 'moneyline'
  outcomes: readonly [string, string] | null
  outcome_prices: readonly [string, string] | null
  clob_token_ids: readonly [string, string] | null
  volume: number | null
  is_active: boolean
  is_closed: boolean
  icon_url: string | null
}

export interface DiscoveredGameMarketsPayload {
  /** Polymarket Gamma event creation timestamp — chart ALL-range lower bound. */
  event_created_at: string
  /** Game start time (gameStartTime from Gamma). Cached in payload as a sidecar. */
  game_start_time: string
  /**
   * Filtered markets list. MVP: exactly one entry (moneyline only). v2/v3
   * may extend with spread/total entries; the schema stays the same.
   */
  markets: ReadonlyArray<DiscoveredGameMarketEntry>
}

export interface NormalizedGameEvent {
  slug: string
  league: string
  polymarket_event_id: string
  title: string
  home_team_label: string | null
  away_team_label: string | null
  game_start_time: Date
  is_active: boolean
  is_closed: boolean
  end_date: Date | null
  payload: DiscoveredGameMarketsPayload
}

/**
 * Picks the moneyline market from a Polymarket per-game event's `markets[]`
 * array. The moneyline is the market whose `slug` MATCHES the parent event's
 * slug exactly (other markets carry `-spread-...`/`-total-...`/`-nrfi`/etc.
 * suffixes). If no exact-match is found, falls back to `markets[0]` — an
 * acceptable fallback because Polymarket consistently lists moneyline first
 * in the bundle.
 *
 * Returns `null` if the event has no markets.
 */
export function pickMoneylineMarket(event: PolymarketEvent): PolymarketEvent['markets'][number] | null {
  if (event.markets.length === 0) {
    return null
  }

  const exactMatch = event.markets.find(market => market.slug === event.slug)
  if (exactMatch) {
    return exactMatch
  }

  return event.markets[0] ?? null
}

/**
 * Splits an event title like `"Texas Rangers vs. New York Yankees"` into
 * `[home, away]` labels. Polymarket's convention is `"{away-team} vs. {home-team}"`
 * — the FIRST team is away, the second is home. Returns `[null, null]` if
 * the title doesn't match the pattern.
 */
export function parseTeamLabels(title: string | undefined): {
  home: string | null
  away: string | null
} {
  if (!title) {
    return { home: null, away: null }
  }

  // Match "X vs Y" / "X vs. Y" / "X v Y" / "X v. Y". Team-name captures end
  // in `\S` and the separator starts with `\s+v` to keep the regex
  // unambiguous (no super-linear backtracking — eslint regexp/no-super-
  // linear-backtracking).
  const match = title.match(/^(.+\S)\s+vs?\.?\s+(\S.*)$/i)
  if (!match) {
    return { home: null, away: null }
  }

  const away = match[1].trim()
  const home = match[2].trim()
  return { home: home || null, away: away || null }
}

/**
 * Maps a Polymarket Gamma per-game event to the row + payload shape stored
 * in `discovered_polymarket_games`. Pure function — no I/O, no DB.
 *
 * Returns `null` if:
 *   - The event has no markets (degenerate case)
 *   - The event lacks `gameStartTime` (Phase B requires this field)
 *   - The event lacks `createdAt` (Phase B requires this field for chart range)
 *   - The moneyline market lacks tradeable price/token data (degenerate)
 */
export function normalizeGamesDiscoveryPayload(
  event: PolymarketEvent,
  leagueSlug: string,
): NormalizedGameEvent | null {
  if (!event.gameStartTime || !event.createdAt) {
    return null
  }

  const moneyline = pickMoneylineMarket(event)
  if (!moneyline) {
    return null
  }

  // Skip if Polymarket hasn't populated tradable fields yet — placeholder
  // markets exist briefly between event creation and listing.
  if (!moneyline.outcomes || !moneyline.outcomePrices || !moneyline.clobTokenIds) {
    return null
  }

  const teams = parseTeamLabels(event.title)
  const gameStartTimeDate = new Date(event.gameStartTime)
  if (Number.isNaN(gameStartTimeDate.getTime())) {
    return null
  }
  const endDate = event.endDate ? new Date(event.endDate) : null
  const endDateValue = endDate && !Number.isNaN(endDate.getTime()) ? endDate : null

  const payloadEntry: DiscoveredGameMarketEntry = {
    polymarket_market_id: moneyline.id,
    slug: moneyline.slug ?? event.slug,
    question: moneyline.groupItemTitle || event.title || moneyline.id,
    market_type: 'moneyline',
    outcomes: moneyline.outcomes,
    // outcomePrices is parsed as numeric tuple; persist as string tuple for
    // schema parity with discovered_polymarket_events (avoids drift between
    // payload shapes when consumers parse).
    outcome_prices: [
      String(moneyline.outcomePrices[0]),
      String(moneyline.outcomePrices[1]),
    ],
    clob_token_ids: moneyline.clobTokenIds,
    volume: moneyline.volume ?? null,
    is_active: moneyline.active,
    is_closed: moneyline.closed,
    icon_url: moneyline.iconUrl ?? null,
  }

  const payload: DiscoveredGameMarketsPayload = {
    event_created_at: event.createdAt,
    game_start_time: event.gameStartTime,
    markets: [payloadEntry],
  }

  return {
    slug: event.slug,
    league: leagueSlug,
    polymarket_event_id: event.id ?? event.slug,
    title: event.title ?? event.slug,
    home_team_label: teams.home,
    away_team_label: teams.away,
    game_start_time: gameStartTimeDate,
    is_active: moneyline.active,
    is_closed: moneyline.closed,
    end_date: endDateValue,
    payload,
  }
}

export function serializeGamesDiscoveryPayload(payload: DiscoveredGameMarketsPayload): string {
  return JSON.stringify(payload)
}
