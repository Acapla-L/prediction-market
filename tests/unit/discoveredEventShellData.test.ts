import type { DiscoveredEventRow } from '@/lib/db/queries/discovered-events'
import { cacheTag } from 'next/cache'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { loadDiscoveredEventShellData } from '@/lib/polymarket/discovery'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

// Mock next/cache so 'use cache' annotations are no-ops under Vitest Node and
// we can assert which tags were applied.
vi.mock('next/cache', () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  unstable_cache: vi.fn((fn: () => unknown) => fn),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/db/queries/discovered-events', () => ({
  DiscoveredEventsRepository: {
    getBySlug: vi.fn(),
  },
}))

vi.mock('@/lib/theme-settings', () => ({
  loadRuntimeThemeState: vi.fn(),
}))

vi.mock('server-only', () => ({}))

const mockedRepo = vi.mocked(DiscoveredEventsRepository)
const mockedTheme = vi.mocked(loadRuntimeThemeState)
const mockedCacheTag = vi.mocked(cacheTag)

function makeRow(overrides: Partial<DiscoveredEventRow> = {}): DiscoveredEventRow {
  return {
    slug: '2026-nba-champion',
    polymarketEventId: '12345',
    title: '2026 NBA Champion',
    isActive: true,
    endDate: '2026-06-30T00:00:00.000Z',
    marketsPayload: JSON.stringify({ markets: [] }),
    lastSyncedAt: '2026-05-05T10:00:00.000Z',
    lastSyncStatus: 'ok',
    lastSyncError: null,
    ...overrides,
  }
}

const FAKE_SITE = { name: 'WirePredictions' } as Awaited<ReturnType<typeof loadRuntimeThemeState>>['site']

describe('loadDiscoveredEventShellData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTheme.mockResolvedValue({
      site: FAKE_SITE,
    } as Awaited<ReturnType<typeof loadRuntimeThemeState>>)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns the row + site for a populated slug', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: makeRow(), error: null })

    const result = await loadDiscoveredEventShellData('2026-nba-champion')

    expect(result.row).not.toBeNull()
    expect(result.row?.title).toBe('2026 NBA Champion')
    expect(result.site).toBe(FAKE_SITE)
    expect(mockedRepo.getBySlug).toHaveBeenCalledWith('2026-nba-champion')
  })

  it('returns row=null when sidecar has no entry (caller is responsible for notFound())', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: null, error: null })

    const result = await loadDiscoveredEventShellData('2026-nba-champion')

    expect(result.row).toBeNull()
    // Site identity is still returned so callers can build fallback metadata.
    expect(result.site).toBe(FAKE_SITE)
  })

  it('returns row=null when the repository errors', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: null, error: 'db down' })

    const result = await loadDiscoveredEventShellData('2026-nba-champion')

    expect(result.row).toBeNull()
  })

  it('invalidation contract: applies discoveredEvent + settings cache tags', async () => {
    mockedRepo.getBySlug.mockResolvedValueOnce({ data: makeRow(), error: null })

    await loadDiscoveredEventShellData('2026-nba-champion')

    // The slug-scoped tag — sync route fires `revalidateTag` on this so admin
    // edits to the sidecar bust this metadata cache cleanly.
    expect(mockedCacheTag).toHaveBeenCalledWith(cacheTags.discoveredEvent('2026-nba-champion'))
    // The settings tag — admin theme/site-name changes propagate to discovery
    // metadata. Symmetric with loadEventPageShellData (Kuest path).
    expect(mockedCacheTag).toHaveBeenCalledWith(cacheTags.settings)
  })
})
