import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { describe, expect, it } from 'vitest'
import { resolvePriceHistoryEndpoint } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

/**
 * Regression + contract test for the one ENTANGLED FIFA touch in this pilot:
 *   `useEventPriceHistory.ts:resolvePriceHistoryEndpoint` — the guard clause
 *   that routes the chart-history fetch to the Polymarket proxy.
 *
 * Rules (from the updated guard, extended from FIFA-only to FIFA + MLB pilot):
 *   - Non-allowlisted slug → Kuest CLOB, always.
 *   - FIFA slug + any target has polymarketTokenId → Polymarket proxy.
 *   - MLB pilot slug + any target has polymarketTokenId → Polymarket proxy.
 *   - Allowlisted slug + ZERO polymarket targets (cold-cache fallback) → Kuest CLOB.
 */

const FIFA_SLUG = '2026-fifa-world-cup-winner-595'
const MLB_PILOT_SLUG = 'mlb-chc-lad-2026-04-24'

function makeTarget(partial: Partial<MarketTokenTarget> = {}): MarketTokenTarget {
  return {
    conditionId: 'cond-x',
    tokenId: 'kuest-token',
    ...partial,
  }
}

describe('resolvePriceHistoryEndpoint — Polymarket-proxy routing (FIFA + MLB allowlist)', () => {
  it('fIFA slug + polymarket target → polymarket-proxy endpoint (regression)', () => {
    const ep = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      makeTarget({ polymarketTokenId: 'pm-spain-yes' }),
    ])
    expect(ep.source).toBe('polymarket-proxy')
    expect(ep.baseUrl).toBe('/api/polymarket/prices-history')
    expect(ep.tokenParamName).toBe('token')
  })

  it('mLB pilot slug + polymarket target → polymarket-proxy endpoint (new)', () => {
    const ep = resolvePriceHistoryEndpoint(MLB_PILOT_SLUG, [
      makeTarget({ polymarketTokenId: 'pm-chc-lad-ml-chc' }),
    ])
    expect(ep.source).toBe('polymarket-proxy')
    expect(ep.baseUrl).toBe('/api/polymarket/prices-history')
    expect(ep.tokenParamName).toBe('token')
  })

  it('non-allowlisted slug + polymarket target → Kuest CLOB (scope-lock)', () => {
    // Sanity: a random slug that happens to have a polymarket target must
    // still route to Kuest. This locks the scope-lock invariant that only
    // allowlisted slugs opt into the Polymarket proxy path.
    const ep = resolvePriceHistoryEndpoint('some-other-event-slug', [
      makeTarget({ polymarketTokenId: 'pm-anything' }),
    ])
    expect(ep.source).toBe('kuest-clob')
    expect(ep.tokenParamName).toBe('market')
  })

  it('non-allowlisted MLB slug (not in MLB_GAME_SLUGS) + polymarket target → Kuest CLOB', () => {
    // An expired or future MLB slug that we have not explicitly added to the
    // allowlist must still route to Kuest. This is the pilot's whole point
    // — one game active, nothing else.
    const ep = resolvePriceHistoryEndpoint('mlb-atl-laa-2026-04-07', [
      makeTarget({ polymarketTokenId: 'pm-hypothetical' }),
    ])
    expect(ep.source).toBe('kuest-clob')
  })

  it('mLB pilot slug + ZERO polymarket targets → Kuest CLOB (cold-cache fallback)', () => {
    // When the overlay returned an empty map (e.g. Polymarket upstream
    // failure), no target has polymarketTokenId set. The hook falls back to
    // Kuest CLOB rather than hitting the proxy with a Kuest token. Matches
    // Revision 4 of the FIFA plan applied to MLB.
    const ep = resolvePriceHistoryEndpoint(MLB_PILOT_SLUG, [
      makeTarget({ tokenId: 'kuest-only' }),
    ])
    expect(ep.source).toBe('kuest-clob')
  })

  it('fIFA slug + ZERO polymarket targets → Kuest CLOB (regression: original FIFA fallback behavior unchanged)', () => {
    const ep = resolvePriceHistoryEndpoint(FIFA_SLUG, [
      makeTarget({ tokenId: 'kuest-only' }),
    ])
    expect(ep.source).toBe('kuest-clob')
  })

  it('empty targets array always routes to Kuest CLOB', () => {
    expect(resolvePriceHistoryEndpoint(FIFA_SLUG, []).source).toBe('kuest-clob')
    expect(resolvePriceHistoryEndpoint(MLB_PILOT_SLUG, []).source).toBe('kuest-clob')
    expect(resolvePriceHistoryEndpoint('anything', []).source).toBe('kuest-clob')
  })
})
