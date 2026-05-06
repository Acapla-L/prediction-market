import type { PolymarketEvent } from '@/lib/polymarket/types'
import { describe, expect, it } from 'vitest'
import {
  normalizeGamesDiscoveryPayload,
  parseTeamLabels,
  pickMoneylineMarket,
} from '@/lib/polymarket/normalize-games-discovery-payload'

// Sample MLB event constructed to mirror Polymarket Gamma's per-game shape
// observed in §Investigate.1 (Texas Rangers vs NY Yankees, 2026-05-05).
function buildSampleMlbEvent(overrides: Partial<PolymarketEvent> = {}): PolymarketEvent {
  return {
    slug: 'mlb-tex-nyy-2026-05-05',
    id: '431041',
    title: 'Texas Rangers vs. New York Yankees',
    endDate: '2026-05-12T23:05:00Z',
    createdAt: '2026-04-29T13:00:18.813855Z',
    gameStartTime: '2026-05-05 23:05:00+00',
    negRisk: false,
    enableNegRisk: false,
    markets: [
      {
        id: '6092912',
        conditionId: '0xabcd1234',
        groupItemTitle: 'Moneyline',
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

  it('returns null when event lacks gameStartTime', () => {
    const event = buildSampleMlbEvent({ gameStartTime: undefined })
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

  it('returns null for malformed gameStartTime', () => {
    const event = buildSampleMlbEvent({ gameStartTime: 'not-a-date' })
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
