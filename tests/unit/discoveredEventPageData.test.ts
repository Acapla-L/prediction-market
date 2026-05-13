import type { DiscoveredEventRow } from '@/lib/db/queries/discovered-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { FIFA_EVENT_SLUG } from '@/lib/polymarket/constants'
import {
  buildSyntheticConditionId,
  buildSyntheticEvent,
  isDiscoveryEnabledForSlug,
  isPolymarketDiscoverySlug,
  loadDiscoveredEventPageData,
  SYNTHETIC_CONDITION_PREFIX,
} from '@/lib/polymarket/discovery'

// Mock next/cache so the `'use cache'` + cacheTag inside loadDiscoveredEventPageData
// is a no-op under the Vitest Node environment.
vi.mock('next/cache', () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}))

// Mock the repository so we control the row returned without touching the DB.
vi.mock('@/lib/db/queries/discovered-events', () => ({
  DiscoveredEventsRepository: {
    getBySlug: vi.fn(),
  },
}))

const mockedRepo = vi.mocked(DiscoveredEventsRepository)

function makeRow(overrides: Partial<DiscoveredEventRow> = {}): DiscoveredEventRow {
  return {
    slug: 'uefa-champions-league-winner',
    polymarketEventId: '33506',
    title: 'UEFA Champions League Winner',
    isActive: true,
    endDate: '2026-05-31T00:00:00.000Z',
    marketsPayload: JSON.stringify({
      markets: [
        {
          polymarket_market_id: 'arsenal-mkt',
          slug: 'arsenal-win-ucl',
          short_title: 'Arsenal',
          is_active: true,
          is_closed: false,
          outcome_prices: ['0.295', '0.705'],
          clob_token_ids: ['polymarket-arsenal-yes', 'polymarket-arsenal-no'],
          volume: 5_400_000,
          icon_url: 'https://polymarket.com/arsenal.png',
        },
        {
          polymarket_market_id: 'placeholder-mkt',
          slug: null,
          short_title: 'TBD',
          is_active: false,
          is_closed: false,
          outcome_prices: null,
          clob_token_ids: null,
          volume: null,
          icon_url: null,
        },
      ],
    }),
    lastSyncedAt: '2026-05-04T15:00:00.000Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
    ...overrides,
  }
}

describe('discovery — slug helpers', () => {
  it('isPolymarketDiscoverySlug: true for an allowlisted slug', () => {
    expect(isPolymarketDiscoverySlug('uefa-champions-league-winner')).toBe(true)
    expect(isPolymarketDiscoverySlug('2026-nba-champion')).toBe(true)
  })

  it('isPolymarketDiscoverySlug: false for FIFA (FIFA is a separate code path)', () => {
    expect(isPolymarketDiscoverySlug(FIFA_EVENT_SLUG)).toBe(false)
  })

  it('isPolymarketDiscoverySlug: false for an arbitrary string', () => {
    expect(isPolymarketDiscoverySlug('not-an-allowlisted-slug')).toBe(false)
  })

  it('buildSyntheticConditionId: namespaced format', () => {
    expect(buildSyntheticConditionId('uefa-champions-league-winner', 'arsenal-mkt'))
      .toBe('polymarket-discovered:uefa-champions-league-winner:arsenal-mkt')
  })

  it('buildSyntheticConditionId: synthetic ids never collide with on-chain hex condition_ids', () => {
    const id = buildSyntheticConditionId('any-slug', 'any-id')
    // On-chain condition_ids are 0x-prefixed hex strings; the synthetic prefix
    // guarantees no collision.
    expect(id.startsWith('0x')).toBe(false)
    expect(id.startsWith(SYNTHETIC_CONDITION_PREFIX)).toBe(true)
  })
})

describe('discovery — kill switch (isDiscoveryEnabledForSlug)', () => {
  const ORIGINAL_FLAG = process.env.POLYMARKET_DISCOVERY_ENABLED

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.POLYMARKET_DISCOVERY_ENABLED
    }
    else {
      process.env.POLYMARKET_DISCOVERY_ENABLED = ORIGINAL_FLAG
    }
  })

  it('returns true for an allowlisted slug when the env var is unset (default-on)', () => {
    delete process.env.POLYMARKET_DISCOVERY_ENABLED
    expect(isDiscoveryEnabledForSlug('uefa-champions-league-winner')).toBe(true)
  })

  it('returns false for any slug when env var is "false"', () => {
    process.env.POLYMARKET_DISCOVERY_ENABLED = 'false'
    expect(isDiscoveryEnabledForSlug('uefa-champions-league-winner')).toBe(false)
    expect(isDiscoveryEnabledForSlug('2026-nba-champion')).toBe(false)
  })

  it('returns false for any slug when env var is "0"', () => {
    process.env.POLYMARKET_DISCOVERY_ENABLED = '0'
    expect(isDiscoveryEnabledForSlug('2026-nba-champion')).toBe(false)
  })

  it('returns false for a non-allowlisted slug regardless of env var', () => {
    process.env.POLYMARKET_DISCOVERY_ENABLED = 'true'
    expect(isDiscoveryEnabledForSlug('not-an-allowlisted-slug')).toBe(false)
  })

  it('returns false for the FIFA slug (FIFA is a separate code path, not discovery)', () => {
    process.env.POLYMARKET_DISCOVERY_ENABLED = 'true'
    expect(isDiscoveryEnabledForSlug(FIFA_EVENT_SLUG)).toBe(false)
  })
})

describe('discovery — buildSyntheticEvent shape', () => {
  it('namespaces the synthetic event id and main_tag from metadata', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    expect(event.id).toBe('polymarket-discovered:uefa-champions-league-winner')
    expect(event.slug).toBe('uefa-champions-league-winner')
    expect(event.main_tag).toBe('ucl')
    expect(event.creator).toBe('polymarket-discovered')
  })

  it('sets enable_neg_risk + neg_risk on event so EventChart renders multi-market chart', () => {
    // Without these flags, EventChart short-circuits at line 1086 (`shouldHideChart`)
    // for multi-market events and renders only meta-info instead of the price-history
    // chart — see docs/audits/discovery-chart-gap-2026-05-05.md.
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    expect(event.enable_neg_risk).toBe(true)
    expect(event.neg_risk).toBe(true)
  })

  it('sets neg_risk: true on every synthetic market', () => {
    // Mirrors the `negRisk: true` value Polymarket Gamma returns for every market
    // on these event types. Read by resolution-timeline-builder (cosmetic) and
    // EventOrderPanelForm.isNegRiskMarket (fallback path).
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    for (const market of event.markets) {
      expect(market.neg_risk).toBe(true)
    }
  })

  it('uses payload.event_created_at as Event.created_at when present (chart ALL-range fix)', () => {
    // Without this, the chart's ALL range starts at lastSyncedAt (NOW per cron)
    // and only shows ~1 hour of history. With it, the range covers full
    // Polymarket history. See docs/audits/discovery-chart-time-range-gap-2026-05-05.md.
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const withCreatedAt = { ...payload, event_created_at: '2025-07-21T20:58:38.352062Z' }
    const event = buildSyntheticEvent(row, withCreatedAt)

    expect(event.created_at).toBe('2025-07-21T20:58:38.352062Z')
    // updated_at remains lastSyncedAt — represents "last refreshed" not creation
    expect(event.updated_at).toBe(row.lastSyncedAt)
  })

  it('falls back to lastSyncedAt when payload.event_created_at is absent (backwards-compat)', () => {
    // Older sidecar rows synced before the field was added don't have
    // event_created_at — synthetic Event must still build without crashing.
    // Next hourly sync overwrites with the real Polymarket creation date.
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    expect(payload.event_created_at).toBeUndefined()
    const event = buildSyntheticEvent(row, payload)

    expect(event.created_at).toBe(row.lastSyncedAt)
  })

  it('every market gets a namespaced synthetic condition_id', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    expect(event.markets).toHaveLength(2)
    expect(event.markets[0]?.condition_id).toBe('polymarket-discovered:uefa-champions-league-winner:arsenal-mkt')
    expect(event.markets[1]?.condition_id).toBe('polymarket-discovered:uefa-champions-league-winner:placeholder-mkt')
  })

  it('every outcome carries polymarket_token_id == token_id (no Kuest mirror exists)', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)
    const arsenal = event.markets[0]

    expect(arsenal?.outcomes).toHaveLength(2)
    expect(arsenal?.outcomes[0]?.token_id).toBe('polymarket-arsenal-yes')
    expect(arsenal?.outcomes[0]?.polymarket_token_id).toBe('polymarket-arsenal-yes')
    expect(arsenal?.outcomes[1]?.token_id).toBe('polymarket-arsenal-no')
    expect(arsenal?.outcomes[1]?.polymarket_token_id).toBe('polymarket-arsenal-no')
  })

  it('outcome_index 0 is YES, outcome_index 1 is NO', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)
    const arsenal = event.markets[0]

    expect(arsenal?.outcomes[0]?.outcome_index).toBe(0)
    expect(arsenal?.outcomes[0]?.outcome_text).toBe('Yes')
    expect(arsenal?.outcomes[1]?.outcome_index).toBe(1)
    expect(arsenal?.outcomes[1]?.outcome_text).toBe('No')
  })

  it('placeholder markets render with empty token strings and zero prices', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)
    const placeholder = event.markets[1]

    expect(placeholder?.outcomes[0]?.token_id).toBe('')
    expect(placeholder?.outcomes[0]?.polymarket_token_id).toBe('')
    expect(placeholder?.price).toBe(0)
    expect(placeholder?.probability).toBe(0)
  })

  it('price is the YES decimal probability and probability is the percent', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)
    const arsenal = event.markets[0]

    expect(arsenal?.price).toBeCloseTo(0.295, 5)
    expect(arsenal?.probability).toBeCloseTo(29.5, 5)
  })

  it('aggregates active_markets_count, total_markets_count, and total volume', () => {
    const row = makeRow()
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    // 1 active (Arsenal) + 1 inactive placeholder = 2 total
    expect(event.active_markets_count).toBe(1)
    expect(event.total_markets_count).toBe(2)
    expect(event.volume).toBe(5_400_000)
    expect(event.status).toBe('active')
  })

  it('event status flips to resolved when no active markets remain', () => {
    const row = makeRow({
      marketsPayload: JSON.stringify({
        markets: [{
          polymarket_market_id: 'closed-mkt',
          slug: null,
          short_title: 'Closed',
          is_active: false,
          is_closed: true,
          outcome_prices: ['1', '0'],
          clob_token_ids: ['t1', 't2'],
          volume: 100,
          icon_url: null,
        }],
      }),
    })
    const payload = JSON.parse(row.marketsPayload) as Parameters<typeof buildSyntheticEvent>[1]
    const event = buildSyntheticEvent(row, payload)

    expect(event.active_markets_count).toBe(0)
    expect(event.status).toBe('resolved')
  })
})

describe('discovery — loadDiscoveredEventPageData', () => {
  beforeEach(() => {
    mockedRepo.getBySlug.mockReset()
  })

  it('returns null when the repository row is missing', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: null, error: null })
    const result = await loadDiscoveredEventPageData('uefa-champions-league-winner')
    expect(result).toBeNull()
  })

  it('returns null when the repository errors', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: null, error: 'db down' })
    const result = await loadDiscoveredEventPageData('any-slug')
    expect(result).toBeNull()
  })

  it('returns null when last_sync_status is failure AND markets_payload is empty', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({
      data: makeRow({ lastSyncStatus: 'gamma_404', marketsPayload: '' }),
      error: null,
    })
    const result = await loadDiscoveredEventPageData('any-slug')
    expect(result).toBeNull()
  })

  it('returns null when markets_payload is invalid JSON', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({
      data: makeRow({ marketsPayload: '{not-json' }),
      error: null,
    })
    const result = await loadDiscoveredEventPageData('any-slug')
    expect(result).toBeNull()
  })

  it('returns null when markets_payload Zod-fails (markets is not an array)', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({
      data: makeRow({ marketsPayload: JSON.stringify({ markets: 'oops' }) }),
      error: null,
    })
    const result = await loadDiscoveredEventPageData('any-slug')
    expect(result).toBeNull()
  })

  it('returns null when markets_payload parses but has zero markets', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({
      data: makeRow({ marketsPayload: JSON.stringify({ markets: [] }) }),
      error: null,
    })
    const result = await loadDiscoveredEventPageData('any-slug')
    expect(result).toBeNull()
  })

  it('returns a populated EventPageContentData on the happy path', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: makeRow(), error: null })
    const result = await loadDiscoveredEventPageData('uefa-champions-league-winner')

    expect(result).not.toBeNull()
    expect(result?.event.slug).toBe('uefa-champions-league-winner')
    expect(result?.event.markets).toHaveLength(1)
    expect(result?.changeLogEntries).toEqual([])
    expect(result?.seriesEvents).toEqual([])
    expect(result?.liveChartConfig).toBeNull()
    expect(result?.marketContextEnabled).toBe(false)
  })

  it('serves cached payload even when last_sync_status is a failure (as long as payload is non-empty)', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({
      data: makeRow({ lastSyncStatus: 'gamma_404' }),
      error: null,
    })
    const result = await loadDiscoveredEventPageData('uefa-champions-league-winner')
    // Stale payload still serves — just like the FIFA overlay's stale path.
    expect(result).not.toBeNull()
    expect(result?.event.markets).toHaveLength(1)
  })
})
