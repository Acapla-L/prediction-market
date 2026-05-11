import type { DiscoveredGamesLeague } from '@/lib/polymarket/games-leagues'
import type { PolymarketEvent } from '@/lib/polymarket/types'
import { z } from 'zod'
import { getLeagueBySlug } from '@/lib/polymarket/games-leagues'

/**
 * NBA player-prop market types filtered out of the per-game card MVP scope.
 * `points` / `rebounds` / `assists` are individual player markets that don't
 * fit the team-vs-team card pattern. Phase B v2 v2 explicitly omits these
 * from `mapAllMarkets`. Future MVP-extension can revisit.
 */
const PLAYER_PROP_MARKET_TYPES: ReadonlySet<string> = new Set([
  'points',
  'rebounds',
  'assists',
])

/**
 * Observability-only registry of known-good `sportsMarketType` values. NOT used
 * for parse-time rejection — the schema accepts any string. `mapAllMarkets`
 * consults this to decide whether to emit an "unknown sportsMarketType" warn.
 * Keep in sync with what we know Polymarket emits; the warn surfaces drift.
 */
const KNOWN_SPORTS_MARKET_TYPES: ReadonlySet<string> = new Set([
  'moneyline',
  'nrfi',
  'spreads',
  'totals',
  'first_half_moneyline',
  'first_half_spreads',
  'first_half_totals',
  'points',
  'rebounds',
  'assists',
  // Probe-confirmed soccer types (added pre-soccer-ship, not relied on)
  'both_teams_to_score',
  'double_chance',
  'draw_no_bet',
  // UFC (winner) and tennis (set winner) seen during workstream-1 probes
  'winner',
  'set_winner',
])

/**
 * Production Zod schema for the Phase B per-game JSON envelope persisted in
 * `discovered_polymarket_games.markets_payload`. Co-located with the
 * `DiscoveredGameMarketsPayload` interface so the runtime validator and
 * the static type stay in sync — and so test code can import the canonical
 * schema directly instead of maintaining a drift-prone replica.
 *
 * IMPORTANT: keep `line: z.number().nullable().default(null)` in place. The
 * `.default(null)` modifier is required for back-compat with existing
 * production rows on `discovered_polymarket_games.markets_payload` that
 * predate the `line` field. Without `.default(null)`, Zod rejects
 * `undefined` (distinct from `null` in Zod's type system) and every legacy
 * row would fail to parse → 404 cascade on Phase B per-game pages until the
 * refresh cron rewrote each row.
 */
export const DiscoveredGameMarketsPayloadSchema = z.object({
  event_created_at: z.string(),
  game_start_time: z.string(),
  markets: z.array(z.object({
    polymarket_market_id: z.string(),
    slug: z.string(),
    question: z.string(),
    // Open set — see KNOWN_SPORTS_MARKET_TYPES + the relaxation note in
    // GammaMarketSchema.sportsMarketType. Raw string is persisted unchanged.
    market_type: z.string(),
    line: z.number().nullable().default(null),
    outcomes: z.tuple([z.string(), z.string()]).nullable(),
    outcome_prices: z.tuple([z.string(), z.string()]).nullable(),
    clob_token_ids: z.tuple([z.string(), z.string()]).nullable(),
    volume: z.number().nullable(),
    is_active: z.boolean(),
    is_closed: z.boolean(),
    icon_url: z.string().nullable(),
  })),
})

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
   * Open set — Polymarket emits new section types without notice. Persisted as
   * the raw string; downstream `toSportsMarketType` maps known values, others
   * fall through to null (binary-detection path). See KNOWN_SPORTS_MARKET_TYPES.
   */
  market_type: string
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
 * Each entry preserves Polymarket's `sportsMarketType` raw string (defaults to
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
    // Phase B v2 v2 MVP filter: player-prop markets are out of team-vs-team
    // card scope. Filter BEFORE the observability warnings so these don't
    // trigger an "unknown sportsMarketType" log line.
    if (market.sportsMarketType && PLAYER_PROP_MARKET_TYPES.has(market.sportsMarketType)) {
      continue
    }
    if (market.sportsMarketType == null) {
      // Observability: surface upstream Polymarket Gamma schema drift before
      // it silently coerces this section into 'moneyline'. If this warning
      // starts firing, the `sportsMarketType` field has been renamed/removed
      // upstream and the downstream `mapAllMarkets`/template grouping logic
      // will need to adapt.
      console.warn('mapAllMarkets sportsMarketType missing', {
        marketSlug: market.slug ?? event.slug,
        marketId: market.id,
        eventSlug: event.slug,
        defaulted_to: 'moneyline',
      })
    }
    else if (!KNOWN_SPORTS_MARKET_TYPES.has(market.sportsMarketType)) {
      // Observability: an unrecognized (but well-formed) section type. The raw
      // string is still persisted unchanged — downstream `toSportsMarketType`
      // routes it into the binary-detection path. This warn flags drift so the
      // KNOWN_SPORTS_MARKET_TYPES registry can be updated.
      console.warn('[polymarket] unknown sportsMarketType', {
        value: market.sportsMarketType,
        marketSlug: market.slug ?? event.slug,
        eventSlug: event.slug,
      })
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
 * Resolve home/away team labels for a Polymarket per-game event via a 3-tier
 * fallback chain.
 *
 * Tier 1 (primary — fired for 100% of events probed 2026-05-08):
 *   `event.teams[]` array, length-2. Home/away assigned by
 *   `league.teamOrderConvention` ('away_first' = teams[0] is away; 'home_first'
 *   = teams[0] is home) because slug/title order encodes "first team listed",
 *   not "home team". If `teams` is missing or its length ≠ 2, a console.warn
 *   surfaces the case and we fall through to Tier 2.
 *
 * Tier 2 (defensive forward-compat — fired for 0% today):
 *   `event.homeTeam` / `event.awayTeam`. Polymarket support claimed reliable
 *   on all leagues; empirically absent on 0/76 events. Kept in case that
 *   changes.
 *
 * Tier 3 (legacy fallback):
 *   Title regex via `parseTeamLabelsFromTitle`. Covers closed-event archive
 *   rows that might predate `teams[]` population, or any event missing both
 *   prior sources. (Empirically: MLS per-game events ship with an EMPTY
 *   `teams: []` despite the title carrying both names — Tier 3 handles that.)
 */
export function resolveTeamLabels(
  event: PolymarketEvent,
  league: DiscoveredGamesLeague,
): { home: string | null, away: string | null } {
  // Tier 1 — event.teams[] (universal today)
  if (Array.isArray(event.teams)) {
    if (event.teams.length === 2) {
      const [first, second] = event.teams
      if (league.teamOrderConvention === 'away_first') {
        return { away: first.name, home: second.name }
      }
      return { home: first.name, away: second.name }
    }
    // Present but malformed (0, 1, 3+) — observability, then fall through.
    console.warn('resolveTeamLabels teams[] present but length != 2', {
      eventSlug: event.slug,
      league: league.slug,
      teamsLength: event.teams.length,
    })
  }

  // Tier 2 — explicit homeTeam / awayTeam (defensive forward-compat)
  if (event.homeTeam || event.awayTeam) {
    return {
      home: event.homeTeam ?? null,
      away: event.awayTeam ?? null,
    }
  }

  // Tier 3 — title regex fallback (legacy archive safety net)
  return parseTeamLabelsFromTitle(event.title, league)
}

/**
 * Tier 3 of `resolveTeamLabels`. Title convention is league-dependent:
 * US sports = `{away} vs {home}`, soccer = `{home} vs {away}`. The `league`
 * parameter selects the order; output is byte-equivalent to the old
 * `parseTeamLabels` for MLB ('away_first').
 *
 * The separator alternation is `vs?\.?` (the `s` is optional) so bare `"v."`
 * titles like `"Cubs v. Mets"` match exactly as the old regex did. The team
 * captures are `.+\S` / `\S.*` (anchored on non-whitespace) to keep the regex
 * free of super-linear backtracking (eslint regexp/no-super-linear-backtracking).
 */
export function parseTeamLabelsFromTitle(
  title: string | undefined,
  league: DiscoveredGamesLeague,
): { home: string | null, away: string | null } {
  if (!title) {
    return { home: null, away: null }
  }
  const match = title.match(/^(.+\S)\s+vs?\.?\s+(\S.*)$/i)
  if (!match) {
    return { home: null, away: null }
  }
  const first = match[1].trim()
  const second = match[2].trim()
  if (league.teamOrderConvention === 'away_first') {
    return { away: first || null, home: second || null }
  }
  return { home: first || null, away: second || null }
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

  const league = getLeagueBySlug(leagueSlug)
  if (!league) {
    // Unknown league slug — degenerate; the caller only ever passes registry
    // slugs, but fail safe.
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

  const teams = resolveTeamLabels(event, league)
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
