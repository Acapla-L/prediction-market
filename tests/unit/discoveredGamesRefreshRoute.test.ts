import { revalidatePath } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-games-refresh/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { fetchPolymarketGammaEvent } from '@/lib/polymarket/client'

vi.mock('@/lib/polymarket/client', () => ({
  fetchPolymarketGammaEvent: vi.fn(),
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

const mockedFetch = vi.mocked(fetchPolymarketGammaEvent)
const mockedAuth = vi.mocked(isCronAuthorized)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedRepo = vi.mocked(DiscoveredGamesRepository)

function makeRequest(): Request {
  return new Request('http://localhost/api/sync/polymarket-games-refresh', {
    method: 'GET',
    headers: { authorization: 'Bearer test-secret' },
  })
}

describe('/api/sync/polymarket-games-refresh window scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.mockReturnValue(true)
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'true'
  })

  it('queries listInRefreshWindow with [now-2h, now+24h] window', async () => {
    mockedRepo.listInRefreshWindow.mockResolvedValue({ data: [], error: null })

    await GET(makeRequest())
    expect(mockedRepo.listInRefreshWindow).toHaveBeenCalledTimes(1)
    const arg = mockedRepo.listInRefreshWindow.mock.calls[0][0]
    expect(arg.windowStart).toBeInstanceOf(Date)
    expect(arg.windowEnd).toBeInstanceOf(Date)

    const pastSpan = Date.now() - arg.windowStart.getTime()
    const futureSpan = arg.windowEnd.getTime() - Date.now()
    // Allow ±1 minute drift for test timing
    expect(pastSpan).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000)
    expect(pastSpan).toBeLessThan(2 * 60 * 60 * 1000 + 60_000)
    expect(futureSpan).toBeGreaterThan(24 * 60 * 60 * 1000 - 60_000)
    expect(futureSpan).toBeLessThan(24 * 60 * 60 * 1000 + 60_000)
  })

  it('returns disabled=true when kill switch is off', async () => {
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'false'
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ ok: true, disabled: true })
    expect(mockedRepo.listInRefreshWindow).not.toHaveBeenCalled()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('skips rows whose slug does not match any registered league pattern', async () => {
    mockedRepo.listInRefreshWindow.mockResolvedValue({
      data: [{
        slug: 'unknown-league-xyz-2026-05-05',
        league: 'unknown',
        polymarketEventId: 'gamma-x',
        title: 'Unknown',
        homeTeamLabel: null,
        awayTeamLabel: null,
        gameStartTime: '2026-05-05T23:05:00.000Z',
        isActive: true,
        isClosed: false,
        isArchived: false,
        endDate: null,
        marketsPayload: '{}',
        lastSyncedAt: '2026-05-05T20:00:00.000Z',
        lastSyncStatus: 'ok',
        lastSyncError: null,
      }],
      error: null,
    })

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.results[0].status).toBe('unknown_league')
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('handles empty refresh window (no in-window rows)', async () => {
    mockedRepo.listInRefreshWindow.mockResolvedValue({ data: [], error: null })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refreshed).toBe(0)
    expect(body.window_size).toBe(0)
    expect(body.results).toEqual([])
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns 401 for unauthorized requests', async () => {
    mockedAuth.mockReturnValueOnce(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockedRepo.listInRefreshWindow).not.toHaveBeenCalled()
  })
})
