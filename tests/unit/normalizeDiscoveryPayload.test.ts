import type { PolymarketEvent } from '@/lib/polymarket/types'
import { describe, expect, it } from 'vitest'
import {
  normalizeDiscoveryPayload,
  serializeDiscoveryPayload,
} from '@/lib/polymarket/normalize-discovery-payload'

const FULL_EVENT: PolymarketEvent = {
  slug: 'uefa-champions-league-winner',
  id: '33506',
  title: 'UEFA Champions League Winner',
  endDate: '2026-05-31T00:00:00Z',
  markets: [
    {
      id: 'ucl-arsenal',
      conditionId: '0xUCL-arsenal',
      groupItemTitle: 'Arsenal',
      slug: 'arsenal-win-ucl',
      iconUrl: 'https://polymarket.com/icons/arsenal.png',
      active: true,
      closed: false,
      outcomes: ['Yes', 'No'] as const,
      outcomePrices: [0.295, 0.705] as const,
      clobTokenIds: ['polymarket-arsenal-yes', 'polymarket-arsenal-no'] as const,
      bestBid: 0.293,
      bestAsk: 0.297,
      lastTradePrice: 0.295,
      volume: 5_400_000,
      volume24hr: 220_000,
    },
    {
      id: 'ucl-tbd',
      conditionId: '0xUCL-tbd',
      groupItemTitle: 'TBD',
      // placeholder market — no slug, no icon, no prices, no tokens
      active: false,
      closed: false,
      bestBid: 0,
      bestAsk: 1,
      lastTradePrice: 0,
      volume: 0,
      volume24hr: null,
    },
  ],
}

describe('normalizeDiscoveryPayload', () => {
  it('maps every market into the trimmed sidecar shape', () => {
    const payload = normalizeDiscoveryPayload(FULL_EVENT)

    expect(payload.markets).toHaveLength(2)
    expect(payload.markets[0]).toEqual({
      polymarket_market_id: 'ucl-arsenal',
      slug: 'arsenal-win-ucl',
      short_title: 'Arsenal',
      is_active: true,
      is_closed: false,
      outcome_prices: ['0.295', '0.705'],
      clob_token_ids: ['polymarket-arsenal-yes', 'polymarket-arsenal-no'],
      volume: 5_400_000,
      icon_url: 'https://polymarket.com/icons/arsenal.png',
    })
  })

  it('preserves placeholder markets with null prices and tokens', () => {
    const payload = normalizeDiscoveryPayload(FULL_EVENT)
    const placeholder = payload.markets[1]

    expect(placeholder?.short_title).toBe('TBD')
    expect(placeholder?.outcome_prices).toBeNull()
    expect(placeholder?.clob_token_ids).toBeNull()
    expect(placeholder?.slug).toBeNull()
    expect(placeholder?.icon_url).toBeNull()
  })

  it('persists outcome prices as numeric strings (parity with Gamma raw shape)', () => {
    const payload = normalizeDiscoveryPayload(FULL_EVENT)
    const arsenal = payload.markets[0]

    expect(typeof arsenal?.outcome_prices?.[0]).toBe('string')
    expect(typeof arsenal?.outcome_prices?.[1]).toBe('string')
    expect(arsenal?.outcome_prices?.[0]).toBe('0.295')
    expect(arsenal?.outcome_prices?.[1]).toBe('0.705')
  })

  it('emits an empty markets array when the event has no markets', () => {
    const empty: PolymarketEvent = {
      slug: 'empty-event',
      markets: [],
    }
    const payload = normalizeDiscoveryPayload(empty)
    expect(payload.markets).toEqual([])
  })
})

describe('serializeDiscoveryPayload', () => {
  it('round-trips through JSON parse without losing fields', () => {
    const payload = normalizeDiscoveryPayload(FULL_EVENT)
    const serialized = serializeDiscoveryPayload(payload)
    const parsed = JSON.parse(serialized) as typeof payload

    expect(parsed.markets).toHaveLength(2)
    expect(parsed.markets[0]?.short_title).toBe('Arsenal')
    expect(parsed.markets[1]?.outcome_prices).toBeNull()
  })
})
