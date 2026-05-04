import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Must be set before module import since CLOB_BASE_URL is captured at module level.
process.env.CLOB_URL = 'https://clob.kuest.com'

const { fetchQuotesByMarket } = await import('@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices')
import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

const makeTargets = (n: number): MarketTokenTarget[] =>
  Array.from({ length: n }, (_, i) => ({
    conditionId: `condition-${i}`,
    tokenId: `token-${i}`,
  }))

const mockPricesResponse = (tokenIds: string[]) =>
  Object.fromEntries(
    tokenIds.map(id => [id, { BUY: '0.55', SELL: '0.45' }]),
  )

const mockMidpointsResponse = (tokenIds: string[]) =>
  Object.fromEntries(tokenIds.map(id => [id, '0.50']))

describe('fetchQuotesByMarket — batched POST /midpoints migration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fires exactly ONE POST to /midpoints regardless of how many targets are passed', async () => {
    const targets = makeTargets(5)
    const tokenIds = targets.map(t => t.tokenId)

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/prices')) {
        return new Response(JSON.stringify(mockPricesResponse(tokenIds)), { status: 200 })
      }
      if (urlStr.endsWith('/midpoints')) {
        return new Response(JSON.stringify(mockMidpointsResponse(tokenIds)), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    await fetchQuotesByMarket(targets)

    const midpointCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).endsWith('/midpoints'),
    )
    expect(midpointCalls).toHaveLength(1)
  })

  it('sends request body as array of {token_id} objects to /midpoints', async () => {
    const targets = makeTargets(3)
    const tokenIds = targets.map(t => t.tokenId)

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/prices')) {
        return new Response(JSON.stringify(mockPricesResponse(tokenIds)), { status: 200 })
      }
      if (urlStr.endsWith('/midpoints')) {
        return new Response(JSON.stringify(mockMidpointsResponse(tokenIds)), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    await fetchQuotesByMarket(targets)

    const [[, midpointInit]] = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).endsWith('/midpoints'),
    )
    const body = JSON.parse(midpointInit?.body as string)
    expect(body).toEqual(tokenIds.map(id => ({ token_id: id })))
  })

  it('does not throw and returns quotes when /midpoints returns 404', async () => {
    const targets = makeTargets(2)
    const tokenIds = targets.map(t => t.tokenId)

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/prices')) {
        return new Response(JSON.stringify(mockPricesResponse(tokenIds)), { status: 200 })
      }
      if (urlStr.endsWith('/midpoints')) {
        return new Response('Not Found', { status: 404 })
      }
      return new Response('Not found', { status: 404 })
    })

    const result = await fetchQuotesByMarket(targets)
    expect(result).toBeDefined()
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('returns MarketQuotesByMarket keyed by conditionId with bid/ask/mid shape', async () => {
    const targets = makeTargets(2)
    const tokenIds = targets.map(t => t.tokenId)

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/prices')) {
        return new Response(JSON.stringify(mockPricesResponse(tokenIds)), { status: 200 })
      }
      if (urlStr.endsWith('/midpoints')) {
        return new Response(JSON.stringify(mockMidpointsResponse(tokenIds)), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    const result = await fetchQuotesByMarket(targets)

    expect(Object.keys(result)).toHaveLength(2)
    for (const target of targets) {
      const quote = result[target.conditionId]
      expect(quote).toBeDefined()
      expect(typeof quote.bid === 'number' || quote.bid === null).toBe(true)
      expect(typeof quote.ask === 'number' || quote.ask === null).toBe(true)
      expect(typeof quote.mid === 'number' || quote.mid === null).toBe(true)
    }
  })

  it('never fires any GET /midpoint?token_id= requests (old per-token pattern eliminated)', async () => {
    const targets = makeTargets(4)
    const tokenIds = targets.map(t => t.tokenId)

    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/prices')) {
        return new Response(JSON.stringify(mockPricesResponse(tokenIds)), { status: 200 })
      }
      if (urlStr.endsWith('/midpoints')) {
        return new Response(JSON.stringify(mockMidpointsResponse(tokenIds)), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })

    await fetchQuotesByMarket(targets)

    const oldStyleCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).includes('/midpoint?token_id='),
    )
    expect(oldStyleCalls).toHaveLength(0)
  })
})
