import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchFifaGammaEvent,
  fetchPolymarketGammaEvent,
  fetchPolymarketGammaEventsBySeries,
} from '@/lib/polymarket/client'
import { FIFA_EVENT_SLUG } from '@/lib/polymarket/constants'

const UCL_OK_BODY = [
  {
    slug: 'uefa-champions-league-winner',
    markets: [
      {
        id: 'ucl-arsenal',
        conditionId: '0xUCL-arsenal',
        groupItemTitle: 'Arsenal',
        active: true,
        closed: false,
        outcomes: JSON.stringify(['Yes', 'No']),
        outcomePrices: JSON.stringify(['0.295', '0.705']),
        clobTokenIds: JSON.stringify(['polymarket-arsenal-yes', 'polymarket-arsenal-no']),
        bestBid: 0.293,
        bestAsk: 0.297,
        lastTradePrice: 0.295,
        volume: 5_400_000,
        volume24hr: 220_000,
      },
    ],
  },
]

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function mockStatusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => '',
  } as Response
}

describe('polymarket client — fetchPolymarketGammaEvent (slug-parameterized)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a normalized PolymarketEvent for a non-FIFA slug', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(UCL_OK_BODY))

    const result = await fetchPolymarketGammaEvent('uefa-champions-league-winner')

    expect(result).not.toBeNull()
    expect(result?.slug).toBe('uefa-champions-league-winner')
    expect(result?.markets).toHaveLength(1)
    expect(result?.markets[0]?.groupItemTitle).toBe('Arsenal')
    expect(result?.markets[0]?.outcomePrices).toEqual([0.295, 0.705])
  })

  it('uRL-encodes the slug into the gamma /events query', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(UCL_OK_BODY))
    await fetchPolymarketGammaEvent('uefa-champions-league-winner')

    const urlArg = fetchSpy.mock.calls[0]?.[0] as string
    expect(urlArg).toContain('/events?slug=uefa-champions-league-winner')
  })

  it('encodes special characters in the slug parameter', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([{ slug: 'a/b', markets: [] }]))
    await fetchPolymarketGammaEvent('a/b')

    const urlArg = fetchSpy.mock.calls[0]?.[0] as string
    // '/' must be percent-encoded — Polymarket's slug query will reject
    // an unencoded path separator
    expect(urlArg).toContain('slug=a%2Fb')
  })

  it('returns null on 404 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(404))
    const result = await fetchPolymarketGammaEvent('does-not-exist')
    expect(result).toBeNull()
  })

  it('retries once on 502 and succeeds on the second attempt', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(502))
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(UCL_OK_BODY))

    const result = await fetchPolymarketGammaEvent('uefa-champions-league-winner')
    expect(result).not.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null when Gamma returns an empty event array', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([]))
    const result = await fetchPolymarketGammaEvent('any-slug')
    expect(result).toBeNull()
  })

  it('returns null on Zod validation failure (markets is a string)', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([
      { slug: 'x', markets: 'not-an-array' },
    ]))
    const result = await fetchPolymarketGammaEvent('x')
    expect(result).toBeNull()
  })

  it('preserves placeholder-market support across the generalization (regression: 2026-04-22)', async () => {
    // Same Zod placeholder-permissive shape that fetchFifaGammaEvent gained in
    // session 026 must still apply when called with a non-FIFA slug.
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([
      {
        slug: '2026-nba-champion',
        markets: [
          {
            id: 'placeholder',
            conditionId: '0xPLACE',
            groupItemTitle: 'TBD',
            active: false,
            closed: false,
            // outcomePrices and outcomes intentionally absent — placeholder shape
            bestBid: 0,
            bestAsk: 1,
            lastTradePrice: 0,
            volume: 0,
            volume24hr: 0,
          },
        ],
      },
    ]))

    const result = await fetchPolymarketGammaEvent('2026-nba-champion')
    expect(result).not.toBeNull()
    expect(result?.markets[0]?.outcomePrices).toBeUndefined()
    expect(result?.markets[0]?.groupItemTitle).toBe('TBD')
  })
})

describe('polymarket client — fetchFifaGammaEvent alias', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('still requests the FIFA slug after generalization', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([{
      slug: FIFA_EVENT_SLUG,
      markets: [],
    }]))

    await fetchFifaGammaEvent()

    const urlArg = fetchSpy.mock.calls[0]?.[0] as string
    expect(urlArg).toContain(`/events?slug=${encodeURIComponent(FIFA_EVENT_SLUG)}`)
  })

  it('returns the same null behaviour as fetchPolymarketGammaEvent on failure', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(404))
    const result = await fetchFifaGammaEvent()
    expect(result).toBeNull()
  })
})

describe('polymarket client — fetchPolymarketGammaEventsBySeries (Phase B per-game)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // Real response captured from gamma-api.polymarket.com on 2026-05-06.
  // Drives the regression tests for both bugs found in Session 2:
  //   Bug 1: groupItemTitle is undefined on Moneyline markets (3 of 15)
  //   Bug 2: gameStartTime is at market level, NOT event level (15 of 15
  //   markets carry it; 0 of 3 events carry it)
  function loadRealFixture(): unknown {
    return JSON.parse(
      readFileSync(
        resolve(__dirname, '../fixtures/polymarket-gamma-mlb-per-game-response.json'),
        'utf8',
      ),
    )
  }

  it('parses the real captured Polymarket Gamma per-game response (regression for both bugs)', async () => {
    const fixture = loadRealFixture()
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(fixture))

    const result = await fetchPolymarketGammaEventsBySeries('3')

    expect(result).not.toBeNull()
    expect(result).toHaveLength(3)

    result!.forEach((event) => {
      expect(event.slug).toMatch(/^mlb-/)
      expect(event.markets.length).toBeGreaterThan(0)

      // Moneyline market (slug exact-matches event slug):
      //   - Schema accepts undefined groupItemTitle (Bug 1 fix)
      //   - Mapper defaults missing groupItemTitle to ''
      //   - gameStartTime is populated at the market level (Bug 2 fix)
      const moneyline = event.markets.find(m => m.slug === event.slug)
      expect(moneyline).toBeDefined()
      expect(moneyline!.groupItemTitle).toBe('')
      expect(moneyline!.gameStartTime).toBeDefined()
      expect(typeof moneyline!.gameStartTime).toBe('string')
    })
  })

  it('moneyline markets have empty groupItemTitle, non-moneyline markets do not', async () => {
    const fixture = loadRealFixture()
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(fixture))

    const result = await fetchPolymarketGammaEventsBySeries('3')

    let emptyCount = 0
    let populatedCount = 0
    result!.forEach((event) => {
      event.markets.forEach((m) => {
        if (m.slug === event.slug) {
          emptyCount++
          expect(m.groupItemTitle).toBe('')
        }
        else {
          populatedCount++
          expect(m.groupItemTitle).not.toBe('')
        }
      })
    })
    expect(emptyCount).toBe(3) // one moneyline per event
    expect(populatedCount).toBe(12) // remaining markets (4 per event × 3 events)
  })

  it('every market carries gameStartTime (not at event level)', async () => {
    const fixture = loadRealFixture()
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(fixture))

    const result = await fetchPolymarketGammaEventsBySeries('3')

    result!.forEach((event) => {
      // PolymarketEvent type no longer carries gameStartTime — verifying
      // it's NOT propagated as an event-level field.
      // @ts-expect-error — confirming the field is removed at the type level
      expect(event.gameStartTime).toBeUndefined()

      event.markets.forEach((m) => {
        expect(m.gameStartTime).toBeDefined()
        expect(typeof m.gameStartTime).toBe('string')
      })
    })
  })

  it('builds the per-series URL with active=true&closed=false&limit', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([]))
    await fetchPolymarketGammaEventsBySeries('3')

    const urlArg = fetchSpy.mock.calls[0]?.[0] as string
    expect(urlArg).toContain('series_id=3')
    expect(urlArg).toContain('active=true')
    expect(urlArg).toContain('closed=false')
    expect(urlArg).toContain('limit=50')
  })

  it('returns empty array (not null) when series has no active games', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([]))
    const result = await fetchPolymarketGammaEventsBySeries('3')
    expect(result).toEqual([])
  })

  it('returns null when transport fails after retries', async () => {
    fetchSpy.mockResolvedValue(mockStatusResponse(500))
    const result = await fetchPolymarketGammaEventsBySeries('3')
    expect(result).toBeNull()
  })

  it('returns null when Zod schema rejects the response', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([{ totally: 'wrong-shape' }]))
    const result = await fetchPolymarketGammaEventsBySeries('3')
    expect(result).toBeNull()
  })
})
