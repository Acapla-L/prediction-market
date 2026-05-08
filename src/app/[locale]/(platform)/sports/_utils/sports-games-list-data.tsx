import type { Metadata } from 'next'
import type { SportsGamesCard } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { SupportedLocale } from '@/i18n/locales'
import { getExtracted, setRequestLocale } from 'next-intl/server'
import { cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import SportsGamesCenter from '@/app/[locale]/(platform)/sports/_components/SportsGamesCenter'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { findSportsHrefBySlug } from '@/app/[locale]/(platform)/sports/_utils/sports-menu-routing'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'
import { getLeagueBySlug, getLeagueBySportRouteSlug } from '@/lib/polymarket/games-leagues'
import { loadDiscoveredGameSportsCardsByLeague } from '@/lib/polymarket/synthesize-sports-card'
import { STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

/**
 * Stream 2 (Phase B v2 v3) — sports list-route data layer.
 *
 * Mirrors the Phase B v2 v1 cache-boundary pattern in sibling
 * `sports-event-page.tsx`:
 *   - Cached `'use cache'` data fetcher returns null sentinel for
 *     "this URL token resolves to no league" (signals 404 to outer).
 *   - Outer non-cached metadata + render functions call `notFound()`
 *     OUTSIDE the cache boundary so HTTP 404 commits correctly.
 *
 * Dispatch policy (Allan-confirmed 2026-05-07):
 *   1. Kuest first: resolve canonical sport via SportsMenuRepository alias
 *      lookup. If found, list active Kuest events.
 *   2. Discovery second: try `getLeagueBySportRouteSlug(urlSport)` (URL
 *      alias path, e.g. `'baseball'` → MLB) then fall back to
 *      `getLeagueBySlug(kuestCanonical)` (canonical path, e.g. `'mlb'` → MLB).
 *   3. Merge with slug-equality dedup — Kuest wins on collision (preserves
 *      creator-wallet flow safety net for Phase 2.5).
 *   4. Empty grid (NOT 404) when a registered league has zero tradeable
 *      games — matches Allan's 2026-05-07 policy.
 *   5. 404 only when the URL `sport` token resolves to neither a Kuest
 *      canonical slug NOR a discovery registry sportRouteSlug/slug.
 */

interface SportsGamesListData {
  cards: SportsGamesCard[]
  sportSlug: string
  sportTitle: string
}

/**
 * `'use cache'` data-fetcher — never calls notFound(). Returns null for the
 * "unknown sport" case so the outer (non-cached) caller can call notFound()
 * with a proper HTTP 404 status.
 *
 * Mirrors the Phase A v2 P0 fix pattern (commit 9c250959) — in Next.js 16
 * Cache Components, HTTP 200 commits before the cached body finishes; a
 * notFound() throw inside `'use cache'` cannot retroactively change the
 * status to 404 (produces React #419 hydration mismatch instead).
 */
async function fetchSportsGamesListCachedData(
  sport: string,
  locale: SupportedLocale,
): Promise<SportsGamesListData | null> {
  'use cache'

  cacheTag(cacheTags.eventsList)

  // Branch A — Kuest path (existing behavior preserved).
  const [{ data: kuestCanonical }, { data: layoutData }] = await Promise.all([
    SportsMenuRepository.resolveCanonicalSlugByAlias(sport),
    SportsMenuRepository.getLayoutData('sports'),
  ])

  const kuestRecognized = Boolean(
    kuestCanonical
    && findSportsHrefBySlug({
      menuEntries: layoutData?.menuEntries,
      canonicalSportSlug: kuestCanonical,
    }),
  )

  let kuestCards: SportsGamesCard[] = []
  if (kuestRecognized && kuestCanonical) {
    const { data: activeEvents } = await EventRepository.listEvents({
      tag: 'sports',
      sportsVertical: 'sports',
      search: '',
      userId: '',
      bookmarked: false,
      locale,
      sportsSportSlug: kuestCanonical,
      sportsSection: 'games',
      status: 'active',
    })
    kuestCards = buildSportsGamesCards(activeEvents ?? [])
  }

  // Branch B — Discovery path. Try the URL token directly against the
  // registry's `sportRouteSlug` (e.g. `'baseball'` → MLB) first; fall back
  // to the canonical slug (e.g. `'mlb'` → MLB) so URLs like /sports/mlb/games
  // also dispatch correctly.
  const league = getLeagueBySportRouteSlug(sport)
    ?? (kuestCanonical ? getLeagueBySlug(kuestCanonical) : undefined)

  let discoveryCards: SportsGamesCard[] = []
  if (league) {
    cacheTag(cacheTags.discoveredGamesList(league.slug))
    discoveryCards = await loadDiscoveredGameSportsCardsByLeague(league.slug)
  }

  // 404 condition: neither branch resolved the URL token.
  if (!kuestRecognized && !league) {
    return null
  }

  // Merge with slug-equality dedup. Kuest wins on collision so the creator-
  // wallet flow safety net is preserved (a future re-seeded Kuest market
  // shadows the discovery row).
  const kuestSlugs = new Set(kuestCards.map(card => card.event.slug))
  const dedupedDiscovery = discoveryCards.filter(card => !kuestSlugs.has(card.event.slug))
  const merged = [...kuestCards, ...dedupedDiscovery].sort((a, b) => {
    const aTime = a.startTime ?? ''
    const bTime = b.startTime ?? ''
    if (aTime && bTime) {
      return aTime < bTime ? -1 : aTime > bTime ? 1 : 0
    }
    if (aTime) {
      return -1
    }
    if (bTime) {
      return 1
    }
    return 0
  })

  // Sport slug + title resolution: prefer the Kuest canonical (so the
  // sidebar `findSportsHrefBySlug` rendering and h1TitleBySlug lookup match
  // existing behavior). Fall back to the discovery registry slug + uppercase
  // when Kuest doesn't recognize the URL token.
  const sportSlug = kuestCanonical ?? league?.slug ?? sport
  const sportTitle = layoutData?.h1TitleBySlug[sportSlug]
    ?? (league ? league.slug.toUpperCase() : sportSlug.toUpperCase())

  return {
    cards: merged,
    sportSlug,
    sportTitle,
  }
}

/**
 * OUTER (non-cached) metadata function. Calls notFound() OUTSIDE the cache
 * boundary based on the null sentinel returned by `fetchSportsGamesListCachedData`.
 */
export async function generateSportsGamesListMetadata({
  locale,
  sport,
}: {
  locale: string
  sport: string
}): Promise<Metadata> {
  setRequestLocale(locale)

  if (sport === STATIC_PARAMS_PLACEHOLDER) {
    notFound()
  }

  const resolvedLocale = locale as SupportedLocale
  const [runtimeTheme, listData] = await Promise.all([
    loadRuntimeThemeState(),
    fetchSportsGamesListCachedData(sport, resolvedLocale),
  ])
  if (!listData) {
    notFound()
  }

  const siteName = runtimeTheme.site.name
  const t = await getExtracted()

  return {
    title: t('{sportTitle} Prediction Markets & Live Odds', { sportTitle: listData.sportTitle }),
    description: t('Trade on live {sportTitle} matches in real time on {siteName}. Bet on moneyline, spread, and total markets. Real-time odds and scores.', {
      sportTitle: listData.sportTitle,
      siteName,
    }),
  }
}

/**
 * OUTER (non-cached) page renderer. Pulls cached data via
 * `fetchSportsGamesListCachedData` (returns null sentinel for unknown
 * sport); calls notFound() OUTSIDE the cache boundary so HTTP 404 commits.
 *
 * Empty `cards` array renders gracefully via `SportsGamesCenter`'s built-in
 * empty-state UI — Allan's policy 2026-05-07: "empty grid, never 404 a
 * registered league for emptiness alone."
 */
export async function renderSportsGamesListPage({
  locale,
  sport,
}: {
  locale: string
  sport: string
}) {
  setRequestLocale(locale)

  if (sport === STATIC_PARAMS_PLACEHOLDER) {
    notFound()
  }

  const resolvedLocale = locale as SupportedLocale
  const listData = await fetchSportsGamesListCachedData(sport, resolvedLocale)
  if (!listData) {
    notFound()
  }

  return (
    <div key={`sports-games-page-${listData.sportSlug}`} className="contents">
      <SportsGamesCenter
        cards={listData.cards}
        sportSlug={listData.sportSlug}
        sportTitle={listData.sportTitle}
        vertical="sports"
      />
    </div>
  )
}
