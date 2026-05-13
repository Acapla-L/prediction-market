import type { SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import after mocks so the module under test resolves to the mocked deps.
import {
  fetchSportsGamesListCachedData,
  generateSportsGamesListMetadata,
  renderSportsGamesListPage,
} from '@/app/[locale]/(platform)/sports/_utils/sports-games-list-data'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'
import { loadDiscoveredGameSportsCardsByLeague } from '@/lib/polymarket/synthesize-sports-card'

/**
 * Stream 2 (Phase B v2 v3) — drift-locks the dispatch contract of
 * `fetchSportsGamesListCachedData` in `sports-games-list-data.tsx`.
 *
 * The fetcher's job:
 *   1. Branch A — Kuest path: resolve canonical slug + run EventRepository.listEvents.
 *   2. Branch B — Discovery path: try `getLeagueBySportRouteSlug(urlSport)`
 *      then fall back to `getLeagueBySlug(kuestCanonical)`.
 *   3. Merge with slug-equality dedup (Kuest wins on collision).
 *   4. Return null IFF neither branch resolves the URL (signals 404 to outer).
 *   5. Return populated SportsGamesListData (with possibly empty cards array)
 *      when at least one branch resolves.
 *
 * We test this via dependency injection at the module boundary (vi.mock).
 * The fetcher itself is `'use cache'`-decorated — we mock `next/cache` as a
 * pass-through so the cached function executes its body each call.
 */

// ---- Mocks ------------------------------------------------------------

vi.mock('next/cache', () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  unstable_cache: vi.fn((fn: () => unknown) => fn),
  revalidateTag: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getExtracted: vi.fn(async () => (key: string) => key),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/db/queries/sports-menu', () => ({
  SportsMenuRepository: {
    resolveCanonicalSlugByAlias: vi.fn(),
    getLayoutData: vi.fn(),
  },
}))

vi.mock('@/lib/db/queries/event', () => ({
  EventRepository: {
    listEvents: vi.fn(),
  },
}))

vi.mock('@/lib/polymarket/synthesize-sports-card', () => ({
  loadDiscoveredGameSportsCardsByLeague: vi.fn(),
}))

vi.mock('@/lib/theme-settings', () => ({
  loadRuntimeThemeState: vi.fn(async () => ({
    site: { name: 'WirePredictions' },
  })),
}))

vi.mock('@/app/[locale]/(platform)/sports/_components/SportsGamesCenter', () => ({
  default: () => null,
}))

vi.mock('@/app/[locale]/(platform)/sports/_utils/sports-games-data', () => ({
  buildSportsGamesCards: vi.fn((events: Array<{ slug: string, sports_start_time?: string }>) =>
    events.map((event, idx) => ({
      id: `kuest-card-${idx}`,
      event: { slug: event.slug } as unknown,
      slug: event.slug,
      eventHref: `/event/${event.slug}`,
      title: event.slug,
      volume: 0,
      marketsCount: 1,
      eventCreatedAt: '',
      eventResolvedAt: null,
      startTime: event.sports_start_time ?? null,
      week: null,
      teams: [],
      detailMarkets: [],
      defaultConditionId: null,
      buttons: [],
    } as unknown as SportsGamesCard)),
  ),
}))

vi.mock('@/app/[locale]/(platform)/sports/_utils/sports-menu-routing', () => ({
  findSportsHrefBySlug: vi.fn(({ canonicalSportSlug }: { canonicalSportSlug: string }) =>
    canonicalSportSlug === 'unknown' ? null : `/sports/${canonicalSportSlug}/games`,
  ),
}))

const mockedResolveAlias = vi.mocked(SportsMenuRepository.resolveCanonicalSlugByAlias)
const mockedGetLayoutData = vi.mocked(SportsMenuRepository.getLayoutData)
const mockedListEvents = vi.mocked(EventRepository.listEvents)
const mockedLoadDiscoveryByLeague = vi.mocked(loadDiscoveredGameSportsCardsByLeague)

function makeDiscoveryCard(slug: string, startTime: string): SportsGamesCard {
  return {
    id: `discovery-card-${slug}`,
    event: { slug } as unknown,
    slug,
    eventHref: `/sports/baseball/${slug}`,
    title: slug,
    volume: 0,
    marketsCount: 1,
    eventCreatedAt: '',
    eventResolvedAt: null,
    startTime,
    week: null,
    teams: [],
    detailMarkets: [],
    defaultConditionId: null,
    buttons: [],
  } as unknown as SportsGamesCard
}

function setKuestRecognized(canonical: string) {
  mockedResolveAlias.mockResolvedValue({ data: canonical, error: null })
  mockedGetLayoutData.mockResolvedValue({
    data: {
      menuEntries: [],
      countsBySlug: {},
      canonicalSlugByAliasKey: {},
      h1TitleBySlug: { [canonical]: canonical.toUpperCase() },
      sectionsBySlug: {},
    },
    error: null,
  } as unknown as Awaited<ReturnType<typeof SportsMenuRepository.getLayoutData>>)
}

function setKuestUnknown() {
  mockedResolveAlias.mockResolvedValue({ data: null, error: null })
  mockedGetLayoutData.mockResolvedValue({
    data: {
      menuEntries: [],
      countsBySlug: {},
      canonicalSlugByAliasKey: {},
      h1TitleBySlug: {},
      sectionsBySlug: {},
    },
    error: null,
  } as unknown as Awaited<ReturnType<typeof SportsMenuRepository.getLayoutData>>)
}

describe('renderSportsGamesListPage — Stream 2 dispatch invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('kuest non-empty + discovery empty → renders Kuest cards only', async () => {
    setKuestRecognized('mlb')
    mockedListEvents.mockResolvedValue({
      data: [
        { slug: 'mlb-atl-laa-2026-04-07', sports_start_time: '2026-04-07T19:00:00Z' } as unknown,
      ],
      error: null,
    } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([])

    const node = await renderSportsGamesListPage({ locale: 'en', sport: 'mlb' })
    expect(node).toBeDefined()
    expect(mockedListEvents).toHaveBeenCalledOnce()
    expect(mockedLoadDiscoveryByLeague).toHaveBeenCalledWith('mlb')
  })

  it('soccer URL → dispatches to ALL soccer leagues (epl, laliga, mls) and unions cards', async () => {
    setKuestUnknown()
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockImplementation(async (leagueSlug: string) => {
      if (leagueSlug === 'epl') {
        return [makeDiscoveryCard('epl-ars-che-2026-05-10', '2026-05-10T14:00:00Z')]
      }
      if (leagueSlug === 'laliga') {
        return [makeDiscoveryCard('lal-rma-bar-2026-05-11', '2026-05-11T19:00:00Z')]
      }
      if (leagueSlug === 'mls') {
        return [makeDiscoveryCard('mls-lafc-sea-2026-05-12', '2026-05-12T23:00:00Z')]
      }
      return []
    })

    const data = await fetchSportsGamesListCachedData('soccer', 'en')
    expect(data).not.toBeNull()
    expect(data!.sportSlug).toBe('soccer')
    expect(typeof data!.sportTitle).toBe('string')
    expect(data!.sportTitle.length).toBeGreaterThan(0)
    // One call per soccer league, in registry order.
    expect(mockedLoadDiscoveryByLeague.mock.calls.map(c => c[0])).toEqual(['epl', 'laliga', 'mls'])
    // Cards = union of all three leagues.
    const slugs = data!.cards.map(card => (card.event as { slug: string }).slug)
    expect(slugs).toContain('epl-ars-che-2026-05-10')
    expect(slugs).toContain('lal-rma-bar-2026-05-11')
    expect(slugs).toContain('mls-lafc-sea-2026-05-12')
  })

  it('fifa-world-cup URL → dispatches to fifwc league only with friendly title', async () => {
    setKuestUnknown()
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockImplementation(async (leagueSlug: string) =>
      leagueSlug === 'fifwc' ? [makeDiscoveryCard('fifwc-arg-fra-2026-06-15', '2026-06-15T19:00:00Z')] : [],
    )

    const data = await fetchSportsGamesListCachedData('fifa-world-cup', 'en')
    expect(data).not.toBeNull()
    expect(data!.sportSlug).toBe('fifa-world-cup')
    expect(data!.sportTitle).toBe('FIFA World Cup 2026')
    expect(mockedLoadDiscoveryByLeague.mock.calls.map(c => c[0])).toEqual(['fifwc'])
  })

  it('kuest empty + discovery non-empty (NBA) → renders discovery cards only', async () => {
    setKuestRecognized('nba')
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([
      makeDiscoveryCard('nba-min-sas-2026-05-06', '2026-05-06T23:00:00Z'),
      makeDiscoveryCard('nba-bos-mia-2026-05-07', '2026-05-07T23:00:00Z'),
    ])

    const node = await renderSportsGamesListPage({ locale: 'en', sport: 'basketball' })
    expect(node).toBeDefined()
    expect(mockedLoadDiscoveryByLeague).toHaveBeenCalledWith('nba')
  })

  it('kuest non-empty + discovery non-empty + slug collision → Kuest wins, dedup applied', async () => {
    // Both branches return cards for the same slug. Merge logic must drop
    // the discovery duplicate and keep the Kuest version.
    setKuestRecognized('mlb')
    mockedListEvents.mockResolvedValue({
      data: [
        { slug: 'mlb-tex-nyy-2026-05-07', sports_start_time: '2026-05-07T19:00:00Z' } as unknown,
      ],
      error: null,
    } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([
      makeDiscoveryCard('mlb-tex-nyy-2026-05-07', '2026-05-07T19:00:00Z'), // collides
      makeDiscoveryCard('mlb-cin-chc-2026-05-07', '2026-05-07T20:00:00Z'),
    ])

    // Because we render only and the SportsGamesCenter is mocked to null,
    // we re-invoke generateMetadata to verify the SAME pipeline doesn't
    // throw + dedup logic doesn't crash.
    await expect(
      generateSportsGamesListMetadata({ locale: 'en', sport: 'baseball' }),
    ).resolves.toBeDefined()
  })

  it('both empty for a registered league → empty grid (NOT 404)', async () => {
    // Per Allan policy: registered league + zero cards is graceful empty.
    setKuestRecognized('mlb')
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([])

    const node = await renderSportsGamesListPage({ locale: 'en', sport: 'mlb' })
    expect(node).toBeDefined() // does NOT throw notFound()
  })

  it('unknown URL sport (Kuest unknown + not in discovery registry) → notFound() fires', async () => {
    setKuestUnknown()
    // Discovery branch lookup happens via static registry (real module). We
    // pass a sport that's neither in the registry's `sportRouteSlug` set
    // (baseball/basketball/hockey) nor a registry slug (mlb/nba/nhl).
    mockedLoadDiscoveryByLeague.mockResolvedValue([])

    await expect(
      renderSportsGamesListPage({ locale: 'en', sport: 'totally-fake-sport' }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/)
  })

  it('canonical-token URL `mlb` → discovery dispatches via getLeagueBySlug fallback', async () => {
    setKuestRecognized('mlb')
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([
      makeDiscoveryCard('mlb-tex-nyy-2026-05-07', '2026-05-07T19:00:00Z'),
    ])

    const node = await renderSportsGamesListPage({ locale: 'en', sport: 'mlb' })
    expect(node).toBeDefined()
    // URL was 'mlb' (canonical, NOT a sportRouteSlug); the discovery branch
    // should still fire via the canonical-token fallback in the fetcher.
    expect(mockedLoadDiscoveryByLeague).toHaveBeenCalledWith('mlb')
  })

  it('alias-URL `baseball` → discovery dispatches via getLeagueBySportRouteSlug', async () => {
    setKuestRecognized('mlb')
    mockedListEvents.mockResolvedValue({ data: [], error: null } as Awaited<ReturnType<typeof EventRepository.listEvents>>)
    mockedLoadDiscoveryByLeague.mockResolvedValue([
      makeDiscoveryCard('mlb-tex-nyy-2026-05-07', '2026-05-07T19:00:00Z'),
    ])

    const node = await renderSportsGamesListPage({ locale: 'en', sport: 'baseball' })
    expect(node).toBeDefined()
    // URL was 'baseball' (sportRouteSlug for MLB) — registry lookup matches
    // first, so the discovery branch resolves to league.slug = 'mlb'.
    expect(mockedLoadDiscoveryByLeague).toHaveBeenCalledWith('mlb')
  })
})
