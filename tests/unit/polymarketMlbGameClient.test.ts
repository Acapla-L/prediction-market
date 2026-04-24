import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMlbGameGammaEvent } from '@/lib/polymarket/client'

/**
 * Tests the MLB Gamma fetcher's Zod parsing + error paths. Parallel to
 * `polymarketClient.test.ts` which covers the FIFA fetcher. Proves the MLB
 * schema accepts the real pilot-shape payload (4 binary markets, moneyline
 * + NRFI + spreads + totals) and rejects malformed payloads without
 * throwing.
 */

describe('fetchMlbGameGammaEvent — happy path', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a real CHC-LAD pilot-shape response into MlbGammaEvent', async () => {
    const realShape = [
      {
        id: '392152',
        slug: 'mlb-chc-lad-2026-04-24',
        active: true,
        closed: false,
        markets: [
          {
            id: '2014078',
            conditionId: '0xcond1',
            sportsMarketType: 'moneyline',
            active: true,
            closed: false,
            outcomes: '["Chicago Cubs", "Los Angeles Dodgers"]',
            outcomePrices: '["0.405", "0.595"]',
            clobTokenIds: '["tok1", "tok2"]',
            volume: 122000,
          },
          {
            id: '2014079',
            conditionId: '0xcond2',
            sportsMarketType: 'nrfi',
            active: true,
            closed: false,
            outcomes: '["Yes", "No"]',
            outcomePrices: '["0.515", "0.485"]',
            clobTokenIds: '["tok3", "tok4"]',
            volume: 110,
          },
          {
            id: '2070128',
            conditionId: '0xcond3',
            sportsMarketType: 'spreads',
            line: -1.5,
            active: true,
            closed: false,
            outcomes: '["Los Angeles Dodgers", "Chicago Cubs"]',
            outcomePrices: '["0.42", "0.58"]',
            clobTokenIds: '["tok5", "tok6"]',
            volume: 23,
          },
          {
            id: '2070129',
            conditionId: '0xcond4',
            sportsMarketType: 'totals',
            line: 9.5,
            active: true,
            closed: false,
            outcomes: '["Over", "Under"]',
            outcomePrices: '["0.435", "0.565"]',
            clobTokenIds: '["tok7", "tok8"]',
            volume: 212,
          },
        ],
      },
    ]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(realShape), { status: 200 }),
    )

    const result = await fetchMlbGameGammaEvent('mlb-chc-lad-2026-04-24')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
    expect(result?.slug).toBe('mlb-chc-lad-2026-04-24')
    expect(result?.markets).toHaveLength(4)

    const mlOutcome = result?.markets.find(m => m.sportsMarketType === 'moneyline')
    expect(mlOutcome?.line).toBeNull()
    expect(mlOutcome?.outcomes).toEqual(['Chicago Cubs', 'Los Angeles Dodgers'])
    expect(mlOutcome?.outcomePrices).toEqual([0.405, 0.595])

    const sprOutcome = result?.markets.find(m => m.sportsMarketType === 'spreads')
    expect(sprOutcome?.line).toBe(-1.5)

    const totOutcome = result?.markets.find(m => m.sportsMarketType === 'totals')
    expect(totOutcome?.line).toBe(9.5)

    const nrfiOutcome = result?.markets.find(m => m.sportsMarketType === 'nrfi')
    expect(nrfiOutcome?.line).toBeNull()
  })
})

describe('fetchMlbGameGammaEvent — failure paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null on non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }))
    const result = await fetchMlbGameGammaEvent('mlb-chc-lad-2026-04-24')
    expect(result).toBeNull()
  })

  it('returns null on JSON parse failure', async () => {
    // Silence expected error log
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json-content-at-all', { status: 200 }),
    )
    const result = await fetchMlbGameGammaEvent('mlb-chc-lad-2026-04-24')
    expect(result).toBeNull()
  })

  it('returns null on Zod validation failure (unknown sportsMarketType)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = [{
      slug: 'mlb-chc-lad-2026-04-24',
      markets: [{
        id: 'x',
        conditionId: '0x',
        sportsMarketType: 'player-prop',
        active: true,
        closed: false,
        outcomes: '["a","b"]',
        outcomePrices: '["0.5","0.5"]',
        clobTokenIds: '["x","y"]',
        volume: 0,
      }],
    }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(bad), { status: 200 }))
    const result = await fetchMlbGameGammaEvent('mlb-chc-lad-2026-04-24')
    expect(result).toBeNull()
  })

  it('returns null on empty array (Zod .min(1))', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }))
    const result = await fetchMlbGameGammaEvent('mlb-does-not-exist')
    expect(result).toBeNull()
  })

  it('uRL-encodes the slug param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await fetchMlbGameGammaEvent('mlb-a/b-2026-04-24') // deliberately weird
    const calledUrl = fetchSpy.mock.calls[0]?.[0]
    expect(String(calledUrl)).toContain('slug=mlb-a%2Fb-2026-04-24')
  })
})
