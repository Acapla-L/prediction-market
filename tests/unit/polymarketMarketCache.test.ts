import type { Market } from '@/types'
// platform/tests/unit/polymarketMarketCache.test.ts
import { describe, expect, it } from 'vitest'
import { buildYesTokenMapping } from '@/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache'

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
