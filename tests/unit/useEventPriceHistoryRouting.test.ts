import type { Market, Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import {
  buildMarketTargets,
  resolvePriceHistoryEndpoint,
} from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { OUTCOME_INDEX } from '@/lib/constants'

const FIFA_SLUG = '2026-fifa-world-cup-winner-595'

function makeOutcome(partial: Partial<Outcome> = {}): Outcome {
  return {
    condition_id: 'cond-x',
    outcome_text: 'Yes',
    outcome_index: 0,
    token_id: 'kuest-token',
    is_winning_outcome: false,
    created_at: '2026-04-22T00:00:00Z',
    updated_at: '2026-04-22T00:00:00Z',
    ...partial,
  }
}

function makeMarket(partial: Partial<Market> = {}): Market {
  return {
    condition_id: 'cond-x',
    event_id: 'event-1',
    title: 'Will X win?',
    slug: 'will-x-win',
    outcomes: [
      makeOutcome({ outcome_index: 0, token_id: 'kuest-yes' }),
      makeOutcome({ outcome_index: 1, token_id: 'kuest-no' }),
    ],
    ...partial,
  } as Market
}

describe('buildMarketTargets — source marker + polymarket preference', () => {
  it('prefers polymarket_token_id when present and marks source=polymarket', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({
          outcome_index: 0,
          token_id: 'kuest-yes-KEEP',
          polymarket_token_id: 'polymarket-yes',
        }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tokenId).toBe('polymarket-yes')
    expect(targets[0]?.source).toBe('polymarket')
  })

  it('falls back to token_id when polymarket_token_id is absent and marks source=kuest', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-only' }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tokenId).toBe('kuest-only')
    expect(targets[0]?.source).toBe('kuest')
  })

  it('falls back to token_id when polymarket_token_id is explicitly null', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-only', polymarket_token_id: null }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)
    expect(targets[0]?.tokenId).toBe('kuest-only')
    expect(targets[0]?.source).toBe('kuest')
  })

  it('picks the NO outcome when outcomeIndex=NO', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-yes', polymarket_token_id: 'polymarket-yes' }),
        makeOutcome({ outcome_index: 1, token_id: 'kuest-no', polymarket_token_id: 'polymarket-no' }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.NO)
    expect(targets[0]?.tokenId).toBe('polymarket-no')
    expect(targets[0]?.source).toBe('polymarket')
  })
})

describe('resolvePriceHistoryEndpoint — non-FIFA events', () => {
  it('routes non-FIFA events to Kuest CLOB + market= param', () => {
    const endpoint = resolvePriceHistoryEndpoint('will-neymar-play', [
      { conditionId: 'c1', tokenId: 'kuest-yes', source: 'kuest' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
    expect(endpoint.tokenParamName).toBe('market')
    expect(endpoint.baseUrl).toContain('/prices-history')
    expect(endpoint.baseUrl).not.toContain('/api/polymarket')
  })

  it('routes non-FIFA events to Kuest even if some ghost polymarket target exists', () => {
    // Defensive: a non-FIFA event should NEVER hit the polymarket proxy,
    // even if a target was mislabeled with source='polymarket'.
    const endpoint = resolvePriceHistoryEndpoint('some-other-event', [
      { conditionId: 'c1', tokenId: 'p-yes', source: 'polymarket' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
    expect(endpoint.tokenParamName).toBe('market')
  })
})

describe('resolvePriceHistoryEndpoint — FIFA event', () => {
  it('routes FIFA + polymarket-sourced targets to the proxy with token= param', () => {
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'polymarket-spain-yes', source: 'polymarket' },
      { conditionId: 'c2', tokenId: 'polymarket-france-yes', source: 'polymarket' },
    ])
    expect(endpoint.source).toBe('polymarket-proxy')
    expect(endpoint.baseUrl).toBe('/api/polymarket/prices-history')
    expect(endpoint.tokenParamName).toBe('token')
  })

  it('routes FIFA + at-least-one polymarket target to the proxy (mixed batch)', () => {
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'kuest-italy-yes', source: 'kuest' },
      { conditionId: 'c2', tokenId: 'polymarket-spain-yes', source: 'polymarket' },
    ])
    expect(endpoint.source).toBe('polymarket-proxy')
  })

  it('rEVISION 4 COLD-CACHE FALLBACK: routes FIFA + zero-polymarket-targets to Kuest', () => {
    // This is the cold-cache fallback test. If the FIFA overlay was cold +
    // Polymarket upstream was down, no outcome got polymarket_token_id, so
    // every target has source='kuest'. The hook must fall back to Kuest
    // CLOB instead of hitting the proxy (which would return empty).
    // Preserves the "never worse than today" invariant.
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'kuest-spain-yes', source: 'kuest' },
      { conditionId: 'c2', tokenId: 'kuest-france-yes', source: 'kuest' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
    expect(endpoint.tokenParamName).toBe('market')
    expect(endpoint.baseUrl).not.toContain('/api/polymarket')
  })

  it('rEVISION 4 empty-targets edge: FIFA + empty targets array falls back to Kuest', () => {
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [])
    expect(endpoint.source).toBe('kuest-clob')
  })
})
