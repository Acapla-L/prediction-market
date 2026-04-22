import type { FifaOverlayResult } from '@/lib/polymarket/types'
import type { Event, Market, Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import { applyFifaOverlay } from '@/lib/event-page-data'

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
    short_title: 'X',
    price: 0.5,
    probability: 50,
    volume: 0,
    volume_24h: 0,
    outcomes: [
      makeOutcome({ outcome_index: 0, outcome_text: 'Yes', token_id: 'kuest-yes', condition_id: 'cond-x' }),
      makeOutcome({ outcome_index: 1, outcome_text: 'No', token_id: 'kuest-no', condition_id: 'cond-x' }),
    ],
    ...partial,
  } as Market
}

function makeEvent(partial: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    slug: 'some-event-slug',
    title: 'Some event',
    status: 'active',
    start_date: null,
    end_date: null,
    resolved_at: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-22T00:00:00Z',
    icon_url: null,
    active_markets_count: 1,
    total_markets_count: 1,
    markets: [makeMarket()],
    ...partial,
  } as Event
}

function makeOverlay(partial: Partial<FifaOverlayResult> = {}): FifaOverlayResult {
  return {
    marketsByCountry: {},
    stale: false,
    lastUpdatedAt: new Date('2026-04-22T00:00:00Z'),
    ...partial,
  }
}

describe('applyFifaOverlay — non-FIFA events', () => {
  it('passes a non-FIFA event through unchanged (polymarket_token_id stays undefined)', () => {
    const event = makeEvent({
      slug: 'will-neymar-play-in-the-2026-fifa-world-cup-for-brazil',
      markets: [makeMarket({ short_title: 'Brazil' })],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Brazil: {
          country: 'Brazil',
          yesPrice: 0.09,
          noPrice: 0.91,
          volume: 12345,
          closed: false,
          yesTokenId: 'polymarket-brazil-yes',
          noTokenId: 'polymarket-brazil-no',
        },
      },
    })

    const result = applyFifaOverlay(event, overlay)

    // The overlay has a Brazil entry but this is the Neymar event, NOT the FIFA
    // slug — the loader's guard clause should never even reach applyFifaOverlay
    // for non-FIFA slugs. This test exercises the defensive guard inside
    // applyFifaOverlay in case a future caller forgets the slug check.
    expect(result).toBe(event) // same reference — zero mutation
    expect(result.markets[0]?.price).toBe(0.5) // unchanged
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[0]?.outcomes[0]?.token_id).toBe('kuest-yes')
  })
})

describe('applyFifaOverlay — FIFA event happy path (Revision 1 anchor)', () => {
  const FIFA_SLUG = '2026-fifa-world-cup-winner-595'

  it('stitches price + probability + volume on a matched market', () => {
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [makeMarket({
        short_title: 'Spain',
        price: 0.01,
        probability: 1,
        volume: 0,
      })],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Spain: {
          country: 'Spain',
          yesPrice: 0.16,
          noPrice: 0.84,
          volume: 250000,
          closed: false,
          yesTokenId: 'polymarket-spain-yes',
          noTokenId: 'polymarket-spain-no',
        },
      },
    })

    const result = applyFifaOverlay(event, overlay)

    expect(result.markets[0]?.price).toBe(0.16)
    expect(result.markets[0]?.probability).toBe(16)
    expect(result.markets[0]?.volume).toBe(250000)
  })

  it('sets polymarket_token_id on BOTH YES (0) and NO (1) outcomes and NEVER touches token_id', () => {
    // THIS IS THE REVISION 1 REGRESSION ANCHOR.
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [makeMarket({
        short_title: 'Spain',
        outcomes: [
          makeOutcome({
            outcome_index: 0,
            outcome_text: 'Yes',
            token_id: 'ORIGINAL-KUEST-YES-TOKEN',
            condition_id: 'cond-spain',
          }),
          makeOutcome({
            outcome_index: 1,
            outcome_text: 'No',
            token_id: 'ORIGINAL-KUEST-NO-TOKEN',
            condition_id: 'cond-spain',
          }),
        ],
      })],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Spain: {
          country: 'Spain',
          yesPrice: 0.16,
          noPrice: 0.84,
          volume: 0,
          closed: false,
          yesTokenId: 'POLYMARKET-SPAIN-YES',
          noTokenId: 'POLYMARKET-SPAIN-NO',
        },
      },
    })

    const result = applyFifaOverlay(event, overlay)
    const yesOutcome = result.markets[0]?.outcomes[0]
    const noOutcome = result.markets[0]?.outcomes[1]

    // Revision 1 anchor — token_id MUST be preserved exactly.
    expect(yesOutcome?.token_id).toBe('ORIGINAL-KUEST-YES-TOKEN')
    expect(noOutcome?.token_id).toBe('ORIGINAL-KUEST-NO-TOKEN')

    // polymarket_token_id populated on both outcomes.
    expect(yesOutcome?.polymarket_token_id).toBe('POLYMARKET-SPAIN-YES')
    expect(noOutcome?.polymarket_token_id).toBe('POLYMARKET-SPAIN-NO')
  })

  it('overrides buy_price and sell_price on both outcomes but does NOT set last_trade_price (field is not on the Outcome type)', () => {
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [makeMarket({
        short_title: 'Spain',
        outcomes: [
          makeOutcome({ outcome_index: 0, buy_price: 0.01, sell_price: 0.02 }),
          makeOutcome({ outcome_index: 1, buy_price: 0.98, sell_price: 0.99 }),
        ],
      })],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Spain: {
          country: 'Spain',
          yesPrice: 0.16,
          noPrice: 0.84,
          volume: 0,
          closed: false,
          yesTokenId: 'tok-y',
          noTokenId: 'tok-n',
        },
      },
    })

    const result = applyFifaOverlay(event, overlay)
    expect(result.markets[0]?.outcomes[0]?.buy_price).toBe(0.16)
    expect(result.markets[0]?.outcomes[0]?.sell_price).toBe(0.16)
    expect(result.markets[0]?.outcomes[1]?.buy_price).toBe(0.84)
    expect(result.markets[0]?.outcomes[1]?.sell_price).toBe(0.84)
    // last_trade_price is NOT on the Outcome type and must not be set.
    expect(
      'last_trade_price' in (result.markets[0]?.outcomes[0] ?? {}),
    ).toBe(false)
  })

  it('passes through a market with NO overlay entry unchanged (no polymarket_token_id added)', () => {
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [
        makeMarket({ short_title: 'Spain' }),
        makeMarket({ short_title: 'Atlantis' }), // not in overlay
      ],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Spain: {
          country: 'Spain',
          yesPrice: 0.16,
          noPrice: 0.84,
          volume: 0,
          closed: false,
          yesTokenId: 'y',
          noTokenId: 'n',
        },
      },
    })

    const result = applyFifaOverlay(event, overlay)
    // Spain gets stitched
    expect(result.markets[0]?.price).toBe(0.16)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('y')
    // Atlantis (no overlay entry) passes through untouched
    expect(result.markets[1]?.price).toBe(0.5)
    expect(result.markets[1]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[1]?.outcomes[0]?.token_id).toBe('kuest-yes')
  })

  it('does not mutate the original event or markets (immutability check)', () => {
    const originalOutcome = makeOutcome({
      outcome_index: 0,
      token_id: 'original-kuest-yes',
      condition_id: 'cond-spain',
    })
    const originalMarket = makeMarket({
      short_title: 'Spain',
      price: 0.01,
      outcomes: [originalOutcome, makeOutcome({
        outcome_index: 1,
        token_id: 'original-kuest-no',
        condition_id: 'cond-spain',
      })],
    })
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [originalMarket],
    })
    const overlay = makeOverlay({
      marketsByCountry: {
        Spain: {
          country: 'Spain',
          yesPrice: 0.16,
          noPrice: 0.84,
          volume: 9999,
          closed: false,
          yesTokenId: 'new-y',
          noTokenId: 'new-n',
        },
      },
    })

    applyFifaOverlay(event, overlay)

    // Original objects unchanged after the overlay pass
    expect(originalOutcome.polymarket_token_id).toBeUndefined()
    expect(originalOutcome.token_id).toBe('original-kuest-yes')
    expect(originalOutcome.buy_price).toBeUndefined()
    expect(originalMarket.price).toBe(0.01)
    expect(originalMarket.volume).toBe(0)
  })

  it('still returns the event when overlay.stale is true — graceful degradation', () => {
    const event = makeEvent({
      slug: FIFA_SLUG,
      markets: [makeMarket({ short_title: 'Spain' })],
    })
    const overlay = makeOverlay({
      marketsByCountry: {},
      stale: true,
    })

    const result = applyFifaOverlay(event, overlay)
    // Empty overlay + stale -> markets pass through unchanged
    expect(result.markets[0]?.price).toBe(0.5)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[0]?.outcomes[0]?.token_id).toBe('kuest-yes')
  })
})
