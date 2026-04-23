import { describe, expect, it } from 'vitest'
import { resolvePriceHistoryEndpoint } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

const FIFA_SLUG = '2026-fifa-world-cup-winner-595'

describe('resolvePriceHistoryEndpoint — non-FIFA events', () => {
  it('routes non-FIFA events to Kuest CLOB + market= param', () => {
    const endpoint = resolvePriceHistoryEndpoint('will-neymar-play', [
      { conditionId: 'c1', tokenId: 'kuest-yes' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
    expect(endpoint.tokenParamName).toBe('market')
    expect(endpoint.baseUrl).toContain('/prices-history')
    expect(endpoint.baseUrl).not.toContain('/api/polymarket')
  })

  it('routes non-FIFA events to Kuest even if a ghost polymarketTokenId is present', () => {
    // Defensive: a non-FIFA event should NEVER hit the polymarket proxy,
    // regardless of the target's polymarketTokenId value. Routing is
    // gated on eventSlug === FIFA_EVENT_SLUG first.
    const endpoint = resolvePriceHistoryEndpoint('some-other-event', [
      { conditionId: 'c1', tokenId: 'kuest-t1', polymarketTokenId: 'poly-ghost' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
    expect(endpoint.tokenParamName).toBe('market')
  })
})

describe('resolvePriceHistoryEndpoint — FIFA event', () => {
  it('routes FIFA + at least one polymarketTokenId to the proxy with token= param', () => {
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'kuest-spain-yes', polymarketTokenId: 'polymarket-spain-yes' },
      { conditionId: 'c2', tokenId: 'kuest-france-yes', polymarketTokenId: 'polymarket-france-yes' },
    ])
    expect(endpoint.source).toBe('polymarket-proxy')
    expect(endpoint.baseUrl).toBe('/api/polymarket/prices-history')
    expect(endpoint.tokenParamName).toBe('token')
  })

  it('routes FIFA + mixed batch (some with polymarketTokenId, some without) to the proxy', () => {
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'kuest-italy-yes' }, // no overlay entry
      { conditionId: 'c2', tokenId: 'kuest-spain-yes', polymarketTokenId: 'polymarket-spain-yes' },
    ])
    expect(endpoint.source).toBe('polymarket-proxy')
  })

  it('rEVISION 4 COLD-CACHE FALLBACK: routes FIFA + zero polymarketTokenIds to Kuest', () => {
    // If the FIFA overlay was cold + Polymarket upstream was down, no outcome
    // got polymarket_token_id set. Every target's polymarketTokenId stays
    // undefined. The hook must fall back to Kuest CLOB instead of hitting
    // the proxy (which would return empty for Kuest tokens).
    const endpoint = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      { conditionId: 'c1', tokenId: 'kuest-spain-yes' },
      { conditionId: 'c2', tokenId: 'kuest-france-yes' },
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
