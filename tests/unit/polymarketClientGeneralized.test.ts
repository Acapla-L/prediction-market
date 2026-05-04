import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchFifaGammaEvent,
  fetchPolymarketGammaEvent,
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
