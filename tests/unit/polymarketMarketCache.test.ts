import type { Market } from '@/types'
import { QueryClient } from '@tanstack/react-query'
// platform/tests/unit/polymarketMarketCache.test.ts
import { describe, expect, it } from 'vitest'

import { applyPolymarketMessage, buildYesTokenMapping } from '@/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache'

function syntheticMarket(conditionId: string, yesTok: string, noTok: string, opts?: { active?: boolean, resolved?: boolean }): Market {
  return {
    condition_id: conditionId,
    is_active: opts?.active ?? true,
    is_resolved: opts?.resolved ?? false,
    outcomes: [
      { condition_id: conditionId, outcome_index: 0, token_id: yesTok, polymarket_token_id: yesTok, outcome_text: 'Yes' },
      { condition_id: conditionId, outcome_index: 1, token_id: noTok, polymarket_token_id: noTok, outcome_text: 'No' },
    ],
  } as unknown as Market
}

describe('buildYesTokenMapping', () => {
  it('returns only YES (outcome_index 0) polymarket tokens of ACTIVE, unresolved markets', () => {
    const markets = [
      syntheticMarket('polymarket-discovered:nba:1', 'YES1', 'NO1'),
      syntheticMarket('polymarket-discovered:nba:2', 'YES2', 'NO2', { resolved: true }),
      syntheticMarket('polymarket-discovered:nba:3', 'YES3', 'NO3', { active: false }),
    ]
    const { tokenIds, tokenIdToConditionId } = buildYesTokenMapping(markets)
    expect(tokenIds).toEqual(['YES1'])
    expect(tokenIdToConditionId.get('YES1')).toBe('polymarket-discovered:nba:1')
    expect(tokenIds).not.toContain('NO1')
  })

  it('skips outcomes with no polymarket_token_id (Kuest-native) → empty mapping', () => {
    const kuest = { condition_id: 'k1', is_active: true, is_resolved: false, outcomes: [{ condition_id: 'k1', outcome_index: 0, token_id: 'KT', polymarket_token_id: null, outcome_text: 'Yes' }] } as unknown as Market
    expect(buildYesTokenMapping([kuest]).tokenIds).toEqual([])
  })

  it('dedupes and is stable-ordered', () => {
    const m = syntheticMarket('c', 'DUP', 'NO')
    expect(buildYesTokenMapping([m, m]).tokenIds).toEqual(['DUP'])
  })
})

const MAPPING = { tokenIds: ['YES1'], tokenIdToConditionId: new Map([['YES1', 'cond1']]) }

describe('applyPolymarketMessage', () => {
  it('book event seeds the orderbook-summary cache top-of-book for the token', () => {
    const qc = new QueryClient()
    qc.setQueryData(['orderbook-summary', 'YES1'], {})
    applyPolymarketMessage(qc, MAPPING, {
      event_type: 'book',
      asset_id: 'YES1',
      bids: [{ price: '0.41', size: '10' }],
      asks: [{ price: '0.43', size: '20' }],
    })
    const data = qc.getQueryData<any>(['orderbook-summary', 'YES1'])
    expect(data.YES1.bids[0]).toEqual({ price: '0.41', size: '10' })
    expect(data.YES1.asks[0]).toEqual({ price: '0.43', size: '20' })
  })

  it('best_bid_ask event writes a conditionId-keyed quote into event-market-quotes', () => {
    const qc = new QueryClient()
    qc.setQueryData(['event-market-quotes', 'cond1:YES1'], {})
    applyPolymarketMessage(qc, MAPPING, { event_type: 'best_bid_ask', asset_id: 'YES1', best_bid: '0.42', best_ask: '0.44' })
    const data = qc.getQueryData<any>(['event-market-quotes', 'cond1:YES1'])
    expect(data.cond1).toEqual({ bid: 0.42, ask: 0.44, mid: 0.43 })
  })

  it('ignores PONG / unknown event types / unmapped tokens without throwing', () => {
    const qc = new QueryClient()
    expect(() => applyPolymarketMessage(qc, MAPPING, { event_type: 'tick_size_change', asset_id: 'UNKNOWN' })).not.toThrow()
  })
})
