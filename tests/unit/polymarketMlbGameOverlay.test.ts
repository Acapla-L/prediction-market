import type { MlbGammaMarket } from '@/lib/polymarket/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMlbGameGammaEvent } from '@/lib/polymarket/client'
import { buildMlbGameOverlay } from '@/lib/polymarket/mlb-game-overlay'

vi.mock('@/lib/polymarket/client', () => ({
  fetchMlbGameGammaEvent: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchMlbGameGammaEvent)

const PILOT_SLUG = 'mlb-chc-lad-2026-04-24'

function makeMoneyline(overrides: Partial<MlbGammaMarket> = {}): MlbGammaMarket {
  return {
    id: 'm-ml',
    conditionId: '0xcond-ml',
    sportsMarketType: 'moneyline',
    line: null,
    active: true,
    closed: false,
    outcomes: ['Chicago Cubs', 'Los Angeles Dodgers'],
    outcomePrices: [0.405, 0.595],
    clobTokenIds: ['pm-ml-chc', 'pm-ml-lad'],
    volume: 122000,
    ...overrides,
  }
}

function makeNrfi(overrides: Partial<MlbGammaMarket> = {}): MlbGammaMarket {
  return {
    id: 'm-nrfi',
    conditionId: '0xcond-nrfi',
    sportsMarketType: 'nrfi',
    line: null,
    active: true,
    closed: false,
    outcomes: ['Yes', 'No'],
    outcomePrices: [0.515, 0.485],
    clobTokenIds: ['pm-nrfi-yes', 'pm-nrfi-no'],
    volume: 110,
    ...overrides,
  }
}

function makeSpreads(overrides: Partial<MlbGammaMarket> = {}): MlbGammaMarket {
  return {
    id: 'm-spr',
    conditionId: '0xcond-spr',
    sportsMarketType: 'spreads',
    line: -1.5,
    active: true,
    closed: false,
    // Polymarket returns favored team FIRST, not home first — for CHC@LAD
    // this is ['Los Angeles Dodgers', 'Chicago Cubs']. Our DB keys outcomes
    // by outcome_text so label order is irrelevant once normalized.
    outcomes: ['Los Angeles Dodgers', 'Chicago Cubs'],
    outcomePrices: [0.42, 0.58],
    clobTokenIds: ['pm-spr-lad', 'pm-spr-chc'],
    volume: 23,
    ...overrides,
  }
}

function makeTotals(overrides: Partial<MlbGammaMarket> = {}): MlbGammaMarket {
  return {
    id: 'm-tot',
    conditionId: '0xcond-tot',
    sportsMarketType: 'totals',
    line: 9.5,
    active: true,
    closed: false,
    outcomes: ['Over', 'Under'],
    outcomePrices: [0.435, 0.565],
    clobTokenIds: ['pm-tot-over', 'pm-tot-under'],
    volume: 212,
    ...overrides,
  }
}

describe('buildMlbGameOverlay — upstream failure path', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('returns stale:true with empty marketsByKey when Gamma fetch returns null', async () => {
    mockedFetch.mockResolvedValueOnce(null)
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.stale).toBe(true)
    expect(result.marketsByKey).toEqual({})
    expect(result.slug).toBe(PILOT_SLUG)
    expect(result.lastUpdatedAt).toBeInstanceOf(Date)
  })

  it('returns stale:true for a slug outside MLB_GAME_SLUGS WITHOUT hitting the network', async () => {
    const result = await buildMlbGameOverlay('mlb-not-in-allowlist-2026-04-24')
    expect(result.stale).toBe(true)
    expect(result.marketsByKey).toEqual({})
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('never throws — upstream failure path is non-exceptional', async () => {
    mockedFetch.mockResolvedValueOnce(null)
    await expect(buildMlbGameOverlay(PILOT_SLUG)).resolves.toBeDefined()
  })
})

describe('buildMlbGameOverlay — filtering', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('filters out markets where active=false', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: PILOT_SLUG,
      markets: [makeMoneyline({ active: false }), makeNrfi()],
    })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey.moneyline).toBeUndefined()
    expect(result.marketsByKey.nrfi).toBeDefined()
  })

  it('filters out markets where closed=true', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: PILOT_SLUG,
      markets: [makeMoneyline({ closed: true }), makeTotals()],
    })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey.moneyline).toBeUndefined()
    expect(result.marketsByKey['totals:9.5']).toBeDefined()
  })
})

describe('buildMlbGameOverlay — composite overlay key', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('keys moneyline by bare type (no line suffix)', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeMoneyline()] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(Object.keys(result.marketsByKey)).toEqual(['moneyline'])
  })

  it('keys nrfi by bare type (no line suffix)', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeNrfi()] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(Object.keys(result.marketsByKey)).toEqual(['nrfi'])
  })

  it('keys spreads by type+line', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeSpreads({ line: -1.5 })] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey['spreads:-1.5']).toBeDefined()
  })

  it('keys totals by type+line', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeTotals({ line: 9.5 })] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey['totals:9.5']).toBeDefined()
  })
})

describe('buildMlbGameOverlay — normalization (NRFI Yes/No → Yes Run/No Run)', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('rewrites "Yes" → "Yes Run" and "No" → "No Run" on NRFI only', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeNrfi()] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    const nrfi = result.marketsByKey.nrfi
    expect(nrfi?.outcomesByLabel['Yes Run']).toBeDefined()
    expect(nrfi?.outcomesByLabel['No Run']).toBeDefined()
    // Raw Polymarket labels should NOT appear
    expect(nrfi?.outcomesByLabel.Yes).toBeUndefined()
    expect(nrfi?.outcomesByLabel.No).toBeUndefined()
  })

  it('passes team names through identity for moneyline and spreads', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: PILOT_SLUG,
      markets: [makeMoneyline(), makeSpreads()],
    })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Chicago Cubs']).toBeDefined()
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Los Angeles Dodgers']).toBeDefined()
    expect(result.marketsByKey['spreads:-1.5']?.outcomesByLabel['Chicago Cubs']).toBeDefined()
    expect(result.marketsByKey['spreads:-1.5']?.outcomesByLabel['Los Angeles Dodgers']).toBeDefined()
  })

  it('passes Over/Under through identity for totals', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeTotals()] })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey['totals:9.5']?.outcomesByLabel.Over).toBeDefined()
    expect(result.marketsByKey['totals:9.5']?.outcomesByLabel.Under).toBeDefined()
  })
})

describe('buildMlbGameOverlay — stitching (full 4-market pilot shape)', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('stitches price + tokenId across all 4 markets with correct label→token mapping', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: PILOT_SLUG,
      markets: [makeMoneyline(), makeNrfi(), makeSpreads(), makeTotals()],
    })
    const result = await buildMlbGameOverlay(PILOT_SLUG)

    expect(Object.keys(result.marketsByKey)).toHaveLength(4)

    // Moneyline: CHC→pm-ml-chc@0.405, LAD→pm-ml-lad@0.595
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Chicago Cubs'])
      .toEqual({ price: 0.405, tokenId: 'pm-ml-chc' })
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Los Angeles Dodgers'])
      .toEqual({ price: 0.595, tokenId: 'pm-ml-lad' })

    // NRFI: Yes Run→pm-nrfi-yes@0.515, No Run→pm-nrfi-no@0.485
    expect(result.marketsByKey.nrfi?.outcomesByLabel['Yes Run'])
      .toEqual({ price: 0.515, tokenId: 'pm-nrfi-yes' })
    expect(result.marketsByKey.nrfi?.outcomesByLabel['No Run'])
      .toEqual({ price: 0.485, tokenId: 'pm-nrfi-no' })

    // Spreads -1.5: LAD listed FIRST by Polymarket but keyed by name in our map
    expect(result.marketsByKey['spreads:-1.5']?.outcomesByLabel['Los Angeles Dodgers'])
      .toEqual({ price: 0.42, tokenId: 'pm-spr-lad' })
    expect(result.marketsByKey['spreads:-1.5']?.outcomesByLabel['Chicago Cubs'])
      .toEqual({ price: 0.58, tokenId: 'pm-spr-chc' })

    // Totals 9.5
    expect(result.marketsByKey['totals:9.5']?.outcomesByLabel.Over)
      .toEqual({ price: 0.435, tokenId: 'pm-tot-over' })
    expect(result.marketsByKey['totals:9.5']?.outcomesByLabel.Under)
      .toEqual({ price: 0.565, tokenId: 'pm-tot-under' })
  })

  it('sets stale:false and lastUpdatedAt near now on the happy path', async () => {
    mockedFetch.mockResolvedValueOnce({ slug: PILOT_SLUG, markets: [makeMoneyline()] })
    const before = Date.now()
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.stale).toBe(false)
    expect(result.lastUpdatedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.lastUpdatedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('coerces non-finite prices to null (defensive)', async () => {
    mockedFetch.mockResolvedValueOnce({
      slug: PILOT_SLUG,
      markets: [makeMoneyline({
        outcomePrices: [Number.NaN, 0.5] as unknown as [number, number],
      })],
    })
    const result = await buildMlbGameOverlay(PILOT_SLUG)
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Chicago Cubs']?.price).toBeNull()
    expect(result.marketsByKey.moneyline?.outcomesByLabel['Los Angeles Dodgers']?.price).toBe(0.5)
  })
})
