import type { PolymarketPriceHistoryResponse } from '@/lib/polymarket/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/polymarket/prices-history/route'
import { fetchPolymarketPriceHistory } from '@/lib/polymarket/client'

// Mock the upstream Polymarket fetcher so we can control its return value
// without touching the network.
vi.mock('@/lib/polymarket/client', () => ({
  fetchPolymarketPriceHistory: vi.fn(),
}))

// `connection()` is a Next.js 16 runtime marker that signals dynamic data.
// In the Vitest Node environment there is no render context — make it a no-op
// so the handler can `await` it without throwing.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    connection: vi.fn(async () => undefined),
  }
})

// `unstable_cache` is a passthrough in tests — we want the mocked fetcher to
// be called directly without Next.js's cache runtime. Production behavior is
// covered by the integration test at the event-page layer.
vi.mock('next/cache', async () => {
  const actual = await vi.importActual<typeof import('next/cache')>('next/cache')
  return {
    ...actual,
    unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  }
})

const mockedFetch = vi.mocked(fetchPolymarketPriceHistory)

function makeRequest(params: Record<string, string | number | undefined>): Request {
  const url = new URL('http://localhost/api/polymarket/prices-history')
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      url.searchParams.set(k, String(v))
    }
  }
  return new Request(url.toString())
}

describe('/api/polymarket/prices-history — GET', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('returns 200 with { history: [...] } on valid query + upstream success', async () => {
    const body: PolymarketPriceHistoryResponse = {
      history: [{ t: 1, p: 0.5 }, { t: 2, p: 0.51 }],
    }
    mockedFetch.mockResolvedValueOnce(body)

    const res = await GET(makeRequest({ token: 't1', interval: '1d' }))
    expect(res.status).toBe(200)
    const json = await res.json() as PolymarketPriceHistoryResponse
    expect(json.history).toHaveLength(2)
    expect(json.history[0]).toEqual({ t: 1, p: 0.5 })
  })

  it('forwards token, interval, fidelity, startTs, endTs to the client fetcher', async () => {
    mockedFetch.mockResolvedValueOnce({ history: [] })

    await GET(makeRequest({
      token: 'polymarket-spain-yes',
      interval: '1w',
      fidelity: 30,
      startTs: 1711900000,
      endTs: 1711930000,
    }))

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith({
      token: 'polymarket-spain-yes',
      interval: '1w',
      fidelity: 30,
      startTs: 1711900000,
      endTs: 1711930000,
    })
  })

  it('returns 400 with error + details when token is missing', async () => {
    const res = await GET(makeRequest({ interval: '1d' }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string, details: unknown }
    expect(json.error).toBe('Invalid query params')
    expect(json.details).toBeDefined()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when interval is not one of 1h/6h/1d/1w/1m/max', async () => {
    const res = await GET(makeRequest({ token: 't1', interval: 'weekly' }))
    expect(res.status).toBe(400)
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when fidelity is not a positive integer', async () => {
    const res = await GET(makeRequest({ token: 't1', interval: '1d', fidelity: -5 }))
    expect(res.status).toBe(400)
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('returns 502 with { history: [] } when upstream fetcher returns null', async () => {
    mockedFetch.mockResolvedValueOnce(null)

    const res = await GET(makeRequest({ token: 't1', interval: '1d' }))
    expect(res.status).toBe(502)
    const json = await res.json() as PolymarketPriceHistoryResponse
    expect(json.history).toEqual([])
  })

  it('omits undefined optional params from the forwarded call', async () => {
    mockedFetch.mockResolvedValueOnce({ history: [] })

    await GET(makeRequest({ token: 't1', interval: '1d' }))

    // No fidelity / startTs / endTs in the request; they should be forwarded as undefined
    expect(mockedFetch).toHaveBeenCalledWith({
      token: 't1',
      interval: '1d',
      fidelity: undefined,
      startTs: undefined,
      endTs: undefined,
    })
  })

  it('accepts query without interval parameter (ALL-range fix — session 026)', async () => {
    // Regression: the client hook's buildTimeRangeFilters omits `interval`
    // when the user picks the ALL range (it sends fidelity + startTs + endTs
    // instead). Before session 026 the schema required interval; every
    // ALL-range FIFA chart call returned 400. Schema now marks it optional.
    mockedFetch.mockResolvedValueOnce({ history: [{ t: 1, p: 0.16 }] })

    const res = await GET(makeRequest({
      token: 'polymarket-spain-yes',
      fidelity: 180,
      startTs: 1776287599,
      endTs: 1776912475,
    }))

    expect(res.status).toBe(200)
    expect(mockedFetch).toHaveBeenCalledWith({
      token: 'polymarket-spain-yes',
      interval: undefined,
      fidelity: 180,
      startTs: 1776287599,
      endTs: 1776912475,
    })
  })

  it('forwards interval: undefined to the client fetcher so the URL builder can omit the param', async () => {
    // The route does not substitute a default — the downstream URL builder
    // (fetchPolymarketPriceHistory in client.ts) is responsible for omitting
    // the query-string key when interval is undefined. This test locks the
    // contract between the route and the client library.
    mockedFetch.mockResolvedValueOnce({ history: [] })

    await GET(makeRequest({
      token: 't1',
      startTs: 100,
      endTs: 200,
      fidelity: 60,
    }))

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const callArgs = mockedFetch.mock.calls[0]?.[0]
    expect(callArgs?.interval).toBeUndefined()
  })
})
