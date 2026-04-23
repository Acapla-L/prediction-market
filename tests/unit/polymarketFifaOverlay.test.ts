import type { PolymarketMarket } from '@/lib/polymarket/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFifaGammaEvent } from '@/lib/polymarket/client'
import { buildFifaOverlay } from '@/lib/polymarket/fifa-overlay'

vi.mock('@/lib/polymarket/client', () => ({
  fetchFifaGammaEvent: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchFifaGammaEvent)

function makeMarket(overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  return {
    id: 'm1',
    conditionId: '0xabc',
    groupItemTitle: 'DefaultCountry',
    active: true,
    closed: false,
    outcomes: ['Yes', 'No'],
    outcomePrices: [0.5, 0.5],
    clobTokenIds: ['yes-token', 'no-token'],
    bestBid: null,
    bestAsk: null,
    lastTradePrice: null,
    volume: 0,
    volume24hr: null,
    ...overrides,
  }
}

describe('buildFifaOverlay — upstream failure path', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('returns stale:true with empty marketsByCountry when Gamma fetch returns null', async () => {
    mockedFetch.mockResolvedValueOnce(null)
    const result = await buildFifaOverlay()
    expect(result.stale).toBe(true)
    expect(result.marketsByCountry).toEqual({})
    expect(result.lastUpdatedAt).toBeInstanceOf(Date)
  })

  it('never throws — upstream failure path is non-exceptional', async () => {
    mockedFetch.mockResolvedValueOnce(null)
    await expect(buildFifaOverlay()).resolves.toBeDefined()
  })
})

describe('buildFifaOverlay — filtering', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('filters out markets where active=false (Team AM / Team AI placeholders)', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [
        makeMarket({ groupItemTitle: 'Team AM', active: false }),
        makeMarket({ groupItemTitle: 'Team AI', active: false }),
        makeMarket({ groupItemTitle: 'Spain', active: true }),
      ],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry['Team AM']).toBeUndefined()
    expect(result.marketsByCountry['Team AI']).toBeUndefined()
    expect(result.marketsByCountry.Spain).toBeDefined()
    expect(Object.keys(result.marketsByCountry)).toHaveLength(1)
  })

  it('filters out markets where closed=true (eliminated teams like Italy)', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [
        makeMarket({ groupItemTitle: 'Italy', closed: true }),
        makeMarket({ groupItemTitle: 'Spain' }),
      ],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry.Italy).toBeUndefined()
    expect(result.marketsByCountry.Spain).toBeDefined()
  })

  it('keeps a market that is active=true and closed=false', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [makeMarket({ groupItemTitle: 'Spain', active: true, closed: false })],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry.Spain).toBeDefined()
    expect(result.marketsByCountry.Spain?.closed).toBe(false)
  })
})

describe('buildFifaOverlay — normalization', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('keys Czechia under Cezchia (DB typo normalization)', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [makeMarket({ groupItemTitle: 'Czechia' })],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry.Czechia).toBeUndefined()
    expect(result.marketsByCountry.Cezchia).toBeDefined()
    expect(result.marketsByCountry.Cezchia?.country).toBe('Cezchia')
  })

  it('passes all other country names through to marketsByCountry as-is', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [
        makeMarket({ groupItemTitle: 'Spain' }),
        makeMarket({ groupItemTitle: 'Bosnia-Herzegovina' }),
        makeMarket({ groupItemTitle: 'USA' }),
        makeMarket({ groupItemTitle: 'Curaçao' }),
      ],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry.Spain).toBeDefined()
    expect(result.marketsByCountry['Bosnia-Herzegovina']).toBeDefined()
    expect(result.marketsByCountry.USA).toBeDefined()
    expect(result.marketsByCountry['Curaçao']).toBeDefined()
  })
})

describe('buildFifaOverlay — stitching', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('stitches yesPrice, noPrice, volume, closed, and both token IDs correctly', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [makeMarket({
        groupItemTitle: 'Spain',
        outcomePrices: [0.16, 0.84],
        clobTokenIds: ['polymarket-spain-yes', 'polymarket-spain-no'],
        volume: 99999,
      })],
    })
    const result = await buildFifaOverlay()
    const spain = result.marketsByCountry.Spain
    expect(spain?.country).toBe('Spain')
    expect(spain?.yesPrice).toBe(0.16)
    expect(spain?.noPrice).toBe(0.84)
    expect(spain?.volume).toBe(99999)
    expect(spain?.closed).toBe(false)
    expect(spain?.yesTokenId).toBe('polymarket-spain-yes')
    expect(spain?.noTokenId).toBe('polymarket-spain-no')
  })

  it('sets stale:false and lastUpdatedAt near now on the happy path', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [makeMarket({ groupItemTitle: 'Spain' })],
    })
    const before = Date.now()
    const result = await buildFifaOverlay()
    expect(result.stale).toBe(false)
    expect(result.lastUpdatedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.lastUpdatedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('coerces non-finite prices to null (defensive — should never happen but protects against Zod gaps)', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: '2026-fifa-world-cup-winner-595',
      markets: [makeMarket({
        groupItemTitle: 'Spain',
        // These should be caught by Zod but just in case a NaN ever sneaks through:
        outcomePrices: [Number.NaN, 0.5] as unknown as [number, number],
      })],
    })
    const result = await buildFifaOverlay()
    expect(result.marketsByCountry.Spain?.yesPrice).toBeNull()
    expect(result.marketsByCountry.Spain?.noPrice).toBe(0.5)
  })
})
