import type { Market, Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import { buildMarketTargets } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import { OUTCOME_INDEX } from '@/lib/constants'

/**
 * Regression guard for the session 026 post-deploy bug:
 *
 * The earlier implementation of `buildMarketTargets` preferred
 * `polymarket_token_id` and put it into `target.tokenId`. Since
 * `MarketTokenTarget.tokenId` is also consumed by `useEventMarketQuotes`
 * and `useEventLastTrades` — both of which POST it to Kuest's `/prices`
 * endpoint — FIFA sidebars 404'd in production when the Kuest endpoint
 * received Polymarket token IDs.
 *
 * Contract (locked by these tests):
 *   - `tokenId` is ALWAYS the Kuest token. Never the Polymarket token.
 *   - `polymarketTokenId` carries the Polymarket token separately when the
 *     FIFA overlay populated `outcome.polymarket_token_id`. Consumed only
 *     by the chart hook when routing to the Polymarket proxy.
 */

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

describe('buildMarketTargets — tokenId shape (session 026 regression guard)', () => {
  it('keeps Kuest tokenId when polymarket_token_id is populated (CRITICAL: if tokenId becomes Polymarket, Bug B regresses)', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({
          outcome_index: 0,
          token_id: 'kuest-abc',
          polymarket_token_id: 'poly-xyz',
        }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)

    expect(targets).toHaveLength(1)
    // THE regression assertion — tokenId MUST be the Kuest token, never Polymarket.
    expect(targets[0]?.tokenId).toBe('kuest-abc')
    expect(targets[0]?.tokenId).not.toBe('poly-xyz')
    // Polymarket token is carried separately.
    expect(targets[0]?.polymarketTokenId).toBe('poly-xyz')
  })

  it('polymarketTokenId is undefined when source outcome has no polymarket_token_id (non-FIFA outcomes)', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-abc' }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)

    expect(targets).toHaveLength(1)
    expect(targets[0]?.tokenId).toBe('kuest-abc')
    expect(targets[0]?.polymarketTokenId).toBeUndefined()
  })

  it('polymarketTokenId is undefined when source outcome has polymarket_token_id explicitly null', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-abc', polymarket_token_id: null }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.YES)

    expect(targets[0]?.tokenId).toBe('kuest-abc')
    expect(targets[0]?.polymarketTokenId).toBeUndefined()
  })

  it('picks the NO outcome when outcomeIndex=NO, keeps Kuest tokenId + separate polymarket token', () => {
    const markets: Market[] = [makeMarket({
      outcomes: [
        makeOutcome({ outcome_index: 0, token_id: 'kuest-yes', polymarket_token_id: 'poly-yes' }),
        makeOutcome({ outcome_index: 1, token_id: 'kuest-no', polymarket_token_id: 'poly-no' }),
      ],
    })]
    const targets = buildMarketTargets(markets, OUTCOME_INDEX.NO)

    expect(targets[0]?.tokenId).toBe('kuest-no')
    expect(targets[0]?.polymarketTokenId).toBe('poly-no')
  })
})
