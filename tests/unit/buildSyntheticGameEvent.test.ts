import type { DiscoveredGameRow } from '@/lib/db/queries/discovered-games'
import type { DiscoveredGameMarketsPayload } from '@/lib/polymarket/normalize-games-discovery-payload'
import { describe, expect, it } from 'vitest'
import {
  buildSyntheticGameConditionId,
  buildSyntheticGameEvent,
  SYNTHETIC_GAME_CONDITION_PREFIX,
} from '@/lib/polymarket/games-discovery'
import { isSyntheticConditionId } from '@/lib/polymarket/synthetic-prefixes'

function makeRow(overrides: Partial<DiscoveredGameRow> = {}): DiscoveredGameRow {
  return {
    slug: 'mlb-tex-nyy-2026-05-05',
    league: 'mlb',
    polymarketEventId: '431041',
    title: 'Texas Rangers vs. New York Yankees',
    homeTeamLabel: 'New York Yankees',
    awayTeamLabel: 'Texas Rangers',
    gameStartTime: '2026-05-05T23:05:00.000Z',
    isActive: true,
    isClosed: false,
    isArchived: false,
    endDate: '2026-05-12T23:05:00.000Z',
    marketsPayload: '{}',
    lastSyncedAt: '2026-05-05T20:00:00.000Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
    ...overrides,
  }
}

function makePayload(overrides: Partial<DiscoveredGameMarketsPayload> = {}): DiscoveredGameMarketsPayload {
  return {
    event_created_at: '2026-04-29T13:00:18.813855Z',
    game_start_time: '2026-05-05T23:05:00.000Z',
    markets: [
      {
        polymarket_market_id: '6092912',
        slug: 'mlb-tex-nyy-2026-05-05',
        question: 'Moneyline',
        market_type: 'moneyline',
        outcomes: ['Texas Rangers', 'NY Yankees'],
        outcome_prices: ['0.0005', '0.9995'],
        clob_token_ids: ['1392827111', '4408994222'],
        volume: 401789.74,
        is_active: true,
        is_closed: false,
        icon_url: null,
      },
    ],
    ...overrides,
  }
}

describe('buildSyntheticGameConditionId', () => {
  it('namespaces ids with the per-game prefix + slug + market id', () => {
    const id = buildSyntheticGameConditionId('mlb-tex-nyy-2026-05-05', '6092912')
    expect(id).toBe('polymarket-discovered-game:mlb-tex-nyy-2026-05-05:6092912')
  })

  it('is recognized by isSyntheticConditionId', () => {
    const id = buildSyntheticGameConditionId('mlb-tex-nyy-2026-05-05', '6092912')
    expect(isSyntheticConditionId(id)).toBe(true)
  })

  it('does NOT collide with Phase A v2 futures prefix', () => {
    const id = buildSyntheticGameConditionId('mlb-tex-nyy-2026-05-05', '6092912')
    // Phase A v2 prefix `polymarket-discovered:` (with colon at position 21)
    // vs Phase B prefix `polymarket-discovered-game:` (dash at position 21).
    // Phase A v2's startsWith check returns false for Phase B IDs.
    expect(id.startsWith('polymarket-discovered:')).toBe(false)
  })
})

describe('sYNTHETIC_GAME_CONDITION_PREFIX', () => {
  it('does not include the trailing colon', () => {
    expect(SYNTHETIC_GAME_CONDITION_PREFIX).toBe('polymarket-discovered-game')
  })
})

describe('buildSyntheticGameEvent', () => {
  it('builds an Event with namespaced id', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.id).toBe('polymarket-discovered-game:mlb-tex-nyy-2026-05-05')
  })

  it('preserves slug and title from row', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.slug).toBe('mlb-tex-nyy-2026-05-05')
    expect(event.title).toBe('Texas Rangers vs. New York Yankees')
  })

  it('sets total_markets_count to 1 (MVP single-market lock)', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    // total_markets_count = 1 makes EventChart.shouldHideChart short-circuit
    // via isSingleMarket=true; chart renders without needing enable_neg_risk.
    expect(event.total_markets_count).toBe(1)
    expect(event.markets).toHaveLength(1)
  })

  it('does NOT set enable_neg_risk or neg_risk on the Event', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    // Per-game IS NOT neg-risk on Polymarket (negRisk: false, enableNegRisk: false).
    // Phase B mirrors source truth; chart renders via the single-market path.
    expect(event.enable_neg_risk).toBeUndefined()
    expect(event.neg_risk).toBeUndefined()
  })

  it('per-market neg_risk is false (mirrors Polymarket source)', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.markets[0].neg_risk).toBe(false)
  })

  it('event.created_at sources from payload.event_created_at (not lastSyncedAt)', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    // This is the PR #9 fix carried forward — chart ALL-range lower bound
    // uses Polymarket's createdAt, not our hourly cron timestamp.
    expect(event.created_at).toBe('2026-04-29T13:00:18.813855Z')
  })

  it('main_tag is the league slug (not "sports")', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.main_tag).toBe('mlb')
  })

  it('main_tag falls back to "sports" for unknown-league slugs', () => {
    const event = buildSyntheticGameEvent(
      makeRow({ slug: 'xyz-foo-bar-2026-05-05' }),
      makePayload(),
    )
    expect(event.main_tag).toBe('sports')
  })

  it('creator marks the event as Phase B synthetic', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.creator).toBe('polymarket-discovered-game')
  })

  it('outcomes have BOTH token_id and polymarket_token_id pointing at the same Polymarket token', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    const market = event.markets[0]
    expect(market.outcomes).toHaveLength(2)

    // Outcome 0 (home) — token_id and polymarket_token_id both = clob_token_ids[0]
    expect(market.outcomes[0].token_id).toBe('1392827111')
    expect(market.outcomes[0].polymarket_token_id).toBe('1392827111')

    // Outcome 1 (away) — token_id and polymarket_token_id both = clob_token_ids[1]
    expect(market.outcomes[1].token_id).toBe('4408994222')
    expect(market.outcomes[1].polymarket_token_id).toBe('4408994222')
  })

  it('outcome text matches Polymarket outcomes labels', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.markets[0].outcomes[0].outcome_text).toBe('Texas Rangers')
    expect(event.markets[0].outcomes[1].outcome_text).toBe('NY Yankees')
  })

  it('synthetic condition_id is filtered by isSyntheticConditionId', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(isSyntheticConditionId(event.markets[0].condition_id)).toBe(true)
  })

  it('status is "active" when at least one market is active+open', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.status).toBe('active')
    expect(event.active_markets_count).toBe(1)
  })

  it('status is "resolved" when all markets are closed', () => {
    const closedPayload = makePayload({
      markets: [{
        ...makePayload().markets[0],
        is_closed: true,
      }],
    })
    const event = buildSyntheticGameEvent(makeRow(), closedPayload)
    expect(event.status).toBe('resolved')
    expect(event.active_markets_count).toBe(0)
  })

  it('volume aggregates from all markets', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.volume).toBe(401789.74)
  })

  it('end_date passes through from row', () => {
    const event = buildSyntheticGameEvent(makeRow(), makePayload())
    expect(event.end_date).toBe('2026-05-12T23:05:00.000Z')
  })
})
