import { describe, expect, it } from 'vitest'
import { resolvePriceHistoryEndpoint } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

const ALLOWLIST_SLUGS = [
  // FIFA — preserved as the original overlay
  '2026-fifa-world-cup-winner-595',
  // Phase A v2 day-1 discovery slugs
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  '2026-nhl-stanley-cup-champion',
  'big-game-champion-2027',
  'uefa-champions-league-winner',
] as const

describe('resolvePriceHistoryEndpoint — Phase A v2 allowlist (FIFA + 5 discovered)', () => {
  for (const slug of ALLOWLIST_SLUGS) {
    it(`routes ${slug} + polymarketTokenId to the Polymarket proxy`, () => {
      const endpoint = resolvePriceHistoryEndpoint(slug, [
        {
          conditionId: `cond-${slug}`,
          tokenId: 'kuest-or-polymarket-token',
          polymarketTokenId: 'polymarket-token',
        },
      ])
      expect(endpoint.source).toBe('polymarket-proxy')
      expect(endpoint.baseUrl).toBe('/api/polymarket/prices-history')
      expect(endpoint.tokenParamName).toBe('token')
    })

    it(`falls back to Kuest CLOB when ${slug} has zero polymarketTokenIds (cold-cache safety)`, () => {
      const endpoint = resolvePriceHistoryEndpoint(slug, [
        { conditionId: `cond-${slug}`, tokenId: 'kuest-only' },
      ])
      expect(endpoint.source).toBe('kuest-clob')
      expect(endpoint.tokenParamName).toBe('market')
    })
  }
})

describe('resolvePriceHistoryEndpoint — non-allowlisted slugs always go to Kuest', () => {
  it('uses Kuest CLOB for an arbitrary slug even with polymarketTokenId set', () => {
    const endpoint = resolvePriceHistoryEndpoint('not-in-the-allowlist', [
      { conditionId: 'c1', tokenId: 'kuest-t1', polymarketTokenId: 'poly-ghost' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
  })

  it('uses Kuest CLOB for an empty targets array on a non-allowlisted slug', () => {
    const endpoint = resolvePriceHistoryEndpoint('also-not-in-the-allowlist', [])
    expect(endpoint.source).toBe('kuest-clob')
  })

  it('uses Kuest CLOB for the empty string slug (defensive)', () => {
    const endpoint = resolvePriceHistoryEndpoint('', [
      { conditionId: 'c1', tokenId: 'kuest-t1', polymarketTokenId: 'poly-ghost' },
    ])
    expect(endpoint.source).toBe('kuest-clob')
  })
})
