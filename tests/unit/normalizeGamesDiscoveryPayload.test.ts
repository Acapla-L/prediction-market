import type { PolymarketEvent } from '@/lib/polymarket/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DiscoveredGameMarketsPayloadSchema,
  mapAllMarkets,
  normalizeGamesDiscoveryPayload,
  parseTeamLabels,
  pickMoneylineMarket,
} from '@/lib/polymarket/normalize-games-discovery-payload'

// Sample MLB event constructed to mirror Polymarket Gamma's per-game shape
// observed in `tests/fixtures/polymarket-gamma-mlb-per-game-response.json`.
//
// Phase B v2 update: each event now carries the full multi-section market
// bundle that real Polymarket per-game responses return — moneyline + nrfi
// + spreads + 2 totals (5 markets total). The Moneyline market has
// `groupItemTitle: undefined` (Polymarket convention — market IS the matchup)
// while every other market section carries a `groupItemTitle` (`NRFI`,
// `Spread -1.5`, `O/U 7.5`, `O/U 8.5`).
//
// Key conformance to real-API shape:
//   - `gameStartTime` lives at the MARKET level, not the event level.
//   - The Moneyline market (slug exact-matches the parent event slug) has
//     `groupItemTitle: undefined`.
//   - Every market carries `sportsMarketType` (one of the 4 enum values).
//   - `line` is `undefined`/null for moneyline + nrfi, numeric for
//     spreads + totals.
function buildSampleMlbEvent(overrides: Partial<PolymarketEvent> = {}): PolymarketEvent {
  return {
    slug: 'mlb-tex-nyy-2026-05-05',
    id: '431041',
    title: 'Texas Rangers vs. New York Yankees',
    endDate: '2026-05-12T23:05:00Z',
    createdAt: '2026-04-29T13:00:18.813855Z',
    negRisk: false,
    enableNegRisk: false,
    markets: [
      {
        id: '6092912',
        conditionId: '0xabcd1234',
        // Real Moneyline markets DO NOT carry a groupItemTitle. The mapper
        // defaults missing values to ''. Tests must mirror this shape so
        // the fallback chain `moneyline.groupItemTitle || event.title || ...`
        // is exercised the same way as in production.
        groupItemTitle: '',
        active: true,
        closed: false,
        outcomes: ['Texas Rangers', 'NY Yankees'],
        outcomePrices: [0.0005, 0.9995],
        clobTokenIds: ['1392827111', '4408994222'],
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 401789.74,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05',
        iconUrl: null,
        gameStartTime: '2026-05-05 23:05:00+00',
        sportsMarketType: 'moneyline',
        line: null,
      },
      {
        id: '6092915',
        conditionId: '0xabcdnrfi',
        groupItemTitle: 'NRFI',
        active: true,
        closed: false,
        outcomes: ['Yes', 'No'],
        outcomePrices: [0.45, 0.55],
        clobTokenIds: ['nrfi1', 'nrfi2'],
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 5123.45,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05-nrfi',
        iconUrl: null,
        gameStartTime: '2026-05-05 23:05:00+00',
        sportsMarketType: 'nrfi',
        line: null,
      },
      {
        id: '6092913',
        conditionId: '0xabcd5678',
        groupItemTitle: 'Spread (-1.5)',
        active: true,
        closed: false,
        outcomes: ['NY Yankees', 'TX Rangers'],
        outcomePrices: [0.9995, 0.0005],
        clobTokenIds: ['8329282', '6335724'],
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 15444.26,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05-spread-home-1pt5',
        iconUrl: null,
        gameStartTime: '2026-05-05 23:05:00+00',
        sportsMarketType: 'spreads',
        line: -1.5,
      },
      {
        id: '6092914',
        conditionId: '0xabcd9999',
        groupItemTitle: 'O/U 8.5',
        active: true,
        closed: false,
        outcomes: ['Over', 'Under'],
        outcomePrices: [1, 0],
        clobTokenIds: ['5484154', '5037725'],
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 41183.68,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05-total-8pt5',
        iconUrl: null,
        gameStartTime: '2026-05-05 23:05:00+00',
        sportsMarketType: 'totals',
        line: 8.5,
      },
      {
        id: '6092916',
        conditionId: '0xabcdtotal2',
        groupItemTitle: 'O/U 9.5',
        active: true,
        closed: false,
        outcomes: ['Over', 'Under'],
        outcomePrices: [0.4, 0.6],
        clobTokenIds: ['totalA1', 'totalA2'],
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 12345.67,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05-total-9pt5',
        iconUrl: null,
        gameStartTime: '2026-05-05 23:05:00+00',
        sportsMarketType: 'totals',
        line: 9.5,
      },
    ],
    ...overrides,
  }
}

describe('pickMoneylineMarket', () => {
  it('selects the market whose slug matches the event slug exactly', () => {
    const event = buildSampleMlbEvent()
    const moneyline = pickMoneylineMarket(event)
    expect(moneyline).toBeDefined()
    expect(moneyline?.slug).toBe('mlb-tex-nyy-2026-05-05')
    expect(moneyline?.id).toBe('6092912')
  })

  it('falls back to markets[0] when no exact slug match', () => {
    const event = buildSampleMlbEvent({
      markets: [
        {
          id: '999',
          conditionId: '0x999',
          groupItemTitle: 'Moneyline',
          active: true,
          closed: false,
          outcomes: ['Team A', 'Team B'],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ['t1', 't2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 0,
          volume24hr: null,
          slug: 'some-other-slug',
          iconUrl: null,
        },
      ],
    })
    const moneyline = pickMoneylineMarket(event)
    expect(moneyline?.id).toBe('999')
  })

  it('returns null for an event with no markets', () => {
    const event = buildSampleMlbEvent({ markets: [] })
    expect(pickMoneylineMarket(event)).toBeNull()
  })
})

describe('parseTeamLabels', () => {
  it('parses standard "X vs. Y" format', () => {
    expect(parseTeamLabels('Texas Rangers vs. New York Yankees')).toEqual({
      home: 'New York Yankees',
      away: 'Texas Rangers',
    })
  })

  it('handles "X vs Y" without period', () => {
    expect(parseTeamLabels('Timberwolves vs Spurs')).toEqual({
      home: 'Spurs',
      away: 'Timberwolves',
    })
  })

  it('handles "X v. Y"', () => {
    expect(parseTeamLabels('Cubs v. Mets')).toEqual({
      home: 'Mets',
      away: 'Cubs',
    })
  })

  it('returns null/null for undefined title', () => {
    expect(parseTeamLabels(undefined)).toEqual({ home: null, away: null })
  })

  it('returns null/null for non-matching title', () => {
    expect(parseTeamLabels('MLB World Series Champion 2026')).toEqual({ home: null, away: null })
  })
})

describe('normalizeGamesDiscoveryPayload', () => {
  it('produces a normalized row + payload for a valid MLB event', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    expect(result).not.toBeNull()
    expect(result!.slug).toBe('mlb-tex-nyy-2026-05-05')
    expect(result!.league).toBe('mlb')
    expect(result!.polymarket_event_id).toBe('431041')
    expect(result!.title).toBe('Texas Rangers vs. New York Yankees')
    expect(result!.home_team_label).toBe('New York Yankees')
    expect(result!.away_team_label).toBe('Texas Rangers')
    expect(result!.is_active).toBe(true)
    expect(result!.is_closed).toBe(false)
    expect(result!.game_start_time).toBeInstanceOf(Date)
    expect(result!.end_date).toBeInstanceOf(Date)
  })

  it('payload contains ALL section markets (Phase B v2 multi-section)', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    // Phase B v2: every active section in the source event is projected as a
    // payload entry. Sample event has 5 markets (1 moneyline + 1 nrfi + 1
    // spread + 2 totals at different lines). Replaces the MVP single-entry
    // contract.
    expect(result!.payload.markets).toHaveLength(5)
    const moneyline = result!.payload.markets.find(m => m.market_type === 'moneyline')
    expect(moneyline).toBeDefined()
    expect(moneyline!.polymarket_market_id).toBe('6092912')
  })

  it('payload moneyline outcomes match the event title order', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    const moneyline = result!.payload.markets.find(m => m.market_type === 'moneyline')
    expect(moneyline!.outcomes).toEqual(['Texas Rangers', 'NY Yankees'])
    expect(moneyline!.outcome_prices).toEqual(['0.0005', '0.9995'])
  })

  it('payload preserves event_created_at for chart ALL-range', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    expect(result!.payload.event_created_at).toBe('2026-04-29T13:00:18.813855Z')
    expect(result!.payload.game_start_time).toBe('2026-05-05 23:05:00+00')
  })

  it('emits one entry per market_type with line populated correctly', () => {
    // Phase B v2 test: drift-locks `mapAllMarkets` against the contract that
    // every section-type's `market_type` and `line` are surfaced into the
    // payload. moneyline + nrfi → line=null; spreads + totals → numeric line.
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    const byType = result!.payload.markets.reduce<Record<string, typeof result.payload.markets[number][]>>(
      (acc, market) => {
        acc[market.market_type] = acc[market.market_type] ?? []
        acc[market.market_type].push(market)
        return acc
      },
      {},
    )

    expect(byType.moneyline).toHaveLength(1)
    expect(byType.moneyline[0].line).toBeNull()

    expect(byType.nrfi).toHaveLength(1)
    expect(byType.nrfi[0].line).toBeNull()

    expect(byType.spreads).toHaveLength(1)
    expect(byType.spreads[0].line).toBe(-1.5)

    expect(byType.totals).toHaveLength(2)
    const totalsLines = byType.totals.map(m => m.line).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(totalsLines).toEqual([8.5, 9.5])
  })

  it('every payload market entry has market_type and line populated', () => {
    // Field-presence drift-lock: even if a future refactor changes the
    // mapper, every entry must still carry both fields (string + number/null).
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    result!.payload.markets.forEach((entry) => {
      expect(typeof entry.market_type).toBe('string')
      expect(['moneyline', 'nrfi', 'spreads', 'totals']).toContain(entry.market_type)
      // line is number-or-null — never undefined
      expect(entry.line === null || typeof entry.line === 'number').toBe(true)
    })
  })

  it('returns null when moneyline market lacks gameStartTime (market-level)', () => {
    const base = buildSampleMlbEvent()
    const event = {
      ...base,
      markets: base.markets.map((m, i) => i === 0 ? { ...m, gameStartTime: undefined } : m),
    }
    expect(normalizeGamesDiscoveryPayload(event, 'mlb')).toBeNull()
  })

  it('returns null when event lacks createdAt', () => {
    const event = buildSampleMlbEvent({ createdAt: undefined })
    expect(normalizeGamesDiscoveryPayload(event, 'mlb')).toBeNull()
  })

  it('returns null when event has no markets', () => {
    const event = buildSampleMlbEvent({ markets: [] })
    expect(normalizeGamesDiscoveryPayload(event, 'mlb')).toBeNull()
  })

  it('returns null when moneyline market lacks tradeable fields', () => {
    const event = buildSampleMlbEvent({
      markets: [{
        id: '6092912',
        conditionId: '0xabcd1234',
        groupItemTitle: 'Moneyline',
        active: true,
        closed: false,
        outcomes: undefined,
        outcomePrices: undefined,
        clobTokenIds: undefined,
        bestBid: null,
        bestAsk: null,
        lastTradePrice: null,
        volume: 0,
        volume24hr: null,
        slug: 'mlb-tex-nyy-2026-05-05',
        iconUrl: null,
      }],
    })
    expect(normalizeGamesDiscoveryPayload(event, 'mlb')).toBeNull()
  })

  it('returns null for malformed gameStartTime on the moneyline market', () => {
    const base = buildSampleMlbEvent()
    const event = {
      ...base,
      markets: base.markets.map((m, i) => i === 0 ? { ...m, gameStartTime: 'not-a-date' } : m),
    }
    expect(normalizeGamesDiscoveryPayload(event, 'mlb')).toBeNull()
  })

  it('handles missing endDate gracefully (preserves null)', () => {
    const event = buildSampleMlbEvent({ endDate: null })
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')
    expect(result).not.toBeNull()
    expect(result!.end_date).toBeNull()
  })

  it('reflects closed=true when moneyline market is closed', () => {
    const base = buildSampleMlbEvent()
    const event = buildSampleMlbEvent({
      markets: base.markets.map((m, i) => (i === 0 ? { ...m, closed: true } : m)),
    })
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')
    expect(result!.is_closed).toBe(true)
  })
})

describe('normalizeGamesDiscoveryPayload — end-to-end against real Polymarket fixture', () => {
  // Loads the raw Gamma response and runs each event through the same
  // mapper-then-normalize pipeline production uses. Locks the contract that
  // the fix actually works against real API shape, not just synthetic data.
  function loadRealFixture(): unknown[] {
    return JSON.parse(
      readFileSync(
        resolve(__dirname, '../fixtures/polymarket-gamma-mlb-per-game-response.json'),
        'utf8',
      ),
    )
  }

  // Mirrors the mapper in client.ts (`mapGammaEventToPolymarketEvent`) so this
  // test exercises the post-mapper PolymarketEvent shape. Kept inline because
  // the mapper is internal to client.ts; the polymarket-client integration
  // test asserts the schema → mapper contract separately.
  //
  // Phase B v2 expansion: also forwards `sportsMarketType` and `line`. Real
  // Gamma responses carry these fields directly on each market entry; the
  // production mapper picks them up via the relaxed Zod schema in
  // `games-discovery.ts`.
  function gammaEventToPolymarketEvent(raw: any): PolymarketEvent {
    return {
      slug: raw.slug,
      id: raw.id ? String(raw.id) : undefined,
      title: raw.title,
      endDate: raw.endDate ?? null,
      createdAt: raw.createdAt,
      negRisk: raw.negRisk,
      enableNegRisk: raw.enableNegRisk,
      markets: raw.markets.map((m: any) => ({
        id: m.id,
        conditionId: m.conditionId,
        groupItemTitle: m.groupItemTitle ?? '',
        active: m.active,
        closed: m.closed,
        outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes,
        outcomePrices: typeof m.outcomePrices === 'string'
          ? (JSON.parse(m.outcomePrices) as string[]).map(Number) as [number, number]
          : m.outcomePrices,
        clobTokenIds: typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds,
        bestBid: m.bestBid ?? null,
        bestAsk: m.bestAsk ?? null,
        lastTradePrice: m.lastTradePrice ?? null,
        volume: typeof m.volume === 'number' ? m.volume : Number(m.volume) || 0,
        volume24hr: m.volume24hr ?? null,
        slug: m.slug,
        iconUrl: m.icon ?? null,
        gameStartTime: m.gameStartTime,
        sportsMarketType: m.sportsMarketType,
        line: typeof m.line === 'number' ? m.line : null,
      })),
    }
  }

  it('normalizes all 3 fixture events successfully (zero null returns)', () => {
    const fixture = loadRealFixture()
    expect(fixture).toHaveLength(3)

    const results = fixture.map((raw: any) => {
      const event = gammaEventToPolymarketEvent(raw)
      return normalizeGamesDiscoveryPayload(event, 'mlb')
    })

    results.forEach((r) => {
      expect(r).not.toBeNull()
    })
  })

  it('produces correctly-shaped NormalizedGameEvent for each fixture event', () => {
    const fixture = loadRealFixture()
    const results = fixture
      .map((raw: any) => normalizeGamesDiscoveryPayload(gammaEventToPolymarketEvent(raw), 'mlb'))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    expect(results).toHaveLength(3)
    results.forEach((normalized, idx) => {
      const raw = fixture[idx] as any
      expect(normalized.slug).toBe(raw.slug)
      expect(normalized.league).toBe('mlb')
      expect(normalized.title).toBe(raw.title)
      // Phase B v2: every fixture event carries 5 markets (1 moneyline + 1
      // nrfi + 1 spread + 2 totals). The MVP single-market contract is
      // replaced by the multi-section contract.
      expect(normalized.payload.markets).toHaveLength(5)
      const moneyline = normalized.payload.markets.find(m => m.market_type === 'moneyline')
      expect(moneyline).toBeDefined()
      expect(normalized.payload.event_created_at).toBe(raw.createdAt)
      // game_start_time pulled from the moneyline MARKET, not the event
      const moneylineMarket = raw.markets.find((m: any) => m.slug === raw.slug)
      expect(normalized.payload.game_start_time).toBe(moneylineMarket.gameStartTime)
      expect(normalized.game_start_time.toISOString()).toBe(
        new Date(moneylineMarket.gameStartTime).toISOString(),
      )
    })
  })

  it('parses team labels from real Polymarket titles', () => {
    const fixture = loadRealFixture()
    const result = normalizeGamesDiscoveryPayload(
      gammaEventToPolymarketEvent(fixture[0]),
      'mlb',
    )
    // First fixture event: "Milwaukee Brewers vs. St. Louis Cardinals"
    expect(result!.away_team_label).toBe('Milwaukee Brewers')
    expect(result!.home_team_label).toBe('St. Louis Cardinals')
  })

  it('moneyline market with empty groupItemTitle gets event title as question', () => {
    const fixture = loadRealFixture()
    const result = normalizeGamesDiscoveryPayload(
      gammaEventToPolymarketEvent(fixture[0]),
      'mlb',
    )
    // Empty groupItemTitle → falls back to event.title via the `||` chain
    const moneyline = result!.payload.markets.find(m => m.market_type === 'moneyline')
    expect(moneyline!.question).toBe((fixture[0] as any).title)
  })

  it('every market entry on every fixture event carries market_type and line', () => {
    // Multi-section field-presence drift-lock against real fixture data.
    // Confirms `mapAllMarkets` projects every market section (not just
    // moneyline) and each carries both fields.
    const fixture = loadRealFixture()
    const results = fixture
      .map((raw: any) => normalizeGamesDiscoveryPayload(gammaEventToPolymarketEvent(raw), 'mlb'))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    const allMarketTypes = new Set<string>()
    results.forEach((normalized) => {
      normalized.payload.markets.forEach((entry) => {
        // Every entry carries a valid enum value
        expect(['moneyline', 'nrfi', 'spreads', 'totals']).toContain(entry.market_type)
        allMarketTypes.add(entry.market_type)
        // Every entry carries either a number line OR explicit null —
        // never undefined.
        expect(entry.line === null || typeof entry.line === 'number').toBe(true)
        // Section-specific line-presence rules:
        if (entry.market_type === 'moneyline' || entry.market_type === 'nrfi') {
          expect(entry.line).toBeNull()
        }
        else {
          // spreads + totals must carry a numeric line (verified via real
          // fixture: spreads -1.5, totals 7.5 / 8.5 / 9.5 / 10.5)
          expect(typeof entry.line).toBe('number')
        }
      })
    })

    // Confirm we exercised all 4 section types across the 3-event fixture
    expect(allMarketTypes).toEqual(new Set(['moneyline', 'nrfi', 'spreads', 'totals']))
  })
})

describe('discoveredGameMarketsPayloadSchema — back-compat (Adjustment 3 drift-lock)', () => {
  // PreWork.2 (Phase B v2 Session 2): the production schema is now exported
  // from `normalize-games-discovery-payload.ts` and imported directly here.
  // Previously this block defined a replica that drifted silently; importing
  // the canonical schema removes that risk.
  //
  // The critical invariant locked here: `line: z.number().nullable().default(null)`.
  // The `.default(null)` is required for back-compat with existing
  // production rows in `discovered_polymarket_games.markets_payload` that
  // predate the `line` field. Without `.default(null)`, Zod would reject
  // `undefined` (distinct from `null` in Zod's type system) and every legacy
  // row would fail to parse → 404 cascade.

  it('parses a legacy payload that omits the `line` field on each market', () => {
    // Simulates a row written by the pre-Adjustment-3 sync code (no `line`
    // field on any market entry). Adjustment 3's `.default(null)` modifier
    // must absorb the missing field and emit `line: null` on each parsed
    // entry.
    const legacyPayload = {
      event_created_at: '2026-04-29T13:00:18.813855Z',
      game_start_time: '2026-05-05 23:05:00+00',
      markets: [
        {
          polymarket_market_id: '6092912',
          slug: 'mlb-tex-nyy-2026-05-05',
          question: 'Texas Rangers vs. New York Yankees',
          market_type: 'moneyline' as const,
          // line: intentionally omitted
          outcomes: ['Texas Rangers', 'NY Yankees'] as [string, string],
          outcome_prices: ['0.0005', '0.9995'] as [string, string],
          clob_token_ids: ['1392827111', '4408994222'] as [string, string],
          volume: 401789.74,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }

    const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(legacyPayload)
    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      return // narrowing
    }
    expect(parsed.data.markets).toHaveLength(1)
    // Critical invariant: missing `line` becomes explicit `null`, NOT
    // `undefined`. This is what `.default(null)` guarantees.
    expect(parsed.data.markets[0].line).toBeNull()
    expect(parsed.data.markets[0].line).not.toBeUndefined()
  })

  it('parses a payload with `line` explicitly set to null', () => {
    // Sanity: explicit null still works post-Adjustment-3.
    const payload = {
      event_created_at: '2026-04-29T13:00:18.813855Z',
      game_start_time: '2026-05-05 23:05:00+00',
      markets: [
        {
          polymarket_market_id: 'm1',
          slug: 'slug-1',
          question: 'Q',
          market_type: 'nrfi' as const,
          line: null,
          outcomes: ['Yes', 'No'] as [string, string],
          outcome_prices: ['0.5', '0.5'] as [string, string],
          clob_token_ids: ['t1', 't2'] as [string, string],
          volume: 0,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }
    const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      return
    }
    expect(parsed.data.markets[0].line).toBeNull()
  })

  it('parses a payload with `line` set to a numeric value (spreads/totals)', () => {
    const payload = {
      event_created_at: '2026-04-29T13:00:18.813855Z',
      game_start_time: '2026-05-05 23:05:00+00',
      markets: [
        {
          polymarket_market_id: 'm1',
          slug: 'slug-1-spread',
          question: 'Spread (-1.5)',
          market_type: 'spreads' as const,
          line: -1.5,
          outcomes: ['Home', 'Away'] as [string, string],
          outcome_prices: ['0.51', '0.49'] as [string, string],
          clob_token_ids: ['t1', 't2'] as [string, string],
          volume: 100,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
        {
          polymarket_market_id: 'm2',
          slug: 'slug-1-total',
          question: 'O/U 8.5',
          market_type: 'totals' as const,
          line: 8.5,
          outcomes: ['Over', 'Under'] as [string, string],
          outcome_prices: ['0.55', '0.45'] as [string, string],
          clob_token_ids: ['t3', 't4'] as [string, string],
          volume: 200,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }
    const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      return
    }
    expect(parsed.data.markets[0].line).toBe(-1.5)
    expect(parsed.data.markets[1].line).toBe(8.5)
  })

  it('rejects payload with invalid market_type enum value', () => {
    // Sanity: the enum is enforced — typo in market_type would fail.
    const badPayload = {
      event_created_at: '2026-04-29T13:00:18.813855Z',
      game_start_time: '2026-05-05 23:05:00+00',
      markets: [
        {
          polymarket_market_id: 'm1',
          slug: 'slug-1',
          question: 'Q',
          market_type: 'unknown_type', // not in enum
          line: null,
          outcomes: ['Yes', 'No'] as [string, string],
          outcome_prices: ['0.5', '0.5'] as [string, string],
          clob_token_ids: ['t1', 't2'] as [string, string],
          volume: 0,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }
    expect(DiscoveredGameMarketsPayloadSchema.safeParse(badPayload).success).toBe(false)
  })
})

// ---- Phase B v2 v2 NBA enum + player-prop filter coverage ----------------

describe('discoveredGameMarketsPayloadSchema — NBA enum extension (Phase B v2 v2)', () => {
  it('accepts NBA first_half_* market_type values', () => {
    // Drift-lock for the Phase B v2 v2 enum extension. NBA Polymarket Gamma
    // responses include `first_half_moneyline`, `first_half_spreads`, and
    // `first_half_totals` (verified via fixture). The schema MUST accept all
    // three; rejection here would crash the discovery sync silently.
    const payload = {
      event_created_at: '2026-04-29T13:00:21.939504Z',
      game_start_time: '2026-05-06 22:30:00+00',
      markets: [
        {
          polymarket_market_id: 'fh-ml-1',
          slug: 'nba-bos-lal-2026-05-06-1h-moneyline',
          question: '1H Moneyline',
          market_type: 'first_half_moneyline' as const,
          line: null,
          outcomes: ['Boston Celtics', 'Los Angeles Lakers'] as [string, string],
          outcome_prices: ['0.55', '0.45'] as [string, string],
          clob_token_ids: ['0x1', '0x2'] as [string, string],
          volume: 0,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
        {
          polymarket_market_id: 'fh-sp-1',
          slug: 'nba-bos-lal-2026-05-06-1h-spread-home-3pt5',
          question: '1H Spread (-3.5)',
          market_type: 'first_half_spreads' as const,
          line: -3.5,
          outcomes: ['Boston Celtics', 'Los Angeles Lakers'] as [string, string],
          outcome_prices: ['0.50', '0.50'] as [string, string],
          clob_token_ids: ['0x3', '0x4'] as [string, string],
          volume: 100,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
        {
          polymarket_market_id: 'fh-to-1',
          slug: 'nba-bos-lal-2026-05-06-1h-total-110pt5',
          question: '1H O/U 110.5',
          market_type: 'first_half_totals' as const,
          line: 110.5,
          outcomes: ['Over', 'Under'] as [string, string],
          outcome_prices: ['0.51', '0.49'] as [string, string],
          clob_token_ids: ['0x5', '0x6'] as [string, string],
          volume: 50,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }
    const result = DiscoveredGameMarketsPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) {
      const types = result.data.markets.map(m => m.market_type)
      expect(types).toContain('first_half_moneyline')
      expect(types).toContain('first_half_spreads')
      expect(types).toContain('first_half_totals')
    }
  })

  it('rejects payload with player-prop market_type values (NOT in persisted enum)', () => {
    // The persisted-payload schema enum does NOT include `points`, `rebounds`,
    // or `assists`. Production `mapAllMarkets` filters those out BEFORE
    // persist. If a future regression accidentally widened the enum to include
    // them, that would be a contract bug — this test detects it.
    const payload = {
      event_created_at: '2026-04-29T13:00:21.939504Z',
      game_start_time: '2026-05-06 22:30:00+00',
      markets: [
        {
          polymarket_market_id: 'pts-1',
          slug: 'nba-bos-lal-2026-05-06-points-x-25pt5',
          question: 'Points X 25.5',
          market_type: 'points', // not in persisted enum
          line: 25.5,
          outcomes: ['Over', 'Under'] as [string, string],
          outcome_prices: ['0.5', '0.5'] as [string, string],
          clob_token_ids: ['0x1', '0x2'] as [string, string],
          volume: 0,
          is_active: true,
          is_closed: false,
          icon_url: null,
        },
      ],
    }
    expect(DiscoveredGameMarketsPayloadSchema.safeParse(payload).success).toBe(false)
  })
})

describe('mapAllMarkets — NBA player-prop filter (Phase B v2 v2)', () => {
  function buildSampleNbaEvent(): PolymarketEvent {
    // Synthetic NBA event with mixed sections (moneyline + spreads +
    // first_half_moneyline + 3 player-props). The mapper's player-prop
    // filter must drop points/rebounds/assists before persist.
    return {
      slug: 'nba-bos-lal-2026-05-06',
      id: '999001',
      title: 'Boston Celtics vs. Los Angeles Lakers',
      endDate: '2026-05-13T05:00:00Z',
      createdAt: '2026-05-01T10:00:00Z',
      negRisk: false,
      enableNegRisk: false,
      markets: [
        {
          id: 'm-ml',
          conditionId: '0xml',
          groupItemTitle: '',
          active: true,
          closed: false,
          outcomes: ['Boston Celtics', 'Los Angeles Lakers'],
          outcomePrices: [0.55, 0.45],
          clobTokenIds: ['ml1', 'ml2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 1000,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'moneyline',
          line: null,
        },
        {
          id: 'm-sp',
          conditionId: '0xsp',
          groupItemTitle: 'Spread (-3.5)',
          active: true,
          closed: false,
          outcomes: ['Boston Celtics', 'Los Angeles Lakers'],
          outcomePrices: [0.51, 0.49],
          clobTokenIds: ['sp1', 'sp2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 200,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06-spread-home-3pt5',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'spreads',
          line: -3.5,
        },
        {
          id: 'm-fh-ml',
          conditionId: '0xfhml',
          groupItemTitle: '1H Moneyline',
          active: true,
          closed: false,
          outcomes: ['Boston Celtics', 'Los Angeles Lakers'],
          outcomePrices: [0.52, 0.48],
          clobTokenIds: ['fhml1', 'fhml2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 50,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06-1h-moneyline',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'first_half_moneyline',
          line: null,
        },
        // Player-props — must be filtered:
        {
          id: 'm-pts',
          conditionId: '0xpts',
          groupItemTitle: 'Points X 25.5',
          active: true,
          closed: false,
          outcomes: ['Over', 'Under'],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ['pts1', 'pts2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 10,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06-points-x-25pt5',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'points',
          line: 25.5,
        },
        {
          id: 'm-reb',
          conditionId: '0xreb',
          groupItemTitle: 'Rebounds Y 8.5',
          active: true,
          closed: false,
          outcomes: ['Over', 'Under'],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ['reb1', 'reb2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 5,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06-rebounds-y-8pt5',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'rebounds',
          line: 8.5,
        },
        {
          id: 'm-ast',
          conditionId: '0xast',
          groupItemTitle: 'Assists Z 5.5',
          active: true,
          closed: false,
          outcomes: ['Over', 'Under'],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ['ast1', 'ast2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 3,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06-assists-z-5pt5',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          sportsMarketType: 'assists',
          line: 5.5,
        },
      ],
    }
  }

  it('filters NBA player-prop market types (points/rebounds/assists)', () => {
    const event = buildSampleNbaEvent()
    const entries = mapAllMarkets(event)

    // Source has 6 markets. Player-prop filter drops 3 (points + rebounds +
    // assists). Result: 3 entries (moneyline + spreads + first_half_moneyline).
    expect(entries).toHaveLength(3)

    const types = entries.map(e => e.market_type)
    expect(types).toContain('moneyline')
    expect(types).toContain('spreads')
    expect(types).toContain('first_half_moneyline')

    // Negative assertions: no player-prop type leaks through.
    expect(types).not.toContain('points')
    expect(types).not.toContain('rebounds')
    expect(types).not.toContain('assists')
  })

  it('does not emit the missing-sportsMarketType warning for player-prop markets', () => {
    // Player-props are filtered BEFORE the strict-enum + warning emission.
    // The warning should only fire when sportsMarketType is null/undefined,
    // never for explicit player-prop values.
    const event = buildSampleNbaEvent()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mapAllMarkets(event)
      // No warn calls expected — every market in the synthetic event has an
      // explicit sportsMarketType.
      expect(warnSpy).not.toHaveBeenCalled()
    }
    finally {
      warnSpy.mockRestore()
    }
  })

  it('emits a warning when sportsMarketType is missing (defaults to moneyline)', () => {
    // Drift-lock the observability behavior: missing field → warn + default.
    const event: PolymarketEvent = {
      slug: 'nba-bos-lal-2026-05-06',
      id: '999002',
      title: 'Boston Celtics vs. Los Angeles Lakers',
      endDate: null,
      createdAt: '2026-05-01T10:00:00Z',
      negRisk: false,
      enableNegRisk: false,
      markets: [
        {
          id: 'm-no-type',
          conditionId: '0xnt',
          groupItemTitle: '',
          active: true,
          closed: false,
          outcomes: ['A', 'B'],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ['t1', 't2'],
          bestBid: null,
          bestAsk: null,
          lastTradePrice: null,
          volume: 0,
          volume24hr: null,
          slug: 'nba-bos-lal-2026-05-06',
          iconUrl: null,
          gameStartTime: '2026-05-06 22:30:00+00',
          // sportsMarketType intentionally omitted
          line: null,
        },
      ],
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const entries = mapAllMarkets(event)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.market_type).toBe('moneyline') // defaulted
      expect(warnSpy).toHaveBeenCalled()
    }
    finally {
      warnSpy.mockRestore()
    }
  })
})

// ---- Phase B v2 v2 NHL fixture parse regression ---------------------------

describe('normalizeGamesDiscoveryPayload — NHL fixture regression (Phase B v2 v2)', () => {
  function loadNhlFixture(): unknown[] {
    // Some fixtures may have a UTF-8 BOM; strip defensively.
    const raw = readFileSync(
      resolve(__dirname, '../fixtures/polymarket-gamma-nhl-per-game-response.json'),
      'utf8',
    ).replace(/^\uFEFF/, '')
    return JSON.parse(raw) as unknown[]
  }

  // Mirrors the production mapper in `client.ts` for the post-mapper
  // PolymarketEvent shape. Same approach as the MLB end-to-end block.
  function gammaEventToPolymarketEvent(raw: any): PolymarketEvent {
    return {
      slug: raw.slug,
      id: raw.id ? String(raw.id) : undefined,
      title: raw.title,
      endDate: raw.endDate ?? null,
      createdAt: raw.createdAt,
      negRisk: raw.negRisk,
      enableNegRisk: raw.enableNegRisk,
      markets: raw.markets.map((m: any) => ({
        id: m.id,
        conditionId: m.conditionId,
        groupItemTitle: m.groupItemTitle ?? '',
        active: m.active,
        closed: m.closed,
        outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes,
        outcomePrices: typeof m.outcomePrices === 'string'
          ? (JSON.parse(m.outcomePrices) as string[]).map(Number) as [number, number]
          : m.outcomePrices,
        clobTokenIds: typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds,
        bestBid: m.bestBid ?? null,
        bestAsk: m.bestAsk ?? null,
        lastTradePrice: m.lastTradePrice ?? null,
        volume: typeof m.volume === 'number' ? m.volume : Number(m.volume) || 0,
        volume24hr: m.volume24hr ?? null,
        slug: m.slug,
        iconUrl: m.icon ?? null,
        gameStartTime: m.gameStartTime,
        sportsMarketType: m.sportsMarketType,
        line: typeof m.line === 'number' ? m.line : null,
      })),
    }
  }

  it('normalizes ALL NHL fixture events without rejection (9/9 expected)', () => {
    // NHL probe finding: 9/9 events normalize, 49/49 markets pass the
    // schema. This test drift-locks against any future change that drops
    // an event silently.
    const fixture = loadNhlFixture()
    expect(fixture.length).toBeGreaterThan(0)

    const results = fixture.map((raw: any) => {
      const event = gammaEventToPolymarketEvent(raw)
      return normalizeGamesDiscoveryPayload(event, 'nhl')
    })

    const nonNullCount = results.filter(r => r !== null).length
    expect(
      nonNullCount,
      `every NHL fixture event should normalize successfully; got ${nonNullCount}/${fixture.length}`,
    ).toBe(fixture.length)
  })

  it('nHL persisted payload preserves moneyline + totals + spreads sections', () => {
    const fixture = loadNhlFixture()
    const results = fixture
      .map((raw: any) => normalizeGamesDiscoveryPayload(gammaEventToPolymarketEvent(raw), 'nhl'))
      .filter((r): r is NonNullable<typeof r> => r !== null)

    const allMarketTypes = new Set<string>()
    results.forEach((normalized) => {
      normalized.payload.markets.forEach((entry) => {
        allMarketTypes.add(entry.market_type)
      })
    })

    // NHL probe: response shape covers moneyline + totals + spreads. (Not
    // every event has spreads — verified via probe.) At minimum, every
    // event has moneyline + totals.
    expect(allMarketTypes).toContain('moneyline')
    expect(allMarketTypes).toContain('totals')
  })
})
