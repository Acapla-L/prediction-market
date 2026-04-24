import type { MlbGameOverlayResult } from '@/lib/polymarket/types'
import type { Event, Market, Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import { applyMlbGameOverlay } from '@/lib/polymarket/mlb-game-overlay'

const PILOT_SLUG = 'mlb-chc-lad-2026-04-24'

function makeOutcome(partial: Partial<Outcome> = {}): Outcome {
  return {
    condition_id: 'cond-x',
    outcome_text: 'Chicago Cubs',
    outcome_index: 0,
    token_id: 'kuest-token',
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
      makeOutcome({ outcome_index: 0, outcome_text: 'Chicago Cubs', token_id: 'kuest-ml-chc', condition_id: 'cond-ml' }),
      makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'kuest-ml-lad', condition_id: 'cond-ml' }),
    ],
    ...partial,
  } as Market
}

function makeEvent(partial: Partial<Event> = {}): Event {
  return {
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
    markets: [makeMarket()],
    ...partial,
  } as Event
}

function makeOverlay(partial: Partial<MlbGameOverlayResult> = {}): MlbGameOverlayResult {
  return {
    slug: PILOT_SLUG,
    marketsByKey: {},
    stale: false,
    lastUpdatedAt: new Date('2026-04-24T00:00:00Z'),
    ...partial,
  }
}

describe('applyMlbGameOverlay — non-MLB-pilot events', () => {
  it('passes a non-MLB event through unchanged (same reference, polymarket_token_id stays undefined)', () => {
    const event = makeEvent({
      slug: 'mlb-atl-laa-2026-04-07', // reference game, NOT in MLB_GAME_SLUGS allowlist
      markets: [makeMarket({ sports_market_type: 'moneyline' })],
    })
    const overlay = makeOverlay({
      slug: 'mlb-atl-laa-2026-04-07',
      marketsByKey: {
        moneyline: {
          marketType: 'moneyline',
          line: null,
          outcomesByLabel: { 'Chicago Cubs': { price: 0.4, tokenId: 'pm' } },
          volume: 99,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    expect(result).toBe(event) // zero mutation
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[0]?.outcomes[0]?.token_id).toBe('kuest-ml-chc')
  })

  it('returns the event unchanged when overlay.slug differs from event.slug (defensive)', () => {
    const event = makeEvent({ slug: PILOT_SLUG })
    // Overlay built for a different slug — caller error
    const overlay = makeOverlay({ slug: 'mlb-other-pilot-2026-04-25' })
    const result = applyMlbGameOverlay(event, overlay)
    expect(result).toBe(event)
  })
})

describe('applyMlbGameOverlay — pilot slug happy paths', () => {
  it('stitches moneyline prices + probability + volume + polymarket_token_id', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [makeMarket({
        sports_market_type: 'moneyline',
        price: 0.5,
        probability: 50,
        volume: 0,
      })],
    })
    const overlay = makeOverlay({
      marketsByKey: {
        moneyline: {
          marketType: 'moneyline',
          line: null,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.405, tokenId: 'pm-ml-chc' },
            'Los Angeles Dodgers': { price: 0.595, tokenId: 'pm-ml-lad' },
          },
          volume: 122000,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    expect(result.markets[0]?.price).toBe(0.405)
    expect(result.markets[0]?.probability).toBe(40.5)
    expect(result.markets[0]?.volume).toBe(122000)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('pm-ml-chc')
    expect(result.markets[0]?.outcomes[1]?.polymarket_token_id).toBe('pm-ml-lad')
  })

  it('stitches NRFI using normalized outcome text (Yes Run / No Run)', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [makeMarket({
        sports_market_type: 'nrfi',
        short_title: 'NRFI',
        outcomes: [
          makeOutcome({ outcome_index: 0, outcome_text: 'Yes Run', token_id: 'kuest-nrfi-yes', condition_id: 'cond-nrfi' }),
          makeOutcome({ outcome_index: 1, outcome_text: 'No Run', token_id: 'kuest-nrfi-no', condition_id: 'cond-nrfi' }),
        ],
      })],
    })
    const overlay = makeOverlay({
      marketsByKey: {
        nrfi: {
          marketType: 'nrfi',
          line: null,
          outcomesByLabel: {
            'Yes Run': { price: 0.515, tokenId: 'pm-nrfi-yes' },
            'No Run': { price: 0.485, tokenId: 'pm-nrfi-no' },
          },
          volume: 110,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    expect(result.markets[0]?.outcomes[0]?.buy_price).toBe(0.515)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('pm-nrfi-yes')
    expect(result.markets[0]?.outcomes[1]?.buy_price).toBe(0.485)
    expect(result.markets[0]?.outcomes[1]?.polymarket_token_id).toBe('pm-nrfi-no')
  })

  it('stitches totals by parsing line from short_title', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [makeMarket({
        sports_market_type: 'totals',
        short_title: 'O/U 9.5',
        outcomes: [
          makeOutcome({ outcome_index: 0, outcome_text: 'Over', token_id: 'kuest-tot-over', condition_id: 'cond-tot' }),
          makeOutcome({ outcome_index: 1, outcome_text: 'Under', token_id: 'kuest-tot-under', condition_id: 'cond-tot' }),
        ],
      })],
    })
    const overlay = makeOverlay({
      marketsByKey: {
        'totals:9.5': {
          marketType: 'totals',
          line: 9.5,
          outcomesByLabel: {
            Over: { price: 0.435, tokenId: 'pm-tot-over' },
            Under: { price: 0.565, tokenId: 'pm-tot-under' },
          },
          volume: 212,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('pm-tot-over')
    expect(result.markets[0]?.outcomes[1]?.polymarket_token_id).toBe('pm-tot-under')
  })

  it('stitches spreads by parsing line from short_title (negative line preserved)', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [makeMarket({
        sports_market_type: 'spreads',
        short_title: 'Spread -1.5',
        outcomes: [
          makeOutcome({ outcome_index: 0, outcome_text: 'Chicago Cubs', token_id: 'kuest-spr-chc', condition_id: 'cond-spr' }),
          makeOutcome({ outcome_index: 1, outcome_text: 'Los Angeles Dodgers', token_id: 'kuest-spr-lad', condition_id: 'cond-spr' }),
        ],
      })],
    })
    const overlay = makeOverlay({
      marketsByKey: {
        'spreads:-1.5': {
          marketType: 'spreads',
          line: -1.5,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.58, tokenId: 'pm-spr-chc' },
            'Los Angeles Dodgers': { price: 0.42, tokenId: 'pm-spr-lad' },
          },
          volume: 23,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('pm-spr-chc')
    expect(result.markets[0]?.outcomes[1]?.polymarket_token_id).toBe('pm-spr-lad')
  })

  it('passes through a DB market with NO overlay entry unchanged (partial overlay safe)', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [
        makeMarket({ sports_market_type: 'moneyline' }),
        makeMarket({
          sports_market_type: 'totals',
          short_title: 'O/U 11.5', // line not covered by overlay
          condition_id: 'cond-tot-2',
          outcomes: [
            makeOutcome({ outcome_index: 0, outcome_text: 'Over', token_id: 'kuest-over-2', condition_id: 'cond-tot-2' }),
            makeOutcome({ outcome_index: 1, outcome_text: 'Under', token_id: 'kuest-under-2', condition_id: 'cond-tot-2' }),
          ],
        }),
      ],
    })
    const overlay = makeOverlay({
      marketsByKey: {
        moneyline: {
          marketType: 'moneyline',
          line: null,
          outcomesByLabel: {
            'Chicago Cubs': { price: 0.4, tokenId: 'pm-ml-chc' },
            'Los Angeles Dodgers': { price: 0.6, tokenId: 'pm-ml-lad' },
          },
          volume: 100,
          closed: false,
        },
      },
    })

    const result = applyMlbGameOverlay(event, overlay)
    // moneyline got stitched
    expect(result.markets[0]?.price).toBe(0.4)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBe('pm-ml-chc')
    // O/U 11.5 (no overlay entry) passed through untouched
    expect(result.markets[1]?.price).toBe(0.5)
    expect(result.markets[1]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[1]?.outcomes[0]?.token_id).toBe('kuest-over-2')
  })

  it('gracefully handles stale overlay with empty marketsByKey', () => {
    const event = makeEvent({
      slug: PILOT_SLUG,
      markets: [makeMarket({ sports_market_type: 'moneyline' })],
    })
    const overlay = makeOverlay({ marketsByKey: {}, stale: true })
    const result = applyMlbGameOverlay(event, overlay)
    expect(result.markets[0]?.price).toBe(0.5)
    expect(result.markets[0]?.outcomes[0]?.polymarket_token_id).toBeUndefined()
    expect(result.markets[0]?.outcomes[0]?.token_id).toBe('kuest-ml-chc')
  })
})
