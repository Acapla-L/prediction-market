import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchFifaGammaEvent,
  fetchPolymarketPriceHistory,
} from '@/lib/polymarket/client'

const GAMMA_OK_BODY = [
  {
    slug: '2026-fifa-world-cup-winner-595',
    markets: [
      {
        id: 'm1',
        conditionId: '0xabc',
        groupItemTitle: 'Spain',
        active: true,
        closed: false,
        // Polymarket returns these as JSON-encoded strings — client must parse.
        outcomes: JSON.stringify(['Yes', 'No']),
        outcomePrices: JSON.stringify(['0.16', '0.84']),
        clobTokenIds: JSON.stringify(['polymarket-yes', 'polymarket-no']),
        bestBid: 0.15,
        bestAsk: 0.17,
        lastTradePrice: 0.16,
        volume: 12345,
        volume24hr: 678,
      },
    ],
  },
]

const HISTORY_OK_BODY = {
  history: [
    { t: 1711930800, p: 0.42 },
    { t: 1711930860, p: 0.41 },
  ],
}

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

describe('polymarket client — fetchFifaGammaEvent', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a normalized PolymarketEvent when Gamma responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(GAMMA_OK_BODY))
    const result = await fetchFifaGammaEvent()
    expect(result).not.toBeNull()
    expect(result?.slug).toBe('2026-fifa-world-cup-winner-595')
    expect(result?.markets).toHaveLength(1)
    const market = result?.markets[0]
    expect(market?.groupItemTitle).toBe('Spain')
    // JSON-encoded-string fields parsed by the Zod preprocess
    expect(market?.outcomes).toEqual(['Yes', 'No'])
    expect(market?.outcomePrices).toEqual([0.16, 0.84])
    expect(market?.clobTokenIds).toEqual(['polymarket-yes', 'polymarket-no'])
  })

  it('retries once on 429 and returns the second response', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(429))
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(GAMMA_OK_BODY))
    const result = await fetchFifaGammaEvent()
    expect(result?.slug).toBe('2026-fifa-world-cup-winner-595')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null when both retry attempts are 429', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(429))
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(429))
    const result = await fetchFifaGammaEvent()
    expect(result).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null when the response body is not valid JSON', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
      text: async () => '<html>not json</html>',
    } as Response)
    const result = await fetchFifaGammaEvent()
    expect(result).toBeNull()
  })

  it('returns null when the JSON shape fails Zod validation', async () => {
    // markets is a string instead of an array — Zod should reject
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([
      { slug: 'x', markets: 'not-an-array' },
    ]))
    const result = await fetchFifaGammaEvent()
    expect(result).toBeNull()
  })

  it('accepts response containing placeholder markets with undefined outcomePrices/outcomes/clobTokenIds (regression: 2026-04-22 production bug)', async () => {
    // Fixture built from the EXACT shape of a real placeholder market
    // captured from live Gamma on 2026-04-22 (Team AM). Polymarket returns
    // these entries for future qualifying teams. Before the placeholder fix,
    // the required outcomePrices tuple failed Zod and poisoned the entire
    // response, causing fetchFifaGammaEvent to return null in production
    // and the FIFA overlay to silently no-op.
    const realPlaceholder = {
      id: '558992',
      conditionId: '0x74885870fd540aa9881baac1a99c7a205f80556baba91e1f44fb80178ec46830',
      groupItemTitle: 'Team AM',
      active: false,
      closed: false,
      outcomes: JSON.stringify(['Yes', 'No']),
      // NOTE: outcomePrices is intentionally absent — this is the real Gamma shape
      clobTokenIds: JSON.stringify([
        '86040916914507857269605207059811736324691981407025555024902462000511476766233',
        '76131146098126828471552637113581456291047249523223872964238917671303838166693',
      ]),
      bestBid: 0,
      bestAsk: 1,
      lastTradePrice: 0,
      volume: '0',
      volume24hr: 0,
    }
    const realActiveMarket = {
      id: '558934',
      conditionId: '0x7976b8dbacf9077eb1453a62bcefd6ab2df199acd28aad276ff0d920d6992892',
      groupItemTitle: 'Spain',
      active: true,
      closed: false,
      outcomes: JSON.stringify(['Yes', 'No']),
      outcomePrices: JSON.stringify(['0.16', '0.84']),
      clobTokenIds: JSON.stringify([
        '4394372887385518214471608448209527405727552777602031099972143344338178308080',
        '112680630004798425069810935278212000865453267506345451433803052322987302357330',
      ]),
      bestBid: 0.159,
      bestAsk: 0.161,
      lastTradePrice: 0.159,
      volume: '15538115.50342224',
      volume24hr: 346706.87,
    }

    // Real production shape: 12 placeholders interleaved with 48 real markets.
    // We reproduce with 2 real + 1 placeholder to keep the fixture readable.
    const responseWithPlaceholders = [{
      slug: '2026-fifa-world-cup-winner-595',
      markets: [realActiveMarket, realPlaceholder, realActiveMarket],
    }]
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(responseWithPlaceholders))

    const result = await fetchFifaGammaEvent()
    // Before fix: result would be null because Zod rejected the whole response.
    // After fix: all 3 markets parse, placeholder has outcomePrices === undefined.
    expect(result).not.toBeNull()
    expect(result?.markets).toHaveLength(3)
    expect(result?.markets[1]?.groupItemTitle).toBe('Team AM')
    expect(result?.markets[1]?.outcomePrices).toBeUndefined()
    expect(result?.markets[1]?.outcomes).toEqual(['Yes', 'No'])
    expect(result?.markets[0]?.outcomePrices).toEqual([0.16, 0.84])
  })

  it('returns null when a market has a malformed outcomes JSON string', async () => {
    // The JSON.parse inside the preprocess will throw — outer safeParse returns failure
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([
      {
        slug: '2026-fifa-world-cup-winner-595',
        markets: [
          {
            id: 'm1',
            conditionId: '0xabc',
            groupItemTitle: 'Spain',
            active: true,
            closed: false,
            outcomes: '{not-json',
            outcomePrices: JSON.stringify(['0.1', '0.9']),
            clobTokenIds: JSON.stringify(['a', 'b']),
            bestBid: null,
            bestAsk: null,
            lastTradePrice: null,
            volume: 0,
            volume24hr: null,
          },
        ],
      },
    ]))
    const result = await fetchFifaGammaEvent()
    expect(result).toBeNull()
  })
})

describe('polymarket client — fetchPolymarketPriceHistory', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the history array on 200', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(HISTORY_OK_BODY))
    const result = await fetchPolymarketPriceHistory({ token: 't1', interval: '1d' })
    expect(result?.history).toHaveLength(2)
    expect(result?.history[0]?.t).toBe(1711930800)
    expect(result?.history[0]?.p).toBe(0.42)
  })

  it('encodes token + interval + fidelity + startTs + endTs into the CLOB URL', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse(HISTORY_OK_BODY))
    await fetchPolymarketPriceHistory({
      token: 'polymarket-spain-yes',
      interval: '1d',
      fidelity: 5,
      startTs: 100,
      endTs: 200,
    })
    const urlArg = fetchSpy.mock.calls[0]?.[0] as string
    expect(urlArg).toContain('market=polymarket-spain-yes')
    expect(urlArg).toContain('interval=1d')
    expect(urlArg).toContain('fidelity=5')
    expect(urlArg).toContain('startTs=100')
    expect(urlArg).toContain('endTs=200')
  })

  it('returns null after retry exhaustion on 500s', async () => {
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(500))
    fetchSpy.mockResolvedValueOnce(mockStatusResponse(500))
    const result = await fetchPolymarketPriceHistory({ token: 't1', interval: '1d' })
    expect(result).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null when CLOB response shape fails Zod validation', async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ history: 'nope' }))
    const result = await fetchPolymarketPriceHistory({ token: 't1', interval: '1d' })
    expect(result).toBeNull()
  })
})
