import type { PolymarketEvent } from '@/lib/polymarket/types'
import { revalidatePath, revalidateTag } from 'next/cache'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-discovery/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { fetchPolymarketGammaEvent } from '@/lib/polymarket/client'

// Mocks must be defined BEFORE the route import so the route imports the mocks.
vi.mock('@/lib/polymarket/client', () => ({
  fetchPolymarketGammaEvent: vi.fn(),
}))
vi.mock('@/lib/db/queries/discovered-events', () => ({
  DiscoveredEventsRepository: {
    upsertSuccess: vi.fn(),
    markFailure: vi.fn(),
    getBySlug: vi.fn(),
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
const mockedRevalidate = vi.mocked(revalidateTag)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedRepo = vi.mocked(DiscoveredEventsRepository)

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/polymarket-discovery', {
    method: 'GET',
    headers: {
      authorization: 'Bearer test-secret',
      ...headers,
    },
  })
}

function makeGammaEvent(slug: string): PolymarketEvent {
  return {
    slug,
    id: 'gamma-id-123',
    title: `Title for ${slug}`,
    endDate: '2026-12-31T00:00:00Z',
    markets: [
      {
        id: `${slug}-m1`,
        conditionId: `0x${slug}-m1`,
        groupItemTitle: 'Team A',
        slug: `${slug}-team-a`,
        iconUrl: null,
        active: true,
        closed: false,
        outcomes: ['Yes', 'No'] as const,
        outcomePrices: [0.5, 0.5] as const,
        clobTokenIds: ['tok-yes', 'tok-no'] as const,
        bestBid: 0.49,
        bestAsk: 0.51,
        lastTradePrice: 0.5,
        volume: 1000,
        volume24hr: 100,
      },
    ],
  }
}

function makeUpsertOk() {
  return {
    data: {
      slug: 'any-slug',
      polymarketEventId: 'gamma-id-123',
      title: 'Title',
      isActive: true,
      endDate: '2026-12-31T00:00:00Z',
      marketsPayload: '{}',
      lastSyncedAt: '2026-05-04T00:00:00Z',
      lastSyncStatus: 'ok',
      lastSyncError: null,
    },
    error: null,
  }
}

function makeFailureOk() {
  return { data: null, error: null }
}

describe('/api/sync/polymarket-discovery — auth', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedRevalidate.mockReset()
    mockedRevalidatePath.mockReset()
    mockedAuth.mockReset()
    mockedRepo.upsertSuccess.mockReset()
    mockedRepo.markFailure.mockReset()
  })

  it('returns 401 when isCronAuthorized rejects the bearer', async () => {
    mockedAuth.mockReturnValueOnce(false)
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }))

    expect(res.status).toBe(401)
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
  })
})

describe('/api/sync/polymarket-discovery — happy path', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedRevalidate.mockReset()
    mockedRevalidatePath.mockReset()
    mockedAuth.mockReset()
    mockedAuth.mockReturnValue(true)
    mockedRepo.upsertSuccess.mockReset()
    mockedRepo.upsertSuccess.mockResolvedValue(makeUpsertOk())
    mockedRepo.markFailure.mockReset()
    mockedRepo.markFailure.mockResolvedValue(makeFailureOk())
  })

  it('iterates all five day-1 slugs and upserts each on Gamma success', async () => {
    mockedFetch.mockImplementation(async slug => makeGammaEvent(slug))

    const res = await GET(makeRequest())
    const body = await res.json() as { ok: boolean, results: Array<{ slug: string, status: string, market_count?: number }> }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(5)
    expect(body.results.every(r => r.status === 'ok')).toBe(true)
    expect(body.results.every(r => r.market_count === 1)).toBe(true)
    expect(mockedFetch).toHaveBeenCalledTimes(5)
    expect(mockedRepo.upsertSuccess).toHaveBeenCalledTimes(5)
    expect(mockedRepo.markFailure).not.toHaveBeenCalled()
  })

  it('forwards a serialized markets_payload with the trimmed shape to the upsert', async () => {
    mockedFetch.mockImplementationOnce(async slug => makeGammaEvent(slug))
    // Stop after the first slug — checkpoint contract on first invocation is enough.
    mockedFetch.mockResolvedValue(null)

    await GET(makeRequest())

    const firstCall = mockedRepo.upsertSuccess.mock.calls[0]?.[0]
    expect(firstCall?.slug).toBe('2026-nba-champion')
    expect(firstCall?.polymarket_event_id).toBe('gamma-id-123')
    expect(firstCall?.is_active).toBe(true)
    expect(firstCall?.end_date).toBeInstanceOf(Date)

    const parsed = JSON.parse(firstCall!.markets_payload) as { markets: Array<{ short_title: string }> }
    expect(parsed.markets).toHaveLength(1)
    expect(parsed.markets[0]?.short_title).toBe('Team A')
  })

  it('revalidates discoveredEvent(slug) per success plus eventsList once', async () => {
    mockedFetch.mockImplementation(async slug => makeGammaEvent(slug))

    await GET(makeRequest())

    // 5 per-slug tag invalidations + 1 eventsList
    expect(mockedRevalidate).toHaveBeenCalledTimes(6)
    const tagCalls = mockedRevalidate.mock.calls.map(c => c[0])
    expect(tagCalls).toContain('polymarket-discovered:event:2026-nba-champion')
    expect(tagCalls).toContain('polymarket-discovered:event:uefa-champions-league-winner')
    expect(tagCalls).toContain('events:list')
  })

  it('calls revalidatePath for each successful slug to bust the Vercel edge CDN', async () => {
    mockedFetch.mockImplementation(async slug => makeGammaEvent(slug))

    await GET(makeRequest())

    // One revalidatePath per successful slug
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(5)
    const pathCalls = mockedRevalidatePath.mock.calls.map(c => c[0])
    expect(pathCalls).toContain('/event/2026-nba-champion')
    expect(pathCalls).toContain('/event/uefa-champions-league-winner')
    expect(pathCalls).toContain('/event/mlb-world-series-champion-2026')
    expect(pathCalls).toContain('/event/2026-nhl-stanley-cup-champion')
    expect(pathCalls).toContain('/event/big-game-champion-2027')
  })

  it('does NOT call revalidatePath for slugs that failed to sync', async () => {
    mockedFetch.mockImplementation(async (slug) => {
      if (slug === '2026-nba-champion') {
        return makeGammaEvent(slug)
      }
      return null
    })

    await GET(makeRequest())

    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1)
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/event/2026-nba-champion')
  })
})

describe('/api/sync/polymarket-discovery — partial failure', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedRevalidate.mockReset()
    mockedRevalidatePath.mockReset()
    mockedAuth.mockReset()
    mockedAuth.mockReturnValue(true)
    mockedRepo.upsertSuccess.mockReset()
    mockedRepo.upsertSuccess.mockResolvedValue(makeUpsertOk())
    mockedRepo.markFailure.mockReset()
    mockedRepo.markFailure.mockResolvedValue(makeFailureOk())
  })

  it('records gamma_404 on null fetcher result without touching the payload', async () => {
    mockedFetch.mockResolvedValue(null)

    const res = await GET(makeRequest())
    const body = await res.json() as { results: Array<{ status: string }> }

    expect(res.status).toBe(200)
    expect(body.results.every(r => r.status === 'gamma_404')).toBe(true)
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(5)
    expect(mockedRepo.markFailure.mock.calls[0]?.[0]?.status).toBe('gamma_404')
  })

  it('does NOT revalidate eventsList when zero slugs succeed', async () => {
    mockedFetch.mockResolvedValue(null)

    await GET(makeRequest())

    expect(mockedRevalidate).not.toHaveBeenCalled()
  })

  it('mixes ok and failure across the same run', async () => {
    mockedFetch.mockImplementation(async (slug) => {
      if (slug === '2026-nba-champion' || slug === 'uefa-champions-league-winner') {
        return makeGammaEvent(slug)
      }
      return null
    })

    const res = await GET(makeRequest())
    const body = await res.json() as { results: Array<{ slug: string, status: string }> }

    const okSlugs = body.results.filter(r => r.status === 'ok').map(r => r.slug)
    const failSlugs = body.results.filter(r => r.status !== 'ok').map(r => r.slug)

    expect(okSlugs.sort()).toEqual(['2026-nba-champion', 'uefa-champions-league-winner'])
    expect(failSlugs).toHaveLength(3)
    expect(mockedRepo.upsertSuccess).toHaveBeenCalledTimes(2)
    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(3)
    // 2 per-slug tags + 1 eventsList
    expect(mockedRevalidate).toHaveBeenCalledTimes(3)
    // 2 revalidatePath for the 2 successful slugs
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(2)
  })

  it('captures network_error when the fetcher throws', async () => {
    mockedFetch.mockImplementation(async () => {
      throw new Error('boom')
    })

    const res = await GET(makeRequest())
    const body = await res.json() as { results: Array<{ status: string, error?: string }> }

    expect(res.status).toBe(200)
    expect(body.results.every(r => r.status === 'network_error')).toBe(true)
    expect(body.results[0]?.error).toBe('boom')
    expect(mockedRepo.markFailure.mock.calls[0]?.[0]?.status).toBe('network_error')
  })

  it('records upsert_error and skips revalidation when the repo upsert fails', async () => {
    mockedFetch.mockImplementation(async slug => makeGammaEvent(slug))
    mockedRepo.upsertSuccess.mockResolvedValue({ data: null, error: 'db down' })

    const res = await GET(makeRequest())
    const body = await res.json() as { results: Array<{ status: string, error?: string }> }

    expect(body.results.every(r => r.status === 'upsert_error')).toBe(true)
    expect(body.results[0]?.error).toBe('db down')
    expect(mockedRevalidate).not.toHaveBeenCalled()
    // markFailure is invoked as a fallback after the upsert error
    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(5)
  })
})
