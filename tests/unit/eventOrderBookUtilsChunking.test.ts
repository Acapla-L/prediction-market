/**
 * PR #22 B3 drift-lock — Kuest CLOB cap (500-item POST batches).
 *
 * `fetchOrderBookSummaries` in `_utils/EventOrderBookUtils.ts` was the third
 * unchunked CLOB caller missed by PR #18's chunking pass. The homepage and
 * sport-list-page order panels feed it with the full visible-game token set
 * (878 tokens observed live), exceeding Kuest's 500-item cap and returning
 * HTTP 400 `{"error":"maximum of 500 items allowed"}` on both endpoints.
 *
 * This test locks the chunking contract:
 *  - input partitioned into ≤ CLOB_BATCH_LIMIT-sized chunks
 *  - both `/books` AND `/last-trades-prices` POSTed per-chunk
 *  - per-chunk failure degrades to `[]` for that chunk, not whole-call null
 *  - output `OrderBookSummariesResponse` shape unchanged
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchClobJsonMock = vi.fn()

vi.mock('@/lib/clob', () => ({
  fetchClobJson: (path: string, payload: unknown) => fetchClobJsonMock(path, payload),
  getRoundedCents: (value: number) => value,
}))

const { fetchOrderBookSummaries } = await import(
  '@/app/[locale]/(platform)/event/[slug]/_utils/EventOrderBookUtils'
)

describe('fetchOrderBookSummaries — CLOB chunking (PR #22 B3)', () => {
  beforeEach(() => {
    fetchClobJsonMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty record when tokenIds is empty (no fetches fired)', async () => {
    const result = await fetchOrderBookSummaries([])
    expect(result).toEqual({})
    expect(fetchClobJsonMock).not.toHaveBeenCalled()
  })

  it('splits 878-token input into 3 chunks of size ≤400 for BOTH endpoints', async () => {
    const tokenIds = Array.from({ length: 878 }, (_, i) => `tok-${i}`)
    fetchClobJsonMock.mockResolvedValue([])
    await fetchOrderBookSummaries(tokenIds)

    const booksCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/books')
    const lastTradesCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/last-trades-prices')

    expect(booksCalls.length).toBe(3)
    expect(lastTradesCalls.length).toBe(3)

    for (const [, payload] of booksCalls) {
      expect(Array.isArray(payload)).toBe(true)
      expect((payload as unknown[]).length).toBeLessThanOrEqual(400)
    }
    for (const [, payload] of lastTradesCalls) {
      expect(Array.isArray(payload)).toBe(true)
      expect((payload as unknown[]).length).toBeLessThanOrEqual(400)
    }

    const totalBooksTokens = booksCalls.reduce(
      (sum, [, payload]) => sum + (payload as unknown[]).length,
      0,
    )
    const totalLastTradesTokens = lastTradesCalls.reduce(
      (sum, [, payload]) => sum + (payload as unknown[]).length,
      0,
    )
    expect(totalBooksTokens).toBe(878)
    expect(totalLastTradesTokens).toBe(878)
  })

  it('emits exactly one chunk for input under the limit', async () => {
    const tokenIds = Array.from({ length: 100 }, (_, i) => `tok-${i}`)
    fetchClobJsonMock.mockResolvedValue([])
    await fetchOrderBookSummaries(tokenIds)

    const booksCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/books')
    const lastTradesCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/last-trades-prices')
    expect(booksCalls.length).toBe(1)
    expect(lastTradesCalls.length).toBe(1)
    expect((booksCalls[0]![1] as unknown[]).length).toBe(100)
  })

  it('emits exactly one chunk at the boundary (400 tokens)', async () => {
    const tokenIds = Array.from({ length: 400 }, (_, i) => `tok-${i}`)
    fetchClobJsonMock.mockResolvedValue([])
    await fetchOrderBookSummaries(tokenIds)

    const booksCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/books')
    expect(booksCalls.length).toBe(1)
    expect((booksCalls[0]![1] as unknown[]).length).toBe(400)
  })

  it('emits two chunks at boundary+1 (401 tokens)', async () => {
    const tokenIds = Array.from({ length: 401 }, (_, i) => `tok-${i}`)
    fetchClobJsonMock.mockResolvedValue([])
    await fetchOrderBookSummaries(tokenIds)

    const booksCalls = fetchClobJsonMock.mock.calls.filter(([path]) => path === '/books')
    expect(booksCalls.length).toBe(2)
    expect((booksCalls[0]![1] as unknown[]).length).toBe(400)
    expect((booksCalls[1]![1] as unknown[]).length).toBe(1)
  })

  it('per-chunk failure on /books degrades to [] for that chunk only — does NOT throw or null whole call', async () => {
    const tokenIds = Array.from({ length: 600 }, (_, i) => `tok-${i}`)
    // First /books chunk rejects; second resolves with one valid entry.
    let booksCallCount = 0
    fetchClobJsonMock.mockImplementation((path: string, _payload: unknown) => {
      if (path === '/books') {
        booksCallCount += 1
        if (booksCallCount === 1) return Promise.reject(new Error('HTTP 400 maximum of 500 items allowed'))
        return Promise.resolve([{ asset_id: 'tok-500', bids: [], asks: [] }])
      }
      return Promise.resolve([])
    })

    // Should not throw.
    const result = await fetchOrderBookSummaries(tokenIds)

    // Token from the successful chunk surfaces in the merged record.
    expect(result['tok-500']).toEqual({
      bids: [],
      asks: [],
      last_trade_price: undefined,
      last_trade_side: undefined,
    })
    // Token from the failed chunk still has a record (just empty bids/asks).
    expect(result['tok-0']).toEqual({
      bids: [],
      asks: [],
      last_trade_price: undefined,
      last_trade_side: undefined,
    })
    // Every input token has a record (output shape preserved).
    for (const tokenId of tokenIds) {
      expect(result[tokenId]).toBeDefined()
    }
  })

  it('per-chunk failure on /last-trades-prices degrades to [] for that chunk only', async () => {
    const tokenIds = Array.from({ length: 600 }, (_, i) => `tok-${i}`)
    let lastTradesCallCount = 0
    fetchClobJsonMock.mockImplementation((path: string, _payload: unknown) => {
      if (path === '/last-trades-prices') {
        lastTradesCallCount += 1
        if (lastTradesCallCount === 2) return Promise.reject(new Error('HTTP 400'))
        return Promise.resolve([{ token_id: 'tok-0', price: '0.55', side: 'BUY' }])
      }
      return Promise.resolve([])
    })

    const result = await fetchOrderBookSummaries(tokenIds)

    expect(result['tok-0']?.last_trade_price).toBe('0.55')
    // Total input → total output (shape preserved).
    expect(Object.keys(result).length).toBe(600)
  })

  it('output keys are preserved in input order with byte-identical record shape', async () => {
    const tokenIds = ['tok-a', 'tok-b', 'tok-c']
    fetchClobJsonMock.mockImplementation((path: string) => {
      if (path === '/books') {
        return Promise.resolve([
          { asset_id: 'tok-a', bids: [{ price: '0.4', size: '10' }], asks: [{ price: '0.6', size: '5' }] },
          { asset_id: 'tok-b', bids: [], asks: [] },
        ])
      }
      return Promise.resolve([
        { token_id: 'tok-a', price: '0.5', side: 'SELL' },
        { token_id: 'tok-c', price: '0.7', side: 'BUY' },
      ])
    })

    const result = await fetchOrderBookSummaries(tokenIds)

    expect(Object.keys(result)).toEqual(['tok-a', 'tok-b', 'tok-c'])
    expect(result['tok-a']).toEqual({
      bids: [{ price: '0.4', size: '10' }],
      asks: [{ price: '0.6', size: '5' }],
      last_trade_price: '0.5',
      last_trade_side: 'SELL',
    })
    expect(result['tok-c']?.last_trade_price).toBe('0.7')
    expect(result['tok-b']?.bids).toEqual([])
  })
})
