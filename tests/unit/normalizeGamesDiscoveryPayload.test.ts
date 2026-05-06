import type { PolymarketEvent } from '@/lib/polymarket/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeGamesDiscoveryPayload,
  parseTeamLabels,
  pickMoneylineMarket,
} from '@/lib/polymarket/normalize-games-discovery-payload'

// Sample MLB event constructed to mirror Polymarket Gamma's per-game shape
// observed in `tests/fixtures/polymarket-gamma-mlb-per-game-response.json`.
//
// Key conformance to real-API shape:
//   - `gameStartTime` lives at the MARKET level, not the event level.
//   - The Moneyline market (slug exact-matches the parent event slug) has
//     `groupItemTitle: undefined` (Polymarket convention — market IS the
//     matchup, no team name to label).
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

  it('payload contains exactly ONE market entry (moneyline only — MVP scope)', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    expect(result!.payload.markets).toHaveLength(1)
    expect(result!.payload.markets[0].market_type).toBe('moneyline')
    expect(result!.payload.markets[0].polymarket_market_id).toBe('6092912')
  })

  it('payload moneyline outcomes match the event title order', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    expect(result!.payload.markets[0].outcomes).toEqual(['Texas Rangers', 'NY Yankees'])
    expect(result!.payload.markets[0].outcome_prices).toEqual(['0.0005', '0.9995'])
  })

  it('payload preserves event_created_at for chart ALL-range', () => {
    const event = buildSampleMlbEvent()
    const result = normalizeGamesDiscoveryPayload(event, 'mlb')

    expect(result!.payload.event_created_at).toBe('2026-04-29T13:00:18.813855Z')
    expect(result!.payload.game_start_time).toBe('2026-05-05 23:05:00+00')
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
    const event = buildSampleMlbEvent({
      markets: [{
        ...buildSampleMlbEvent().markets[0],
        closed: true,
      }],
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
      expect(normalized.payload.markets).toHaveLength(1) // moneyline-only MVP
      expect(normalized.payload.markets[0].market_type).toBe('moneyline')
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
    expect(result!.payload.markets[0].question).toBe(
      (fixture[0] as any).title,
    )
  })
})
