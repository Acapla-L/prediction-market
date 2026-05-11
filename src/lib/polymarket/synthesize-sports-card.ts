import type { z } from 'zod'
import type {
  SportsGamesCard,
  SportsGamesTeam,
} from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
import type { DiscoveredGameMarketEntry } from '@/lib/polymarket/normalize-games-discovery-payload'
import type { Event, Market, Outcome } from '@/types'
import { cacheTag } from 'next/cache'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { getLeagueBySlug, getLeagueForGameSlug } from '@/lib/polymarket/games-leagues'
import { DiscoveredGameMarketsPayloadSchema } from '@/lib/polymarket/normalize-games-discovery-payload'
import 'server-only'

/**
 * Synthetic event/market id prefix — distinct from Phase A v2's
 * `polymarket-discovered:` prefix to avoid colliding with the futures
 * sidecar's namespace. The chart-history hook short-circuits any condition
 * id that begins with this prefix to prevent synthetic ids from being
 * POSTed to the Kuest CLOB (see useEventLastTrades.ts and
 * useEventMidPrices.ts synthetic-ID guards).
 */
const SYNTHETIC_GAME_PREFIX = 'polymarket-discovered-game'

interface ParsedGameSlug {
  league: string
  awayAbbr: string
  homeAbbr: string
}

/**
 * Parse a Phase B per-game slug into its component parts.
 *
 * Slug shape: `{league}-{away}-{home}-{YYYY}-{MM}-{DD}` — e.g.
 * `mlb-tor-tb-2026-05-06` → `{ league: 'mlb', awayAbbr: 'tor', homeAbbr: 'tb' }`.
 *
 * Per plan §D, abbreviations of length 2/3/4 are all valid (e.g. `tb`, `tor`,
 * `cubs`). The shape lock is positional: split by `-`, expect exactly 6 parts
 * with the trailing 3 being `YYYY-MM-DD`.
 *
 * Returns `null` on any shape mismatch — the caller decides null vs throw.
 */
export function parseGameSlugTeams(slug: string): ParsedGameSlug | null {
  const parts = slug.split('-')
  if (parts.length !== 6) {
    return null
  }
  const [league, awayAbbr, homeAbbr, year, month, day] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return null
  }
  if (!league || !awayAbbr || !homeAbbr) {
    return null
  }
  return { league, awayAbbr, homeAbbr }
}

/**
 * Parse the JSON envelope persisted in `discovered_polymarket_games.markets_payload`.
 * Returns `null` on any Zod failure or JSON parse error (callers fall through
 * to `null` SportsGamesCard).
 */
function parseGamesPayload(serialized: string) {
  let data: unknown
  try {
    data = JSON.parse(serialized)
  }
  catch {
    return null
  }
  const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/**
 * Project a `TeamCacheRow` (or null) into a `SportsGamesTeam` with explicit
 * placeholder fallback when the team_cache row is missing. The placeholder
 * ensures the page still renders with usable data — the abbreviation
 * uppercased serves as the displayed name in the absence of a Polymarket
 * /teams sync entry.
 */
function projectTeam(
  team: TeamCacheRow | null,
  fallbackAbbr: string,
  hostStatus: 'home' | 'away',
): SportsGamesTeam {
  if (!team) {
    return {
      name: fallbackAbbr.toUpperCase(),
      abbreviation: fallbackAbbr,
      record: null,
      color: null,
      logoUrl: null,
      hostStatus,
    }
  }
  return {
    name: team.name,
    abbreviation: team.abbreviation,
    record: team.record,
    color: team.color,
    logoUrl: team.logoUrl,
    hostStatus,
  }
}

/**
 * Build a synthetic `Outcome` for a single market entry.
 *
 * Both `token_id` and `polymarket_token_id` are set to the same value: the
 * Polymarket CLOB token id. There is no Kuest mirror condition for discovery
 * games — the chart hook routes via the Polymarket proxy because the slug
 * matches a Phase B per-game pattern (see useEventPriceHistory inline allowlist
 * + drift detector). Mirrors the Phase A v2 pattern in `discovery.ts`.
 */
function buildOutcome(
  conditionId: string,
  index: 0 | 1,
  outcomeText: string,
  tokenId: string,
  price: number | null,
  syncedAtIso: string,
): Outcome {
  return {
    condition_id: conditionId,
    outcome_text: outcomeText,
    outcome_index: index,
    token_id: tokenId,
    polymarket_token_id: tokenId,
    is_winning_outcome: false,
    buy_price: price ?? 0,
    sell_price: price ?? 0,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
  }
}

/**
 * Map a payload market type onto a `sports_market_type` value the existing
 * `sports-games-data` helpers (`buildButtons`, `groupMarketsByType`) recognize.
 * `market_type` is now an open string (Fix 1, 2026-05-11) — unrecognized values
 * fall through to `null`, which routes them into the binary-outcome detection
 * path in `buildButtons` (the correct safe default; matches the old `case 'nrfi'`
 * arm and the downstream `.includes('moneyline')`/`.includes('spread')`/
 * `.includes('total')` substring matching in `sports-games-data.ts`).
 *
 * Mapping (others → null):
 * - `'moneyline'`            → `'moneyline'`
 * - `'spreads'`              → `'spread'`  (singular — matches groupMarketsByType regex)
 * - `'totals'`               → `'total'`   (singular)
 * - `'first_half_moneyline'` → `'first_half_moneyline'`
 * - `'first_half_spreads'`   → `'first_half_spread'`
 * - `'first_half_totals'`    → `'first_half_total'`
 * - `'nrfi'`                 → `null` (binary YES/NO; let buildButtons detect it)
 */
const SPORTS_MARKET_TYPE_OUTPUT_MAP: ReadonlyMap<string, string | null> = new Map([
  ['moneyline', 'moneyline'],
  ['spreads', 'spread'],
  ['totals', 'total'],
  ['first_half_moneyline', 'first_half_moneyline'],
  ['first_half_spreads', 'first_half_spread'],
  ['first_half_totals', 'first_half_total'],
  ['nrfi', null],
])

function toSportsMarketType(payloadType: string): string | null {
  return SPORTS_MARKET_TYPE_OUTPUT_MAP.get(payloadType) ?? null
}

/**
 * Build a synthetic `Market` for one entry in the payload.
 *
 * `condition_id` is namespaced by the synthetic prefix + slug + market id so
 * synthetic-ID guards in `useEventLastTrades`, `useEventMidPrices`, and
 * `useEventMarketQuotes` filter these out before posting to Kuest CLOB.
 */
function buildMarket(
  eventId: string,
  rowSlug: string,
  syncedAtIso: string,
  endDateIso: string | null,
  entry: DiscoveredGameMarketEntry,
): Market {
  const conditionId = `${SYNTHETIC_GAME_PREFIX}:${rowSlug}:${entry.polymarket_market_id}`
  const yesPrice = entry.outcome_prices ? Number.parseFloat(entry.outcome_prices[0]) : null
  const noPrice = entry.outcome_prices ? Number.parseFloat(entry.outcome_prices[1]) : null
  const yesToken = entry.clob_token_ids?.[0] ?? ''
  const noToken = entry.clob_token_ids?.[1] ?? ''
  const yesText = entry.outcomes?.[0] ?? 'Yes'
  const noText = entry.outcomes?.[1] ?? 'No'
  const volume = entry.volume ?? 0
  const probability = yesPrice != null ? yesPrice * 100 : 0

  const outcomes: Outcome[] = [
    buildOutcome(conditionId, 0, yesText, yesToken, yesPrice, syncedAtIso),
    buildOutcome(conditionId, 1, noText, noToken, noPrice, syncedAtIso),
  ]

  return {
    condition_id: conditionId,
    question_id: '',
    event_id: eventId,
    title: entry.question,
    slug: entry.slug,
    short_title: entry.question,
    icon_url: entry.icon_url ?? '',
    is_active: entry.is_active,
    is_resolved: entry.is_closed,
    block_number: 0,
    block_timestamp: syncedAtIso,
    sports_market_type: toSportsMarketType(entry.market_type),
    volume_24h: 0,
    volume,
    end_time: endDateIso,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
    price: yesPrice ?? 0,
    probability,
    outcomes,
    condition: {
      id: conditionId,
      oracle: SYNTHETIC_GAME_PREFIX,
      question_id: '',
      outcome_slot_count: 2,
      resolved: entry.is_closed,
      volume,
      open_interest: 0,
      active_positions_count: 0,
      created_at: syncedAtIso,
      updated_at: syncedAtIso,
    },
  }
}

/**
 * Project a parsed payload + teams_cache rows into the `Event` shape that
 * `buildSportsGamesCards` consumes. Sets the sports_* fields required by
 * `canRenderSportsGamesCard`: `sports_section: 'games'`, `sports_sport_slug`
 * (so `resolveEventPagePath` produces `/sports/{sport}/{slug}`), and
 * `sports_event_slug = row.slug`.
 *
 * **Public API surface (Step 3, sports-forward home-v2).** Originally a
 * file-private helper of `buildSportsGamesCardFromGameRow`. Promoted to an
 * exported entry point so the home-v2 `fetchLeagueEvents` data layer can
 * project per-game sidecar rows directly into `Event`s for the homepage
 * grid (which expects `Event[]`, not `SportsGamesCard[]`).
 *
 * Consumers:
 *   - `buildSportsGamesCardFromGameRow` (this file) — internal, sports template
 *   - `home-v2/_data/fetchLeagueEvents.ts` — homepage league shelves
 *
 * Drift-locked by `tests/unit/synthesizeSportsCard.test.ts`.
 */
export function buildSyntheticEvent(
  row: DiscoveredGameRow,
  payload: z.infer<typeof DiscoveredGameMarketsPayloadSchema>,
  homeTeamForEvent: SportsGamesTeam,
  awayTeamForEvent: SportsGamesTeam,
  sportRouteSlug: string,
): Event {
  const eventId = `${SYNTHETIC_GAME_PREFIX}:${row.slug}`
  const syncedAtIso = row.lastSyncedAt
  const endDateIso = row.endDate
  const eventCreatedAt = payload.event_created_at
  const startTime = payload.game_start_time

  const markets: Market[] = payload.markets.map(entry =>
    buildMarket(eventId, row.slug, syncedAtIso, endDateIso, entry),
  )

  const activeCount = markets.filter(m => m.is_active && !m.is_resolved).length
  const totalVolume = markets.reduce((sum, m) => sum + (m.volume ?? 0), 0)
  const status: Event['status'] = row.isClosed
    ? 'resolved'
    : activeCount > 0 ? 'active' : 'resolved'
  const firstIcon = markets.find(m => m.icon_url)?.icon_url ?? ''
  const resolvedAt = row.isClosed ? syncedAtIso : null

  return {
    id: eventId,
    slug: row.slug,
    title: row.title,
    creator: SYNTHETIC_GAME_PREFIX,
    icon_url: firstIcon,
    show_market_icons: true,
    status,
    sports_section: 'games',
    sports_sport_slug: sportRouteSlug,
    sports_event_slug: row.slug,
    sports_start_time: startTime,
    sports_live: false,
    sports_ended: row.isClosed,
    sports_teams: [
      {
        name: homeTeamForEvent.name,
        abbreviation: homeTeamForEvent.abbreviation,
        record: homeTeamForEvent.record,
        color: homeTeamForEvent.color,
        logo_url: homeTeamForEvent.logoUrl,
        host_status: homeTeamForEvent.hostStatus,
      },
      {
        name: awayTeamForEvent.name,
        abbreviation: awayTeamForEvent.abbreviation,
        record: awayTeamForEvent.record,
        color: awayTeamForEvent.color,
        logo_url: awayTeamForEvent.logoUrl,
        host_status: awayTeamForEvent.hostStatus,
      },
    ],
    sports_team_logo_urls: [
      homeTeamForEvent.logoUrl ?? '',
      awayTeamForEvent.logoUrl ?? '',
    ].filter((url): url is string => Boolean(url)),
    active_markets_count: activeCount,
    total_markets_count: markets.length,
    volume: totalVolume,
    end_date: endDateIso,
    resolved_at: resolvedAt,
    created_at: eventCreatedAt,
    updated_at: syncedAtIso,
    markets,
    // Games tag triggers EventCardSportsMoneyline render path via hasGamesTag()
    // gate in sports-home-card.ts. Required for home-v2 sport sections to use
    // team-vs-team card template (logos + percentages + color-coded buttons +
    // footer template). `main_tag` is intentionally left as the league code so
    // the per-event sports template's filtering/grouping logic is unaffected.
    // Drift-locked by tests/unit/synthesizeSportsCard.test.ts.
    tags: [
      // Inline shape per Event['tags'] (4 fields, camelCase). Distinct from the
      // standalone Tag interface (9 fields, snake_case) used by the admin/DB layer.
      {
        id: 0,
        name: 'Games',
        slug: 'games',
        isMainCategory: false,
      },
    ],
    main_tag: row.league,
    is_bookmarked: false,
    is_trending: false,
  }
}

/**
 * Build a `SportsGamesCard` from a sidecar Phase B discovered-game row +
 * `teams_cache` lookups (one per home/away team). Pure function — no I/O.
 *
 * Returns `null` if:
 *   - The payload can't be parsed
 *   - The slug doesn't match the Phase B per-game shape
 *   - `buildSportsGamesCards` rejects the synthesized event (no buttons,
 *     fewer than 2 teams, etc.) — this is the "row is unusable for sports
 *     template rendering" outcome
 *
 * If `homeTeam` OR `awayTeam` is null, the projection still proceeds with
 * placeholder data for the missing team(s); only complete payload-level
 * failure produces `null`.
 *
 * Per plan §B Adjustment 7 (optional fields posture): the returned
 * `SportsGamesCard` always has `week = null` and `defaultConditionId` set
 * to the first detail market's `condition_id` (or `null` if none). The
 * surrounding `SportsEventCenter` props (`marketViewCards`, `relatedCards`)
 * are NOT part of the card itself — they are passed independently by the
 * dispatcher.
 */
export function buildSportsGamesCardFromGameRow(
  row: DiscoveredGameRow,
  homeTeam: TeamCacheRow | null,
  awayTeam: TeamCacheRow | null,
  sportRouteSlug: string,
): SportsGamesCard | null {
  const parsed = parseGameSlugTeams(row.slug)
  if (!parsed) {
    return null
  }

  const payload = parseGamesPayload(row.marketsPayload)
  if (!payload) {
    return null
  }
  if (payload.markets.length === 0) {
    return null
  }

  const homeProjected = projectTeam(homeTeam, parsed.homeAbbr, 'home')
  const awayProjected = projectTeam(awayTeam, parsed.awayAbbr, 'away')

  const event = buildSyntheticEvent(
    row,
    payload,
    homeProjected,
    awayProjected,
    sportRouteSlug,
  )

  // Reuse the existing helper so buttons/marketType grouping match every
  // other sports card in the codebase. Returns `[]` if `canRenderSportsGamesCard`
  // rejects the synthesized event (e.g. no buttons resolve from payload).
  const builtCards = buildSportsGamesCards([event])
  const builtCard = builtCards[0] ?? null
  if (!builtCard) {
    return null
  }

  // Per plan §B field-source table: override projected values with the
  // sidecar-row-canonical sources (eventHref, eventCreatedAt, etc.). The
  // existing `buildSportsGamesCards` derives these from the Event but the
  // sidecar row carries authoritative values that should win.
  const eventHref = `/sports/${sportRouteSlug}/${row.slug}`
  const eventResolvedAt = row.isClosed ? row.lastSyncedAt : null
  const startTime = payload.game_start_time || row.endDate

  // Adjustment 7: optional fields posture — set explicitly, never undefined.
  // `week` is NFL-only (not applicable to MLB MVP). `defaultConditionId`
  // falls back to the first detail market's condition_id when buttons resolve.
  const week: number | null = null
  const defaultConditionId = builtCard.detailMarkets[0]?.condition_id ?? null

  return {
    ...builtCard,
    eventHref,
    eventCreatedAt: payload.event_created_at,
    eventResolvedAt,
    startTime,
    week,
    defaultConditionId,
  }
}

/**
 * Async helper that does the full lookup chain: parse slug → look up home +
 * away from `teams_cache` → call `buildSportsGamesCardFromGameRow`.
 *
 * Wrapped in `'use cache'` with both `cacheTags.discoveredGame(slug)` and
 * `cacheTags.teamsCache(league)` so:
 *   - Discovery sync (`revalidateTag(discoveredGame(slug))`) busts this slug's
 *     projection
 *   - Teams sync (`revalidateTag(teamsCache(league))`) busts every per-game
 *     projection in that league
 *
 * Mirrors the Phase A v2 `loadDiscoveredEventPageData` caching pattern in
 * `discovery.ts`.
 */
export async function loadDiscoveredGameSportsCard(slug: string): Promise<SportsGamesCard | null> {
  'use cache'

  const parsed = parseGameSlugTeams(slug)
  if (!parsed) {
    return null
  }

  cacheTag(cacheTags.discoveredGame(slug))
  cacheTag(cacheTags.teamsCache(parsed.league))

  const league = getLeagueForGameSlug(slug)
  if (!league) {
    return null
  }

  // The canonical sport-route slug (e.g. MLB → 'baseball') is sourced from
  // the `DiscoveredGamesLeague` registry. See `games-leagues.ts` and plan §E.
  const sportRouteSlug = league.sportRouteSlug

  const { data: row, error } = await DiscoveredGamesRepository.getBySlug(slug)
  if (error || !row) {
    return null
  }
  if (row.lastSyncStatus !== 'ok' && (!row.marketsPayload || row.marketsPayload === '')) {
    return null
  }

  const [{ data: homeRow }, { data: awayRow }] = await Promise.all([
    TeamsCacheRepository.getByAbbreviation(parsed.league, parsed.homeAbbr),
    TeamsCacheRepository.getByAbbreviation(parsed.league, parsed.awayAbbr),
  ])

  if (!homeRow) {
    // Adjustment 6: placeholder fallback observability — emit a structured
    // warning to Vercel runtime logs so missing team-cache entries surface
    // before they silently degrade UX (uppercase abbreviation, no logo, no
    // color). Search by 'teams_cache miss' to enumerate.
    console.warn('teams_cache miss', {
      league: parsed.league,
      abbreviation: parsed.homeAbbr,
      slug,
    })
  }
  if (!awayRow) {
    console.warn('teams_cache miss', {
      league: parsed.league,
      abbreviation: parsed.awayAbbr,
      slug,
    })
  }

  return buildSportsGamesCardFromGameRow(row, homeRow ?? null, awayRow ?? null, sportRouteSlug)
}

/**
 * Stream 2 (Phase B v2 v3) — batch projection helper for the sports list
 * route. Mirrors `loadDiscoveredGameSportsCard` (single-slug) but loads every
 * upcoming tradeable row for a league in two queries (rows + teams) and
 * projects each row using the shared pure helper
 * `buildSportsGamesCardFromGameRow`.
 *
 * Filter (post-Bug-B fix 2026-05-08): delegates to
 * `DiscoveredGamesRepository.listUpcomingByLeague` so list-page filtering
 * matches the homepage (`fetchLeagueEvents.ts`) — same SQL `WHERE` clause,
 * single source of truth. Behavior:
 *   - is_active = true
 *   - is_archived = false
 *   - is_closed = false
 *   - game_start_time >= now - 1h  (homepage's time-window guard)
 *   - ORDER BY game_start_time ASC LIMIT 200
 *
 * The earlier implementation used `listActiveByLeague` + a post-`.filter`
 * for the lifecycle flags but had no time-window guard — list page surfaced
 * games whose start_time was hours-to-days in the past whenever Polymarket
 * sync hadn't yet flipped `is_closed` (typical lag). Switching to
 * `listUpcomingByLeague` fixes the divergence and removes the now-redundant
 * post-filter.
 *
 * Wrapped in `'use cache'` with two cache tags:
 *   - `cacheTags.discoveredGamesList(league)` — Stream 2 list-route tag
 *     busted per-league by the discovery + refresh sync routes.
 *   - `cacheTags.teamsCache(league)` — busted by the teams sync.
 *
 * Performance: one Postgres round-trip for rows + one for teams + an O(n)
 * map build, vs the per-slug helper's 1 + 2N round-trips.
 */
const LIST_PAGE_LIMIT = 200

export async function loadDiscoveredGameSportsCardsByLeague(
  leagueSlug: string,
): Promise<SportsGamesCard[]> {
  'use cache'

  cacheTag(cacheTags.discoveredGamesList(leagueSlug))
  cacheTag(cacheTags.teamsCache(leagueSlug))

  const league = getLeagueBySlug(leagueSlug)
  if (!league) {
    return []
  }

  const [{ data: tradeable }, { data: teams }] = await Promise.all([
    DiscoveredGamesRepository.listUpcomingByLeague(leagueSlug, LIST_PAGE_LIMIT, new Date()),
    TeamsCacheRepository.listByLeague(leagueSlug),
  ])
  if (!tradeable || tradeable.length === 0) {
    return []
  }

  const teamMap = new Map<string, TeamCacheRow>()
  for (const team of teams ?? []) {
    teamMap.set(team.abbreviation, team)
  }

  const cards: SportsGamesCard[] = []
  for (const row of tradeable) {
    const parsed = parseGameSlugTeams(row.slug)
    if (!parsed) {
      continue
    }
    const homeTeam = teamMap.get(parsed.homeAbbr) ?? null
    const awayTeam = teamMap.get(parsed.awayAbbr) ?? null
    const card = buildSportsGamesCardFromGameRow(row, homeTeam, awayTeam, league.sportRouteSlug)
    if (card) {
      cards.push(card)
    }
  }
  return cards
}
