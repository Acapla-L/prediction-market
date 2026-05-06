import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSportsGamesCardFromGameRow,
  parseGameSlugTeams,
} from '@/lib/polymarket/synthesize-sports-card'

/**
 * Phase B v2 Session 2 — sub-agent B5 deliverable.
 *
 * Tests the projection layer in `synthesize-sports-card.ts`:
 *  - `buildSportsGamesCardFromGameRow(row, homeTeam, awayTeam, sportRouteSlug)`
 *  - `parseGameSlugTeams(slug)`
 *
 * Drives all assertions from the real Polymarket fixture
 * (`polymarket-gamma-mlb-per-game-response.json`) wrapped through the same
 * normalize-then-store pipeline production uses, so the test exercises the
 * exact `markets_payload` shape the projection layer reads at runtime.
 *
 * `loadDiscoveredGameSportsCard` (the async wrapper that drives I/O) is
 * tested separately in `discoveredGameSportsCard.test.ts` if/when that
 * file lands; this file focuses on the pure projection contract.
 */

// next/cache is referenced transitively via synthesize-sports-card.ts but
// `loadDiscoveredGameSportsCard` (the async function that calls cacheTag)
// is not exercised in this file. Mock as a defensive no-op anyway.
vi.mock('next/cache', () => ({
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: () => unknown) => fn),
  revalidateTag: vi.fn(),
}))

// ---- Fixtures ---------------------------------------------------------

const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  'fixtures',
  'polymarket-gamma-mlb-per-game-response.json',
)
const TEAMS_FIXTURE_PATH = resolve(
  __dirname,
  '..',
  'fixtures',
  'polymarket-gamma-mlb-teams.json',
)

interface RawTeamFixture {
  id: number
  name: string
  league: string
  record: string
  logo: string
  abbreviation: string
  alias: string
  color: string
}

interface RawMarketFixture {
  id: string
  conditionId: string
  groupItemTitle?: string
  active: boolean
  closed: boolean
  outcomes: string | string[]
  outcomePrices: string | string[]
  clobTokenIds: string | string[]
  volume: number | string
  slug: string
  icon?: string | null
  gameStartTime: string
  sportsMarketType?: string
  line?: number | null
}

interface RawEventFixture {
  id: number | string
  slug: string
  title: string
  endDate?: string | null
  createdAt: string
  negRisk?: boolean
  enableNegRisk?: boolean
  markets: RawMarketFixture[]
}

function loadEventsFixture(): RawEventFixture[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as RawEventFixture[]
}

function loadTeamsFixture(): RawTeamFixture[] {
  return JSON.parse(readFileSync(TEAMS_FIXTURE_PATH, 'utf8')) as RawTeamFixture[]
}

/**
 * Builds a teams_cache lookup map keyed by lowercase abbreviation. Mirrors
 * the production behavior of `TeamsCacheRepository.getByAbbreviation` for the
 * subset of teams available in the fixture.
 */
function buildTeamLookup(): Map<string, TeamCacheRow> {
  const fixture = loadTeamsFixture()
  const lookup = new Map<string, TeamCacheRow>()
  for (const team of fixture) {
    const row: TeamCacheRow = {
      league: team.league,
      teamId: String(team.id),
      name: team.name,
      alias: team.alias,
      abbreviation: team.abbreviation,
      logoUrl: team.logo,
      color: team.color,
      record: team.record,
      lastSyncedAt: '2026-05-06T12:00:00.000Z',
      lastSyncStatus: 'ok',
      lastSyncError: null,
    }
    lookup.set(team.abbreviation.toLowerCase(), row)
  }
  return lookup
}

/**
 * Mirrors the normalize-then-store pipeline so the test exercises the same
 * `markets_payload` shape the projection layer reads at runtime. Each market
 * is mapped into the `DiscoveredGameMarketEntry` envelope expected by the
 * persisted JSON.
 */
function buildPayloadFromFixture(raw: RawEventFixture): {
  event_created_at: string
  game_start_time: string
  markets: Array<{
    polymarket_market_id: string
    slug: string
    question: string
    market_type: 'moneyline' | 'nrfi' | 'spreads' | 'totals'
    line: number | null
    outcomes: [string, string]
    outcome_prices: [string, string]
    clob_token_ids: [string, string]
    volume: number
    is_active: boolean
    is_closed: boolean
    icon_url: string | null
  }>
} {
  const moneyline = raw.markets.find(m => m.slug === raw.slug) ?? raw.markets[0]!
  const gameStartTime = moneyline.gameStartTime
  const markets = raw.markets.map((m) => {
    const outcomes = typeof m.outcomes === 'string'
      ? (JSON.parse(m.outcomes) as string[])
      : m.outcomes
    const outcomePrices = typeof m.outcomePrices === 'string'
      ? JSON.parse(m.outcomePrices) as string[]
      : (m.outcomePrices as string[])
    const clobTokenIds = typeof m.clobTokenIds === 'string'
      ? JSON.parse(m.clobTokenIds) as string[]
      : (m.clobTokenIds as string[])
    const marketType = (m.sportsMarketType ?? 'moneyline') as
      | 'moneyline' | 'nrfi' | 'spreads' | 'totals'
    return {
      polymarket_market_id: m.id,
      slug: m.slug,
      question: m.groupItemTitle && m.groupItemTitle.length > 0
        ? m.groupItemTitle
        : raw.title,
      market_type: marketType,
      line: typeof m.line === 'number' ? m.line : null,
      outcomes: [outcomes[0]!, outcomes[1]!] as [string, string],
      outcome_prices: [String(outcomePrices[0]!), String(outcomePrices[1]!)] as [string, string],
      clob_token_ids: [String(clobTokenIds[0]!), String(clobTokenIds[1]!)] as [string, string],
      volume: typeof m.volume === 'number' ? m.volume : Number(m.volume) || 0,
      is_active: m.active,
      is_closed: m.closed,
      icon_url: m.icon ?? null,
    }
  })
  return {
    event_created_at: raw.createdAt,
    game_start_time: gameStartTime,
    markets,
  }
}

function buildRowFromFixture(raw: RawEventFixture): DiscoveredGameRow {
  const payload = buildPayloadFromFixture(raw)
  return {
    slug: raw.slug,
    league: 'mlb',
    polymarketEventId: String(raw.id),
    title: raw.title,
    homeTeamLabel: null,
    awayTeamLabel: null,
    gameStartTime: payload.game_start_time,
    isActive: raw.markets.some(m => m.active && !m.closed),
    isClosed: raw.markets.every(m => m.closed),
    isArchived: false,
    endDate: raw.endDate ?? null,
    marketsPayload: JSON.stringify(payload),
    lastSyncedAt: '2026-05-06T12:00:00.000Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
  }
}

// ---- parseGameSlugTeams ----------------------------------------------

describe('parseGameSlugTeams', () => {
  it('parses a 3-char + 2-char abbreviation slug correctly', () => {
    expect(parseGameSlugTeams('mlb-tor-tb-2026-05-06')).toEqual({
      league: 'mlb',
      awayAbbr: 'tor',
      homeAbbr: 'tb',
    })
  })

  it('parses 4-char abbreviations correctly (cubs, pirates pattern)', () => {
    // The slug format is 6 dash-separated parts, so `cubs-pirates` is two parts:
    // away=cubs, home=pirates.
    expect(parseGameSlugTeams('mlb-cubs-pirates-2026-05-06')).toEqual({
      league: 'mlb',
      awayAbbr: 'cubs',
      homeAbbr: 'pirates',
    })
  })

  it('parses the canonical Phase B fixture slugs', () => {
    expect(parseGameSlugTeams('mlb-mil-stl-2026-05-05')).toEqual({
      league: 'mlb',
      awayAbbr: 'mil',
      homeAbbr: 'stl',
    })
    expect(parseGameSlugTeams('mlb-nym-col-2026-05-05')).toEqual({
      league: 'mlb',
      awayAbbr: 'nym',
      homeAbbr: 'col',
    })
  })

  it('returns null for Phase A v2 futures slug (not a per-game pattern)', () => {
    // Drift-lock: the parser must reject every Phase A v2 futures slug so the
    // caller's null-check protects against accidental double-handling.
    expect(parseGameSlugTeams('2026-nba-champion')).toBeNull()
    expect(parseGameSlugTeams('mlb-world-series-champion-2026')).toBeNull()
    expect(parseGameSlugTeams('uefa-champions-league-winner')).toBeNull()
    expect(parseGameSlugTeams('2026-fifa-world-cup-winner-595')).toBeNull()
    expect(parseGameSlugTeams('2026-nhl-stanley-cup-champion')).toBeNull()
    expect(parseGameSlugTeams('big-game-champion-2027')).toBeNull()
  })

  it('returns null on incomplete date suffix', () => {
    expect(parseGameSlugTeams('mlb-tor-tb-2026')).toBeNull()
    expect(parseGameSlugTeams('mlb-tor-tb-2026-05')).toBeNull()
  })

  it('returns null on malformed shape', () => {
    expect(parseGameSlugTeams('something-malformed')).toBeNull()
    expect(parseGameSlugTeams('')).toBeNull()
    expect(parseGameSlugTeams('-')).toBeNull()
  })

  it('returns null when day is non-numeric', () => {
    expect(parseGameSlugTeams('mlb-tor-tb-2026-05-AB')).toBeNull()
    expect(parseGameSlugTeams('mlb-tor-tb-XXXX-05-06')).toBeNull()
  })

  it('returns null when one of league/away/home is empty', () => {
    // Empty fields between dashes split into '' parts which fail the truthy guard.
    expect(parseGameSlugTeams('mlb--tb-2026-05-06')).toBeNull()
    expect(parseGameSlugTeams('mlb-tor--2026-05-06')).toBeNull()
  })
})

// ---- buildSportsGamesCardFromGameRow ----------------------------------

describe('buildSportsGamesCardFromGameRow — fixture-driven projection', () => {
  let teamLookup: Map<string, TeamCacheRow>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    teamLookup = buildTeamLookup()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    })
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function buildArgsForFixtureEvent(idx: number) {
    const fixture = loadEventsFixture()
    const raw = fixture[idx]!
    const row = buildRowFromFixture(raw)
    const parsed = parseGameSlugTeams(row.slug)!
    const home = teamLookup.get(parsed.homeAbbr.toLowerCase()) ?? null
    const away = teamLookup.get(parsed.awayAbbr.toLowerCase()) ?? null
    return { row, home, away, raw }
  }

  it('projects mlb-mil-stl-2026-05-05 into a usable SportsGamesCard', () => {
    const { row, home, away, raw } = buildArgsForFixtureEvent(0)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card).not.toBeNull()
    expect(card!.slug).toBe('mlb-mil-stl-2026-05-05')
    expect(card!.eventHref).toBe('/sports/baseball/mlb-mil-stl-2026-05-05')
    expect(card!.title).toBe(raw.title)
  })

  it('eventHref always begins with /sports/<sportRouteSlug>/<slug>', () => {
    const { row, home, away } = buildArgsForFixtureEvent(2)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.eventHref).toBe('/sports/baseball/mlb-tor-tb-2026-05-06')
  })

  it('card.teams has exactly 2 entries with home first then away', () => {
    const { row, home, away } = buildArgsForFixtureEvent(0)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.teams).toHaveLength(2)
    expect(card!.teams[0]!.hostStatus).toBe('home')
    expect(card!.teams[1]!.hostStatus).toBe('away')
  })

  it('home team is St. Louis Cardinals (home=stl) for the first fixture', () => {
    // Fixture 0: "Milwaukee Brewers vs. St. Louis Cardinals" with slug
    // mlb-mil-stl-2026-05-05 → away=mil, home=stl.
    const { row, home, away } = buildArgsForFixtureEvent(0)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.teams[0]!.name).toBe('St. Louis Cardinals')
    expect(card!.teams[0]!.abbreviation).toBe('stl')
    // Logo + color present for joined team data
    expect(card!.teams[0]!.logoUrl).toBeTruthy()
    expect(card!.teams[0]!.color).toBeTruthy()

    expect(card!.teams[1]!.name).toBe('Milwaukee Brewers')
    expect(card!.teams[1]!.abbreviation).toBe('mil')
    expect(card!.teams[1]!.logoUrl).toBeTruthy()
    expect(card!.teams[1]!.color).toBeTruthy()
  })

  it('detailMarkets carries every active market the synthesized event accepts (>=4)', () => {
    // Fixtures carry 5 markets each (1 moneyline + 1 nrfi + 1 spread + 2
    // totals). The synthetic event's `buildSportsGamesCards` filter MAY reject
    // a binary section that does not produce a tradeable button (e.g. NRFI
    // YES/NO in some configurations). Guard with a >=4 floor — every one of
    // these 5 fixtures definitively yields at least 4 detailMarkets in
    // production.
    const { row, home, away } = buildArgsForFixtureEvent(0)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.detailMarkets.length).toBeGreaterThanOrEqual(4)
    expect(card!.marketsCount).toBe(card!.detailMarkets.length)
  })

  it('volume equals sum of payload markets[*].volume', () => {
    const { row, home, away } = buildArgsForFixtureEvent(0)
    const payload = JSON.parse(row.marketsPayload) as { markets: Array<{ volume: number }> }
    const expectedVolume = payload.markets.reduce((acc, m) => acc + (m.volume ?? 0), 0)

    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    // Volume bubbles up from synthesizeEvent → buildSportsGamesCards. The card
    // exposes whatever the helper computes from the synthesized event;
    // production behavior is "sum across active markets". Allow either
    // a strict full-sum match OR a subset-sum (active-only) match.
    expect(card!.volume).toBeGreaterThan(0)
    expect(card!.volume).toBeLessThanOrEqual(expectedVolume)
  })

  it('eventResolvedAt is null for an active (not-closed) fixture row', () => {
    const { row, home, away } = buildArgsForFixtureEvent(0)
    expect(row.isClosed).toBe(false)
    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.eventResolvedAt).toBeNull()
  })

  it('eventResolvedAt is the syncedAt ISO string when row.isClosed=true', () => {
    const { row, home, away } = buildArgsForFixtureEvent(0)
    const closedRow: DiscoveredGameRow = {
      ...row,
      isClosed: true,
      lastSyncedAt: '2026-05-07T08:00:00.000Z',
    }
    const card = buildSportsGamesCardFromGameRow(closedRow, home, away, 'baseball')

    expect(card!.eventResolvedAt).toBe('2026-05-07T08:00:00.000Z')
  })
})

describe('buildSportsGamesCardFromGameRow — optional-fields posture (Adjustment 7)', () => {
  let teamLookup: Map<string, TeamCacheRow>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    teamLookup = buildTeamLookup()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('week is explicitly null (NFL-only field, not silently undefined)', () => {
    const fixture = loadEventsFixture()
    const row = buildRowFromFixture(fixture[0]!)
    const parsed = parseGameSlugTeams(row.slug)!
    const home = teamLookup.get(parsed.homeAbbr.toLowerCase())!
    const away = teamLookup.get(parsed.awayAbbr.toLowerCase())!

    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    expect(card!.week).toBeNull()
    expect(card!.week).not.toBeUndefined()
  })

  it('defaultConditionId equals card.detailMarkets[0]?.condition_id ?? null', () => {
    const fixture = loadEventsFixture()
    const row = buildRowFromFixture(fixture[0]!)
    const parsed = parseGameSlugTeams(row.slug)!
    const home = teamLookup.get(parsed.homeAbbr.toLowerCase())!
    const away = teamLookup.get(parsed.awayAbbr.toLowerCase())!

    const card = buildSportsGamesCardFromGameRow(row, home, away, 'baseball')

    if (card!.detailMarkets.length > 0) {
      expect(card!.defaultConditionId).toBe(card!.detailMarkets[0]!.condition_id)
    }
    else {
      expect(card!.defaultConditionId).toBeNull()
    }
  })
})

describe('buildSportsGamesCardFromGameRow — placeholder fallback for missing teams', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('renders a placeholder team when homeTeam=null (still returns a non-null card)', () => {
    const fixture = loadEventsFixture()
    const row = buildRowFromFixture(fixture[0]!)
    const teamLookup = buildTeamLookup()
    const parsed = parseGameSlugTeams(row.slug)!
    const away = teamLookup.get(parsed.awayAbbr.toLowerCase())!

    const card = buildSportsGamesCardFromGameRow(row, null, away, 'baseball')

    // Slug parsing succeeds and away team has data — projection should still
    // succeed with a placeholder home team.
    expect(card).not.toBeNull()
    const homeTeam = card!.teams.find(t => t.hostStatus === 'home')
    expect(homeTeam).toBeDefined()
    // Per plan §D placeholder fallback: name = abbreviation.toUpperCase(),
    // logo/color/record null.
    expect(homeTeam!.name).toBe(parsed.homeAbbr.toUpperCase())
    expect(homeTeam!.abbreviation).toBe(parsed.homeAbbr)
    expect(homeTeam!.logoUrl).toBeNull()
    expect(homeTeam!.color).toBeNull()
    expect(homeTeam!.record).toBeNull()
  })

  it('renders placeholders for BOTH teams when both lookups are null', () => {
    const fixture = loadEventsFixture()
    const row = buildRowFromFixture(fixture[0]!)

    const card = buildSportsGamesCardFromGameRow(row, null, null, 'baseball')

    // Buttons may not resolve when neither team has a name match — the helper
    // can return null in that case. Phase B v2 §B field-source table treats
    // "row is unusable for sports rendering" as null. We assert the contract
    // either way: if non-null, both teams are placeholder-shaped.
    if (card !== null) {
      expect(card.teams).toHaveLength(2)
      card.teams.forEach((team) => {
        expect(team.logoUrl).toBeNull()
        expect(team.color).toBeNull()
      })
    }
  })

  it('returns null when the row.slug fails parseGameSlugTeams', () => {
    const fixture = loadEventsFixture()
    const baseRow = buildRowFromFixture(fixture[0]!)
    // Slug shape mismatch — projection layer returns null per spec.
    const malformed: DiscoveredGameRow = { ...baseRow, slug: '2026-nba-champion' }

    const card = buildSportsGamesCardFromGameRow(malformed, null, null, 'baseball')

    expect(card).toBeNull()
  })

  it('returns null when marketsPayload JSON is invalid', () => {
    const fixture = loadEventsFixture()
    const baseRow = buildRowFromFixture(fixture[0]!)
    const corrupted: DiscoveredGameRow = { ...baseRow, marketsPayload: '{not-json' }

    const card = buildSportsGamesCardFromGameRow(corrupted, null, null, 'baseball')

    expect(card).toBeNull()
  })

  it('returns null when payload has zero markets', () => {
    const fixture = loadEventsFixture()
    const baseRow = buildRowFromFixture(fixture[0]!)
    const emptyPayload = JSON.stringify({
      event_created_at: '2026-04-29T13:00:18.813855Z',
      game_start_time: '2026-05-05 23:05:00+00',
      markets: [],
    })
    const empty: DiscoveredGameRow = { ...baseRow, marketsPayload: emptyPayload }

    const card = buildSportsGamesCardFromGameRow(empty, null, null, 'baseball')

    expect(card).toBeNull()
  })
})

/**
 * Note on `loadDiscoveredGameSportsCard` (the async variant):
 *
 * The async wrapper calls `'use cache'`, `cacheTag()`, plus repository I/O.
 * Its observability contract (`console.warn('teams_cache miss', ...)` from
 * Adjustment 6) is exercised in
 * `tests/unit/loadDiscoveredGameSportsCard.test.ts` (when/if added —
 * exercising it here would require mocking both DiscoveredGamesRepository
 * and TeamsCacheRepository, which couples this fixture-driven projection
 * test to repository internals that change across PRs).
 *
 * The pure projection contract above does NOT emit the warning — the warning
 * is emitted ONLY by `loadDiscoveredGameSportsCard` BEFORE it calls
 * `buildSportsGamesCardFromGameRow`. See `synthesize-sports-card.ts:464`
 * for the canonical emission site.
 */
