import type { MlbGameOverlayResult } from '@/lib/polymarket/types'
import type { Event, Market, Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import { applyMlbGameOverlay } from '@/lib/polymarket/mlb-game-overlay'

const PILOT_SLUG = 'mlb-chc-lad-2026-04-24'

/**
 * Revision 1 invariant — MLB-shaped.
 *
 * Same contract as the FIFA Revision 1 anchor in
 * `tests/unit/eventPageDataFifaOverlay.test.ts`: every `outcome.token_id`
 * (the Kuest CLOB token) survives the overlay pass. The new
 * `polymarket_token_id` field is the ONLY sibling ever set. This test
 * exercises the full 4-market pilot shape so a future refactor that
 * accidentally swaps the two token fields fails on all four market types
 * and both outcomes in each.
 */

function makeOutcome(partial: Partial<Outcome> = {}): Outcome {
  return {
    condition_id: 'cond-x',
    outcome_text: 'Chicago Cubs',
    outcome_index: 0,
    token_id: 'ORIGINAL-KUEST-TOKEN',
    is_winning_outcome: false,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    ...partial,
  }
}

function makeMarket(partial: Partial<Market> = {}): Market {
  return {
    condition_id: 'cond-ml',
    event_id: 'event-mlb',
    title: 'Chicago Cubs vs. Los Angeles Dodgers',
    slug: 'mlb-chc-lad-2026-04-24',
    short_title: undefined,
    sports_market_type: 'moneyline',
    price: 0.5,
    probability: 50,
    volume: 0,
    volume_24h: 0,
    outcomes: [
      makeOutcome({ outcome_index: 0, outcome_text: 'Chicago Cubs', token_id: 'ORIGINAL-KUEST-ML-CHC', condition_id: 'cond-ml' }),
      makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'ORIGINAL-KUEST-ML-LAD', condition_id: 'cond-ml' }),
    ],
    ...partial,
  } as Market
}

describe('applyMlbGameOverlay — Revision 1 invariant (token_id preserved on every outcome)', () => {
  it('preserves token_id across ALL 4 market types × 2 outcomes each (8 outcomes total)', () => {
    const mlMarket = makeMarket({
      condition_id: 'cond-ml',
      sports_market_type: 'moneyline',
      outcomes: [
        makeOutcome({ outcome_index: 0, outcome_text: 'Chicago Cubs', token_id: 'ORIGINAL-ML-CHC', condition_id: 'cond-ml' }),
        makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'ORIGINAL-ML-LAD', condition_id: 'cond-ml' }),
      ],
    })
    const nrfiMarket = makeMarket({
      condition_id: 'cond-nrfi',
      sports_market_type: 'nrfi',
      short_title: 'NRFI',
      outcomes: [
        makeOutcome({ outcome_index: 0, outcome_text: 'Yes Run', token_id: 'ORIGINAL-NRFI-YES', condition_id: 'cond-nrfi' }),
        makeOutcome({ outcome_index: 1, outcome_text: 'No Run', token_id: 'ORIGINAL-NRFI-NO', condition_id: 'cond-nrfi' }),
      ],
    })
    const sprMarket = makeMarket({
      condition_id: 'cond-spr',
      sports_market_type: 'spreads',
      short_title: 'Spread -1.5',
      outcomes: [
        makeOutcome({ outcome_index: 0, outcome_text: 'Chicago Cubs', token_id: 'ORIGINAL-SPR-CHC', condition_id: 'cond-spr' }),
        makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'ORIGINAL-SPR-LAD', condition_id: 'cond-spr' }),
      ],
    })
    const totMarket = makeMarket({
      condition_id: 'cond-tot',
      sports_market_type: 'totals',
      short_title: 'O/U 9.5',
      outcomes: [
        makeOutcome({ outcome_index: 0, outcome_text: 'Over', token_id: 'ORIGINAL-TOT-OVER', condition_id: 'cond-tot' }),
        makeOutcome({ outcome_index: 1, outcome_text: 'Under', token_id: 'ORIGINAL-TOT-UNDER', condition_id: 'cond-tot' }),
      ],
    })

    const event = {
      id: 'event-mlb',
      slug: PILOT_SLUG,
      title: 'Chicago Cubs vs. Los Angeles Dodgers',
      status: 'active',
      start_date: null,
      end_date: null,
      resolved_at: null,
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z',
      icon_url: null,
      active_markets_count: 4,
      total_markets_count: 4,
      markets: [mlMarket, nrfiMarket, sprMarket, totMarket],
    } as unknown as Event

    const overlay: MlbGameOverlayResult = {
      slug: PILOT_SLUG,
      marketsByKey: {
        'moneyline': {
          marketType: 'moneyline',
          line: null,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.405, tokenId: 'POLYMARKET-ML-CHC' },
            'Los Angeles Dodgers': { price: 0.595, tokenId: 'POLYMARKET-ML-LAD' },
          },
          volume: 100,
          closed: false,
        },
        'nrfi': {
          marketType: 'nrfi',
          line: null,
          outcomesByLabel: {
            'Yes Run': { price: 0.515, tokenId: 'POLYMARKET-NRFI-YES' },
            'No Run': { price: 0.485, tokenId: 'POLYMARKET-NRFI-NO' },
          },
          volume: 100,
          closed: false,
        },
        'spreads:-1.5': {
          marketType: 'spreads',
          line: -1.5,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.58, tokenId: 'POLYMARKET-SPR-CHC' },
            'Los Angeles Dodgers': { price: 0.42, tokenId: 'POLYMARKET-SPR-LAD' },
          },
          volume: 100,
          closed: false,
        },
        'totals:9.5': {
          marketType: 'totals',
          line: 9.5,
          outcomesByLabel: {
            Over: { price: 0.435, tokenId: 'POLYMARKET-TOT-OVER' },
            Under: { price: 0.565, tokenId: 'POLYMARKET-TOT-UNDER' },
          },
          volume: 100,
          closed: false,
        },
      },
      stale: false,
      lastUpdatedAt: new Date('2026-04-24T00:00:00Z'),
    }

    const result = applyMlbGameOverlay(event, overlay)

    // Build a simple table of (expected Kuest, expected Polymarket) per outcome.
    const expected: Array<{ text: string, kuest: string, polymarket: string }> = [
      { text: 'Chicago Cubs', kuest: 'ORIGINAL-ML-CHC', polymarket: 'POLYMARKET-ML-CHC' },
      { text: 'Los Angeles Dodgers', kuest: 'ORIGINAL-ML-LAD', polymarket: 'POLYMARKET-ML-LAD' },
      { text: 'Yes Run', kuest: 'ORIGINAL-NRFI-YES', polymarket: 'POLYMARKET-NRFI-YES' },
      { text: 'No Run', kuest: 'ORIGINAL-NRFI-NO', polymarket: 'POLYMARKET-NRFI-NO' },
      { text: 'Chicago Cubs', kuest: 'ORIGINAL-SPR-CHC', polymarket: 'POLYMARKET-SPR-CHC' },
      { text: 'Los Angeles Dodgers', kuest: 'ORIGINAL-SPR-LAD', polymarket: 'POLYMARKET-SPR-LAD' },
      { text: 'Over', kuest: 'ORIGINAL-TOT-OVER', polymarket: 'POLYMARKET-TOT-OVER' },
      { text: 'Under', kuest: 'ORIGINAL-TOT-UNDER', polymarket: 'POLYMARKET-TOT-UNDER' },
    ]

    const allOutcomes = result.markets.flatMap(m => m.outcomes)
    expect(allOutcomes).toHaveLength(8)
    expected.forEach(({ kuest, polymarket }) => {
      const match = allOutcomes.find(o => o.token_id === kuest)
      expect(match, `outcome with token_id ${kuest} should survive overlay`).toBeDefined()
      expect(match?.polymarket_token_id).toBe(polymarket)
    })
  })

  it('does not mutate the original event/markets/outcomes', () => {
    const originalOutcome = makeOutcome({
      outcome_index: 0,
      outcome_text: 'Chicago Cubs',
      token_id: 'IMMUTABLE-KUEST-TOK',
      condition_id: 'cond-ml',
    })
    const originalMarket = makeMarket({
      condition_id: 'cond-ml',
      sports_market_type: 'moneyline',
      price: 0.5,
      outcomes: [
        originalOutcome,
        makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'IMMUTABLE-LAD', condition_id: 'cond-ml' }),
      ],
    })
    const event = { ...{
      id: 'e',
      slug: PILOT_SLUG,
      title: '',
      status: 'active' as const,
      start_date: null,
      end_date: null,
      resolved_at: null,
      created_at: '2026-04-24T00:00:00Z',
      updated_at: '2026-04-24T00:00:00Z',
      icon_url: null,
      active_markets_count: 1,
      total_markets_count: 1,
      markets: [originalMarket],
    } } as unknown as Event
    const overlay: MlbGameOverlayResult = {
      slug: PILOT_SLUG,
      marketsByKey: {
        moneyline: {
          marketType: 'moneyline',
          line: null,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.99, tokenId: 'NEW-PM' },
            'Los Angeles Dodgers': { price: 0.01, tokenId: 'NEW-PM-LAD' },
          },
          volume: 9999,
          closed: false,
        },
      },
      stale: false,
      lastUpdatedAt: new Date(),
    }

    applyMlbGameOverlay(event, overlay)

    expect(originalOutcome.polymarket_token_id).toBeUndefined()
    expect(originalOutcome.token_id).toBe('IMMUTABLE-KUEST-TOK')
    expect(originalOutcome.buy_price).toBeUndefined()
    expect(originalMarket.price).toBe(0.5)
    expect(originalMarket.volume).toBe(0)
  })
})
