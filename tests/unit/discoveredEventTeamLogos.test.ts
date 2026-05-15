import type { DiscoveredEventRow } from '@/lib/db/queries/discovered-events'
import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { loadDiscoveredEventPageData } from '@/lib/polymarket/discovery'

// Mock next/cache so 'use cache' is a no-op and we can spy on cacheTag.
const mockedCacheTag = vi.fn()
vi.mock('next/cache', () => ({
  cacheTag: (...args: unknown[]) => mockedCacheTag(...args),
  cacheLife: vi.fn(),
}))

vi.mock('@/lib/db/queries/discovered-events', () => ({
  DiscoveredEventsRepository: {
    getBySlug: vi.fn(),
  },
}))

vi.mock('@/lib/db/queries/teams-cache', () => ({
  TeamsCacheRepository: {
    listByLeague: vi.fn(),
    getByAbbreviation: vi.fn(),
    upsertSuccess: vi.fn(),
    markFailure: vi.fn(),
  },
}))

const mockedRepo = vi.mocked(DiscoveredEventsRepository)
const mockedTeamsRepo = vi.mocked(TeamsCacheRepository)

function makeTeamRow(partial: Partial<TeamCacheRow> & Pick<TeamCacheRow, 'league' | 'name' | 'abbreviation' | 'logoUrl'>): TeamCacheRow {
  return {
    teamId: partial.teamId ?? 'team-id',
    alias: partial.alias ?? null,
    color: partial.color ?? null,
    record: partial.record ?? null,
    lastSyncedAt: partial.lastSyncedAt ?? '2026-05-14T00:00:00.000Z',
    lastSyncStatus: partial.lastSyncStatus ?? 'ok',
    lastSyncError: partial.lastSyncError ?? null,
    ...partial,
  }
}

function makeNbaRow(): DiscoveredEventRow {
  return {
    slug: '2026-nba-champion',
    polymarketEventId: 'nba-event-id',
    title: '2026 NBA Champion',
    isActive: true,
    endDate: '2026-06-30T00:00:00.000Z',
    marketsPayload: JSON.stringify({
      markets: [
        {
          polymarket_market_id: 'hawks-mkt',
          slug: 'hawks-win-nba',
          short_title: 'Atlanta Hawks',
          is_active: true,
          is_closed: false,
          outcome_prices: ['0.025', '0.975'],
          clob_token_ids: ['hawks-yes', 'hawks-no'],
          volume: 1_000_000,
          icon_url: 'https://polymarket.com/nba-generic-banner.jpg',
        },
        {
          polymarket_market_id: 'lakers-mkt',
          slug: 'lakers-win-nba',
          short_title: 'Los Angeles Lakers',
          is_active: true,
          is_closed: false,
          outcome_prices: ['0.04', '0.96'],
          clob_token_ids: ['lakers-yes', 'lakers-no'],
          volume: 2_000_000,
          icon_url: 'https://polymarket.com/nba-generic-banner.jpg',
        },
        {
          polymarket_market_id: 'unknown-team-mkt',
          slug: 'mystery-team-win-nba',
          short_title: 'Mystery Team Without Cache Entry',
          is_active: true,
          is_closed: false,
          outcome_prices: ['0.001', '0.999'],
          clob_token_ids: ['mystery-yes', 'mystery-no'],
          volume: 100,
          icon_url: 'https://polymarket.com/nba-generic-banner.jpg',
        },
      ],
    }),
    lastSyncedAt: '2026-05-14T00:00:00.000Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
  } as DiscoveredEventRow
}

describe('loadDiscoveredEventPageData — team logo enrichment', () => {
  beforeEach(() => {
    mockedCacheTag.mockReset()
    mockedRepo.getBySlug.mockReset()
    mockedTeamsRepo.listByLeague.mockReset()
  })

  it('overrides market.icon_url with teams_cache logo for matched teams', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({
      data: [
        makeTeamRow({ league: 'nba', name: 'Hawks', abbreviation: 'atl', logoUrl: 'https://cdn/atlanta-hawks.png' }),
        makeTeamRow({ league: 'nba', name: 'Lakers', abbreviation: 'lal', logoUrl: 'https://cdn/los-angeles-lakers.png' }),
      ],
      error: null,
    })

    const result = await loadDiscoveredEventPageData('2026-nba-champion')

    expect(result).not.toBeNull()
    const markets = result!.event.markets
    expect(markets).toHaveLength(3)

    const hawks = markets.find(m => m.short_title === 'Atlanta Hawks')!
    const lakers = markets.find(m => m.short_title === 'Los Angeles Lakers')!
    expect(hawks.icon_url).toBe('https://cdn/atlanta-hawks.png')
    expect(lakers.icon_url).toBe('https://cdn/los-angeles-lakers.png')
  })

  it('falls back to payloadEntry.icon_url when no teams_cache row matches', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({
      data: [
        makeTeamRow({ league: 'nba', name: 'Hawks', abbreviation: 'atl', logoUrl: 'https://cdn/atlanta-hawks.png' }),
      ],
      error: null,
    })

    const result = await loadDiscoveredEventPageData('2026-nba-champion')
    const mystery = result!.event.markets.find(m => m.short_title === 'Mystery Team Without Cache Entry')!
    expect(mystery.icon_url).toBe('https://polymarket.com/nba-generic-banner.jpg')
  })

  it('falls back to payloadEntry.icon_url when teams_cache returns empty', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({ data: [], error: null })

    const result = await loadDiscoveredEventPageData('2026-nba-champion')
    const hawks = result!.event.markets.find(m => m.short_title === 'Atlanta Hawks')!
    expect(hawks.icon_url).toBe('https://polymarket.com/nba-generic-banner.jpg')
  })

  it('falls back to payloadEntry.icon_url when teams_cache query errors', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({ data: null, error: 'db-down' })

    const result = await loadDiscoveredEventPageData('2026-nba-champion')
    expect(result).not.toBeNull()
    const hawks = result!.event.markets.find(m => m.short_title === 'Atlanta Hawks')!
    expect(hawks.icon_url).toBe('https://polymarket.com/nba-generic-banner.jpg')
  })

  it('queries teams_cache with the metadata-derived league (nba)', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({ data: [], error: null })

    await loadDiscoveredEventPageData('2026-nba-champion')

    expect(mockedTeamsRepo.listByLeague).toHaveBeenCalledTimes(1)
    expect(mockedTeamsRepo.listByLeague).toHaveBeenCalledWith('nba')
  })

  it('cache-tag drift-lock: registers BOTH discoveredEvent(slug) AND teamsCache(league)', async () => {
    mockedRepo.getBySlug.mockResolvedValue({ data: makeNbaRow(), error: null })
    mockedTeamsRepo.listByLeague.mockResolvedValue({ data: [], error: null })

    await loadDiscoveredEventPageData('2026-nba-champion')

    const calls = mockedCacheTag.mock.calls.map(c => c[0])
    expect(calls).toContain(cacheTags.discoveredEvent('2026-nba-champion'))
    expect(calls).toContain(cacheTags.teamsCache('nba'))
  })

  it('does not query teams_cache for slugs without metadata (returns null event)', async () => {
    // Unknown slug → no metadata → no teams_cache query. Repo returns no row,
    // function returns null.
    mockedRepo.getBySlug.mockResolvedValue({ data: null, error: null })

    const result = await loadDiscoveredEventPageData('not-a-discovery-slug')

    expect(result).toBeNull()
    expect(mockedTeamsRepo.listByLeague).not.toHaveBeenCalled()
  })
})
