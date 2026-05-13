import type { PolymarketEvent } from '@/lib/polymarket/types'
import { revalidatePath, revalidateTag } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-games-refresh/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { fetchPolymarketGammaEvent } from '@/lib/polymarket/client'

import { normalizeGamesDiscoveryPayload } from '@/lib/polymarket/normalize-games-discovery-payload'

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

// Stream 2 success-path test mocks normalize to short-circuit Zod parsing
// of the synthetic Gamma fixture; the route's revalidation contract is what
// we're testing, not the normalize layer (covered separately).
vi.mock('@/lib/polymarket/normalize-games-discovery-payload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/polymarket/normalize-games-discovery-payload')>(
    '@/lib/polymarket/normalize-games-discovery-payload',
  )
  return {
    ...actual,
    normalizeGamesDiscoveryPayload: vi.fn(),
    serializeGamesDiscoveryPayload: vi.fn(() => '{"markets":[]}'),
  }
})

const mockedNormalize = vi.mocked(normalizeGamesDiscoveryPayload)
const mockedFetch = vi.mocked(fetchPolymarketGammaEvent)
const mockedAuth = vi.mocked(isCronAuthorized)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedRevalidateTag = vi.mocked(revalidateTag)
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

  it('F-1: writes refreshed rows to the DB but does NOT invalidate any caches', async () => {
    // Two MLB rows in the refresh window — both refresh successfully. After
    // Fix F-1 (2026-05-12) the every-5-min refresh route only writes fresh
    // prices/lifecycle into the rows; it no longer busts ANY cache (per-game
    // tag/path, per-league list tag/path, homepage). Keeping every in-window
    // per-game page + every /sports/.../games list page perpetually cold was
    // the precondition for the 2026-05-12 cold-render cascade. Lifecycle
    // changes are picked up by the hourly polymarket-games-discovery sync.
    function mlbRow(slug: string) {
      return {
        slug,
        league: 'mlb',
        polymarketEventId: `gamma-${slug}`,
        title: `MLB ${slug}`,
        homeTeamLabel: null,
        awayTeamLabel: null,
        gameStartTime: '2026-05-07T23:05:00.000Z',
        isActive: true,
        isClosed: false,
        isArchived: false,
        endDate: null,
        marketsPayload: '{}',
        lastSyncedAt: '2026-05-07T20:00:00.000Z',
        lastSyncStatus: 'ok',
        lastSyncError: null,
      }
    }
    mockedRepo.listInRefreshWindow.mockResolvedValue({
      data: [mlbRow('mlb-tex-nyy-2026-05-07'), mlbRow('mlb-cin-chc-2026-05-07')],
      error: null,
    })

    function gammaEventFor(slug: string): PolymarketEvent {
      return {
        slug,
        id: `gamma-${slug}`,
        title: `MLB ${slug}`,
        endDate: '2026-05-07T23:05:00Z',
        createdAt: '2026-04-29T13:00:18.813855Z',
        negRisk: false,
        enableNegRisk: false,
        markets: [
          {
            id: `${slug}-moneyline`,
            conditionId: `0x${slug}`,
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
            sportsMarketType: 'moneyline',
          },
        ],
      } as PolymarketEvent
    }

    mockedFetch.mockImplementation(async (slug: string) => gammaEventFor(slug))
    mockedNormalize.mockImplementation((event, league) => ({
      slug: event.slug,
      league,
      polymarket_event_id: event.id,
      title: event.title,
      home_team_label: null,
      away_team_label: null,
      game_start_time: new Date('2026-05-07T23:05:00Z'),
      is_active: true,
      is_closed: false,
      end_date: new Date('2026-05-07T23:05:00Z'),
      payload: {
        slug: event.slug,
        league,
        polymarket_event_id: event.id,
        title: event.title,
        home_team_label: null,
        away_team_label: null,
        event_created_at: '2026-04-29T13:00:18.813855Z',
        game_start_time: '2026-05-07T23:05:00Z',
        is_active: true,
        is_closed: false,
        end_date: '2026-05-07T23:05:00Z',
        markets: [],
      } as unknown as ReturnType<typeof normalizeGamesDiscoveryPayload>['payload'],
    } as unknown as ReturnType<typeof normalizeGamesDiscoveryPayload>))
    mockedRepo.upsertSuccess.mockImplementation(async (input) => {
      return {
        data: {
          slug: input.slug,
          league: input.league,
          polymarketEventId: input.polymarket_event_id,
          title: input.title,
          homeTeamLabel: input.home_team_label,
          awayTeamLabel: input.away_team_label,
          gameStartTime: input.game_start_time.toISOString(),
          isActive: input.is_active,
          isClosed: input.is_closed,
          isArchived: false,
          endDate: input.end_date ? input.end_date.toISOString() : null,
          marketsPayload: input.markets_payload,
          lastSyncedAt: '2026-05-07T20:00:00.000Z',
          lastSyncStatus: 'ok',
          lastSyncError: null,
        },
        error: null,
      }
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refreshed).toBeGreaterThanOrEqual(1)

    // The route's job: write fresh prices/lifecycle into the rows.
    expect(mockedRepo.upsertSuccess).toHaveBeenCalled()

    // Fix F-1: no cache invalidation of any kind from the 5-min route.
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})
