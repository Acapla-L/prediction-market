import type { PolymarketEvent } from '@/lib/polymarket/types'

/**
 * Per-market entry in the Phase B per-game JSON envelope. Distinct from
 * Phase A v2's `DiscoveredMarketPayloadEntry` because Phase B carries
 * `market_type` (one of moneyline/nrfi/spreads/totals — Phase B v2 captures
 * all 4 section types per game) and `question` (Polymarket-supplied label),
 * and omits `short_title` (futures-specific).
 */
export interface DiscoveredGameMarketEntry {
  polymarket_market_id: string
  slug: string
  question: string
  /**
   * Phase B v2 expansion. MVP captured `'moneyline'` only. v2 captures all
   * four section types so the sports template can group markets by section
   * via existing `buildSportsGamesCardGroups` / `buildButtons` helpers.
   */
  market_type: 'moneyline' | 'nrfi' | 'spreads' | 'totals'
  /**
   * Phase B v2 line value for spreads (e.g. -1.5) and totals (e.g. 7.5, 8.5).
   * `null` for moneyline + nrfi (no line concept). Sourced from Polymarket
   * Gamma's `line` field on each market.
   */
  line: number | null
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
   * Filtered markets list. Phase B v2: up to 5 entries per game (one per
   * Polymarket market section: moneyline + nrfi + spreads + 1-2 totals at
   * different lines). MVP captured exactly one entry (moneyline only).
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
 *
 * NOTE: Phase B v2 normalizer no longer uses this function — it now captures
 * ALL markets via `mapAllMarkets`. Retained as an exported helper because
 * `pickMoneylineMarket` is still used elsewhere (and by tests). It also
 * remains useful for any single-market consumer (e.g. the future
 * `gameStartTime` source-of-truth which Polymarket attaches to every market
 * but which logically refers to the whole game).
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
 * Phase B v2: Maps EVERY market in a Polymarket per-game event to a
 * `DiscoveredGameMarketEntry`. Replaces the moneyline-only filter so the
 * sports template can group all 5 sections (moneyline / nrfi / spreads /
 * totals) at render time.
 *
 * Markets that lack tradeable price/token data (placeholder markets that
 * Polymarket hasn't fully populated yet) are filtered out — same gating
 * the original `pickMoneylineMarket` consumer applied.
 *
 * Each entry preserves Polymarket's `sportsMarketType` (defaults to
 * `'moneyline'` only when source omits the field — Phase A v2 futures
 * never call this function so the default is a safe fallback for malformed
 * per-game entries) and `line` (null for moneyline/nrfi).
 */
export function mapAllMarkets(event: PolymarketEvent): DiscoveredGameMarketEntry[] {
  const entries: DiscoveredGameMarketEntry[] = []
  for (const market of event.markets) {
    if (!market.outcomes || !market.outcomePrices || !market.clobTokenIds) {
      continue
    }
    entries.push({
      polymarket_market_id: market.id,
      slug: market.slug ?? event.slug,
      question: market.groupItemTitle || event.title || market.id,
      market_type: market.sportsMarketType ?? 'moneyline',
      line: market.line ?? null,
      outcomes: market.outcomes,
      // outcomePrices is parsed as numeric tuple; persist as string tuple
      // for schema parity with discovered_polymarket_events.
      outcome_prices: [
        String(market.outcomePrices[0]),
        String(market.outcomePrices[1]),
      ],
      clob_token_ids: market.clobTokenIds,
      volume: market.volume ?? null,
      is_active: market.active,
      is_closed: market.closed,
      icon_url: market.iconUrl ?? null,
    })
  }
  return entries
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
 * Phase B v2: captures ALL markets per event (up to 5 sections — moneyline,
 * nrfi, spreads, totals × N lines). Previous Phase B MVP captured moneyline
 * only.
 *
 * Returns `null` if:
 *   - The event has no markets (degenerate case)
 *   - The event lacks `createdAt` (Phase B requires this field for chart range)
 *   - The moneyline market lacks `gameStartTime` (Phase B requires it; lives
 *     at the MARKET level on Polymarket Gamma, NOT the event level — verified
 *     via real fixture)
 *   - All markets lack tradeable price/token data (degenerate; `mapAllMarkets`
 *     filters those out and would return an empty array)
 */
export function normalizeGamesDiscoveryPayload(
  event: PolymarketEvent,
  leagueSlug: string,
): NormalizedGameEvent | null {
  if (!event.createdAt) {
    return null
  }

  // gameStartTime lives at the MARKET level on Polymarket Gamma per-game
  // responses (not the event level). The moneyline market is the source-of-
  // truth for the whole game's tipoff/first-pitch — every market in a per-
  // game response carries the same `gameStartTime`, but pulling from the
  // moneyline keeps a single canonical source.
  const moneyline = pickMoneylineMarket(event)
  if (!moneyline) {
    return null
  }
  if (!moneyline.gameStartTime) {
    return null
  }

  const allEntries = mapAllMarkets(event)
  if (allEntries.length === 0) {
    return null
  }

  const teams = parseTeamLabels(event.title)
  const gameStartTimeDate = new Date(moneyline.gameStartTime)
  if (Number.isNaN(gameStartTimeDate.getTime())) {
    return null
  }
  const endDate = event.endDate ? new Date(event.endDate) : null
  const endDateValue = endDate && !Number.isNaN(endDate.getTime()) ? endDate : null

  const payload: DiscoveredGameMarketsPayload = {
    event_created_at: event.createdAt,
    game_start_time: moneyline.gameStartTime,
    markets: allEntries,
  }

  // Event-level is_active / is_closed mirror the moneyline market — the
  // moneyline IS the matchup, so its active/closed state defines the game's
  // overall status. Other section markets may close earlier (NRFI resolves
  // after the 1st inning) but the row-level flags follow the moneyline.
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
