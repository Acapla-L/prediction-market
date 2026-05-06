import type { PolymarketEvent } from '@/lib/polymarket/types'
import { revalidatePath, revalidateTag } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-games-discovery/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { fetchPolymarketGammaEventsBySeries } from '@/lib/polymarket/client'

vi.mock('@/lib/polymarket/client', () => ({
  fetchPolymarketGammaEventsBySeries: vi.fn(),
}))
vi.mock('@/lib/db/queries/discovered-games', () => ({
  DiscoveredGamesRepository: {
    upsertSuccess: vi.fn(),
    markFailure: vi.fn(),
    archiveStaleGames: vi.fn(),
    getBySlug: vi.fn(),
    listInRefreshWindow: vi.fn(),
    listActiveByLeague: vi.fn(),
  },
}))
vi.mock('@/lib/auth-cron', () => ({
  isCronAuthorized: vi.fn(() => true),
}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    connection: vi.fn(async () => undefined),
  }
})
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchPolymarketGammaEventsBySeries)
const mockedAuth = vi.mocked(isCronAuthorized)
const mockedRevalidateTag = vi.mocked(revalidateTag)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedRepo = vi.mocked(DiscoveredGamesRepository)

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/polymarket-games-discovery', {
    method: 'GET',
    headers: {
      authorization: 'Bearer test-secret',
      ...headers,
    },
  })
}

function makeMlbGame(slug: string): PolymarketEvent {
  return {
    slug,
    id: `gamma-${slug}`,
    title: `Game ${slug}`,
    endDate: '2026-05-12T23:05:00Z',
    createdAt: '2026-04-29T13:00:18.813855Z',
    negRisk: false,
    enableNegRisk: false,
    markets: [
      {
        id: `${slug}-moneyline`,
        conditionId: `0x${slug}-mn`,
        // Real Polymarket Moneyline markets lack groupItemTitle (mapper
        // defaults missing → ''). Mirror that shape for fidelity.
        groupItemTitle: '',
        slug,
        iconUrl: null,
        active: true,
        closed: false,
        outcomes: ['Home', 'Away'] as const,
        outcomePrices: [0.5, 0.5] as const,
        clobTokenIds: ['tok-home', 'tok-away'] as const,
        bestBid: 0.49,
        bestAsk: 0.51,
        lastTradePrice: 0.5,
        volume: 1000,
        volume24hr: 100,
        // gameStartTime lives on the MARKET, not the event.
        gameStartTime: '2026-05-05T23:05:00Z',
      },
    ],
  }
}

function upsertOk(slug: string) {
  return {
    data: {
      slug,
      league: 'mlb',
      polymarketEventId: `gamma-${slug}`,
      title: `Game ${slug}`,
      homeTeamLabel: null,
      awayTeamLabel: null,
      gameStartTime: '2026-05-05T23:05:00.000Z',
      isActive: true,
      isClosed: false,
      isArchived: false,
      endDate: '2026-05-12T23:05:00.000Z',
      marketsPayload: '{}',
      lastSyncedAt: '2026-05-05T20:00:00.000Z',
      lastSyncStatus: 'ok',
      lastSyncError: null,
    },
    error: null,
  }
}

describe('/api/sync/polymarket-games-discovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.mockReturnValue(true)
    mockedRepo.archiveStaleGames.mockResolvedValue({ data: { archivedCount: 0 }, error: null })
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'true'
  })

  it('returns 401 for unauthorized requests', async () => {
    mockedAuth.mockReturnValueOnce(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('returns disabled=true and skips Polymarket calls when kill switch is off', async () => {
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'false'
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, disabled: true })
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('returns disabled=true when env var is unset (default-off)', async () => {
    delete process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ ok: true, disabled: true })
  })

  it('iterates leagues, upserts each game, fires revalidateTag + revalidatePath per success', async () => {
    mockedFetch.mockResolvedValue([
      makeMlbGame('mlb-tex-nyy-2026-05-05'),
      makeMlbGame('mlb-cin-chc-2026-05-05'),
    ])
    mockedRepo.upsertSuccess
      .mockResolvedValueOnce(upsertOk('mlb-tex-nyy-2026-05-05'))
      .mockResolvedValueOnce(upsertOk('mlb-cin-chc-2026-05-05'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.events_processed).toBe(2)
    expect(body.results).toHaveLength(2)
    expect(body.results.every((r: { status: string }) => r.status === 'ok')).toBe(true)

    // Belt-and-suspenders revalidation per Phase A v2 PR #6
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      'polymarket-discovered-game:event:mlb-tex-nyy-2026-05-05',
      'max',
    )
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      'polymarket-discovered-game:event:mlb-cin-chc-2026-05-05',
      'max',
    )
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/event/mlb-tex-nyy-2026-05-05')
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/event/mlb-cin-chc-2026-05-05')
    // Plus the global eventsList tag at the end
    expect(mockedRevalidateTag).toHaveBeenCalledWith('events:list', 'max')
  })

  it('handles fetchPolymarketGammaEventsBySeries returning null (transport failure)', async () => {
    mockedFetch.mockResolvedValue(null)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].status).toBe('network_error')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    // No successful slugs → no per-slug revalidations
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('marks failure and continues when an individual upsert errors', async () => {
    mockedFetch.mockResolvedValue([
      makeMlbGame('mlb-tex-nyy-2026-05-05'),
      makeMlbGame('mlb-cin-chc-2026-05-05'),
    ])
    mockedRepo.upsertSuccess
      .mockResolvedValueOnce({ data: null, error: 'DB conflict' })
      .mockResolvedValueOnce(upsertOk('mlb-cin-chc-2026-05-05'))
    mockedRepo.markFailure.mockResolvedValue({ data: null, error: null })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(2)
    expect(body.results[0].status).toBe('upsert_error')
    expect(body.results[1].status).toBe('ok')
    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(1)
    // Only the successful slug gets revalidated
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1)
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/event/mlb-cin-chc-2026-05-05')
  })

  it('includes archive count in response', async () => {
    mockedFetch.mockResolvedValue([])
    mockedRepo.archiveStaleGames.mockResolvedValueOnce({ data: { archivedCount: 3 }, error: null })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.events_archived).toBe(3)
    expect(mockedRepo.archiveStaleGames).toHaveBeenCalledTimes(1)
    // archiveStaleGames is called with a Date that's ~24h before now
    const archiveCall = mockedRepo.archiveStaleGames.mock.calls[0]
    const cutoff = archiveCall[0] as Date
    const expectedAge = 24 * 60 * 60 * 1000
    const actualAge = Date.now() - cutoff.getTime()
    // Allow ±1 minute drift for test timing
    expect(actualAge).toBeGreaterThan(expectedAge - 60_000)
    expect(actualAge).toBeLessThan(expectedAge + 60_000)
  })

  it('skips events whose moneyline market lacks tradable fields', async () => {
    const degenerateEvent: PolymarketEvent = {
      ...makeMlbGame('mlb-tex-nyy-2026-05-05'),
      markets: [{
        ...makeMlbGame('mlb-tex-nyy-2026-05-05').markets[0],
        outcomes: undefined,
        outcomePrices: undefined,
        clobTokenIds: undefined,
      }],
    }
    mockedFetch.mockResolvedValue([degenerateEvent])

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0].status).toBe('normalize_skipped')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})
