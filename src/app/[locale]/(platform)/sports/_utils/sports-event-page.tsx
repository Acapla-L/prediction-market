import type { Metadata } from 'next'
import type { SportsGamesCard, SportsGamesCardMarketView } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import type { SupportedLocale } from '@/i18n/locales'
import type { SportsVertical } from '@/lib/sports-vertical'
import type { ThemeSiteIdentity } from '@/lib/theme-site-identity'
import { setRequestLocale } from 'next-intl/server'
import { cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import EventMarketChannelProvider from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider'
import SportsEventCenter from '@/app/[locale]/(platform)/sports/_components/SportsEventCenter'
import {
  buildSportsGamesCardGroups,
  buildSportsGamesCards,
  mergeSportsGamesCardMarkets,
} from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import EventStructuredData from '@/components/seo/EventStructuredData'
import { redirect } from '@/i18n/navigation'
import { loadMarketContextSettings } from '@/lib/ai/market-context-config'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'
import {
  buildEventOgImageUrl,
  buildEventPageMetadata,
  buildEventPageUrl,
} from '@/lib/event-open-graph'
import { getEventRouteBySlug, resolveCanonicalEventSlugFromSportsPath } from '@/lib/event-page-data'
import { resolveEventBasePath, resolveEventMarketPath, resolveEventPagePath } from '@/lib/events-routing'
import {
  isGamesDiscoveryEnabledForSlug,
  loadDiscoveredGameShellData,
} from '@/lib/polymarket/games-discovery'
import { loadDiscoveredGameSportsCard } from '@/lib/polymarket/synthesize-sports-card'
import { resolveSportsEventMarketViewKey } from '@/lib/sports-event-slugs'
import { getSportsVerticalConfig } from '@/lib/sports-vertical'
import { STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

export interface SportsVerticalEventPageParams {
  locale: string
  sport: string
  league?: string
  event: string
}

export interface SportsVerticalEventMarketPageParams extends SportsVerticalEventPageParams {
  market: string
}

interface RenderSportsVerticalEventPageParams extends SportsVerticalEventPageParams {
  vertical: SportsVertical
}

interface RenderSportsVerticalEventMarketPageParams extends SportsVerticalEventMarketPageParams {
  vertical: SportsVertical
}

function hasValidSportsEventPageParams({
  sport,
  league,
  event,
}: Pick<SportsVerticalEventPageParams, 'sport' | 'league' | 'event'>): boolean {
  return (
    sport !== STATIC_PARAMS_PLACEHOLDER
    && league !== STATIC_PARAMS_PLACEHOLDER
    && event !== STATIC_PARAMS_PLACEHOLDER
  )
}

function isSameSportsGame(
  left: ReturnType<typeof buildSportsGamesCards>[number],
  right: ReturnType<typeof buildSportsGamesCards>[number],
) {
  const leftSportsEventSlug = left.event.sports_event_slug?.trim().toLowerCase() ?? null
  const rightSportsEventSlug = right.event.sports_event_slug?.trim().toLowerCase() ?? null

  if (leftSportsEventSlug && rightSportsEventSlug) {
    return leftSportsEventSlug === rightSportsEventSlug
  }

  return left.id === right.id || left.event.id === right.event.id || left.event.slug === right.event.slug
}

/**
 * Phase B v2: shape carried out of the cached fetcher for the Kuest path.
 * The synthesized values (cardGroups, allMarkets, runtimeTheme, etc.) are
 * pre-computed inside the cache and passed to the outer render so the cache
 * boundary contains all the heavy DB/API reads.
 */
interface KuestSportsCachedData {
  kind: 'kuest'
  canonicalEventSlug: string
  expectedPath: string
  hasEventBasePath: boolean
  targetCard: ReturnType<typeof buildSportsGamesCards>[number]
  marketViewCards: SportsGamesCardMarketView[]
  allMarkets: ReturnType<typeof mergeSportsGamesCardMarkets>
  resolvedSportSlug: string
  sportLabel: string
  marketContextEnabled: boolean
  runtimeTheme: Awaited<ReturnType<typeof loadRuntimeThemeState>>
}

/**
 * Phase B v2: discovery path returns the projected SportsGamesCard plus the
 * resolved sport label (taken from `SportsMenuRepository.getLayoutData`). The
 * Phase B path skips redirect/canonical-path checks because the discovery slug
 * itself IS canonical.
 */
interface DiscoveryGameSportsCachedData {
  kind: 'discovery-game'
  card: SportsGamesCard
  resolvedSportSlug: string
  sportLabel: string
  marketContextEnabled: boolean
  runtimeTheme: Awaited<ReturnType<typeof loadRuntimeThemeState>>
}

type SportsCachedData = KuestSportsCachedData | DiscoveryGameSportsCachedData

/**
 * `'use cache'` data-fetcher — never calls notFound(). Returns null for
 * missing data so the outer `renderSportsVerticalEventPage` (non-cached)
 * can call notFound() with a proper HTTP 404 status.
 *
 * Mirrors the Phase A v2 P0 fix pattern in event/[slug]/page.tsx
 * (commit 9c250959): in Next.js 16 Cache Components the HTTP 200 status is
 * committed before the cached component's rendering completes, so a
 * notFound() throw inside the cache boundary cannot retroactively change
 * the status to 404 — producing a hydration mismatch (React error #419).
 *
 * Branch order matters:
 *   1. Kuest path (existing behavior — unchanged scope).
 *   2. Phase B v2 discovery branch — gated by isGamesDiscoveryEnabledForSlug
 *      (kill switch is `POLYMARKET_GAMES_DISCOVERY_ENABLED`).
 *   3. Otherwise return null → outer caller invokes notFound().
 */
async function fetchSportsCachedData(
  locale: SupportedLocale,
  sport: string,
  league: string | undefined,
  event: string,
  vertical: SportsVertical,
): Promise<SportsCachedData | null> {
  'use cache'

  // Kuest path: try to resolve canonical slug; if found, use existing flow.
  const canonicalEventSlug = await resolveCanonicalEventSlugFromSportsPath(sport, event, league)
  if (canonicalEventSlug) {
    cacheTag(cacheTags.event(canonicalEventSlug))

    const eventRoute = await getEventRouteBySlug(canonicalEventSlug)
    if (!eventRoute) {
      return null
    }

    const expectedPath = resolveEventPagePath(eventRoute)
    const hasEventBasePath = resolveEventBasePath(eventRoute) !== null

    const [{ data: groupedEvents }, { data: canonicalSportSlug }] = await Promise.all([
      EventRepository.getSportsEventGroupBySlug(canonicalEventSlug, '', locale),
      SportsMenuRepository.resolveCanonicalSlugByAlias(sport),
    ])

    const cardGroups = buildSportsGamesCardGroups(groupedEvents ?? [])
    const targetGroup = cardGroups[0] ?? null
    const targetCard = targetGroup?.primaryCard ?? null
    if (!targetGroup || !targetCard) {
      return null
    }

    const allMarkets = mergeSportsGamesCardMarkets(targetGroup.marketViewCards.map(view => view.card))
    const resolvedSportSlug = canonicalSportSlug
      || targetCard.event.sports_sport_slug
      || sport
    const [{ data: layoutData }, runtimeTheme, marketContextSettings] = await Promise.all([
      SportsMenuRepository.getLayoutData(vertical),
      loadRuntimeThemeState(),
      loadMarketContextSettings(),
    ])
    const sportLabel = layoutData?.h1TitleBySlug[resolvedSportSlug] ?? resolvedSportSlug.toUpperCase()
    const marketContextEnabled = marketContextSettings.enabled && Boolean(marketContextSettings.apiKey)

    return {
      kind: 'kuest',
      canonicalEventSlug,
      expectedPath,
      hasEventBasePath,
      targetCard,
      marketViewCards: targetGroup.marketViewCards,
      allMarkets,
      resolvedSportSlug,
      sportLabel,
      marketContextEnabled,
      runtimeTheme,
    } satisfies KuestSportsCachedData
  }

  // Phase B v2 discovery branch: gated by isGamesDiscoveryEnabledForSlug.
  // Note: `loadDiscoveredGameSportsCard` is itself wrapped in `'use cache'`
  // and tags both `cacheTags.discoveredGame(slug)` and
  // `cacheTags.teamsCache(league)` internally — see synthesize-sports-card.ts.
  if (isGamesDiscoveryEnabledForSlug(event)) {
    cacheTag(cacheTags.discoveredGame(event))

    const card = await loadDiscoveredGameSportsCard(event)
    if (!card) {
      return null
    }

    const resolvedSportSlug = card.event.sports_sport_slug?.trim() || sport
    const [{ data: layoutData }, runtimeTheme, marketContextSettings] = await Promise.all([
      SportsMenuRepository.getLayoutData(vertical),
      loadRuntimeThemeState(),
      loadMarketContextSettings(),
    ])
    const sportLabel = layoutData?.h1TitleBySlug[resolvedSportSlug] ?? resolvedSportSlug.toUpperCase()
    const marketContextEnabled = marketContextSettings.enabled && Boolean(marketContextSettings.apiKey)

    return {
      kind: 'discovery-game',
      card,
      resolvedSportSlug,
      sportLabel,
      marketContextEnabled,
      runtimeTheme,
    } satisfies DiscoveryGameSportsCachedData
  }

  return null
}

/**
 * Shell shape used by `generateSportsVerticalEventMetadata`. Returns null for
 * missing data so the outer (non-cached) metadata function can call notFound()
 * outside the cache boundary.
 */
interface SportsMetadataShellData {
  kind: 'kuest'
  canonicalEventSlug: string
}

interface DiscoveryGameMetadataShellData {
  kind: 'discovery-game'
  title: string
  site: ThemeSiteIdentity
}

type SportsMetadataData = SportsMetadataShellData | DiscoveryGameMetadataShellData

/**
 * `'use cache'` shell loader for `generateSportsVerticalEventMetadata`.
 * Returns null when neither the Kuest path nor the Phase B v2 discovery path
 * can satisfy the request. The OUTER `generateSportsVerticalEventMetadata`
 * calls notFound() based on the null check.
 *
 * Mirrors the Phase A v2 metadata fix in event/[slug]/page.tsx where
 * `loadDiscoveredEventShellData` returns the row-or-null sentinel and the
 * outer `generateMetadata` calls notFound() if null.
 */
async function loadSportsShellData(
  sport: string,
  league: string | undefined,
  event: string,
): Promise<SportsMetadataData | null> {
  'use cache'

  // Kuest path
  const canonicalEventSlug = await resolveCanonicalEventSlugFromSportsPath(sport, event, league)
  if (canonicalEventSlug) {
    cacheTag(cacheTags.event(canonicalEventSlug))
    return {
      kind: 'kuest',
      canonicalEventSlug,
    }
  }

  // Phase B v2 discovery branch
  if (isGamesDiscoveryEnabledForSlug(event)) {
    cacheTag(cacheTags.discoveredGame(event))
    const { row, site } = await loadDiscoveredGameShellData(event)
    if (!row || row.isArchived) {
      return null
    }
    return {
      kind: 'discovery-game',
      title: row.title,
      site,
    }
  }

  return null
}

function buildDiscoveryGameMetadata(
  rawTitle: string,
  slug: string,
  locale: SupportedLocale,
  siteName: string,
): Metadata {
  const title = rawTitle.trim()
  const description = `Live odds, market activity, and trading data for ${title} on ${siteName}.`
  const pageUrl = buildEventPageUrl({ eventSlug: slug, locale, route: null })
  const imageUrl = buildEventOgImageUrl({
    eventSlug: slug,
    locale,
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  })
  const socialImage = {
    url: imageUrl,
    width: 1200,
    height: 630,
    alt: `${title} on ${siteName}`,
    type: 'image/png',
  } as const
  return {
    title,
    description,
    openGraph: {
      type: 'website',
      url: pageUrl,
      title,
      description,
      siteName,
      images: [socialImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [socialImage],
    },
  }
}

/**
 * OUTER (non-cached) metadata function. Calls notFound() OUTSIDE the cache
 * boundary based on the null-sentinel returned by `loadSportsShellData`.
 *
 * STATIC_PARAMS_PLACEHOLDER short-circuit also lives here so it never enters
 * the cache layer.
 */
export async function generateSportsVerticalEventMetadata({
  locale,
  sport,
  league,
  event,
}: SportsVerticalEventPageParams): Promise<Metadata> {
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale

  if (!hasValidSportsEventPageParams({ sport, league, event })) {
    notFound()
  }

  const shell = await loadSportsShellData(sport, league, event)
  if (!shell) {
    notFound()
  }

  if (shell.kind === 'discovery-game') {
    return buildDiscoveryGameMetadata(shell.title, event, resolvedLocale, shell.site.name)
  }

  return await buildEventPageMetadata({
    eventSlug: shell.canonicalEventSlug,
    locale: resolvedLocale,
  })
}

/**
 * OUTER (non-cached) page renderer. Pulls cached data via
 * `fetchSportsCachedData` (returns null sentinel for missing data); calls
 * notFound() OUTSIDE the cache boundary so HTTP 404 is committed properly.
 *
 * Phase A v2 P0 fix pattern — mirrors the structure in
 * `app/[locale]/(platform)/event/[slug]/page.tsx`.
 *
 * Adjustment 7 (plan §B): the Phase B v2 discovery branch passes
 * `marketViewCards={[]}` and `relatedCards={[]}` explicitly to
 * `<SportsEventCenter>` — these are NOT fields on the card itself, they are
 * dispatcher-boundary props.
 */
export async function renderSportsVerticalEventPage({
  locale,
  sport,
  league,
  event,
  vertical,
}: RenderSportsVerticalEventPageParams) {
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale

  if (!hasValidSportsEventPageParams({ sport, league, event })) {
    notFound()
  }

  const cached = await fetchSportsCachedData(resolvedLocale, sport, league, event, vertical)
  if (!cached) {
    notFound()
  }

  // Kuest path: existing rendering, unchanged in scope. The redirect is
  // outside the cache boundary so it can change response status correctly.
  if (cached.kind === 'kuest') {
    const verticalConfig = getSportsVerticalConfig(vertical)
    const currentPath = league?.trim()
      ? `${verticalConfig.basePath}/${sport}/${league}/${event}`
      : `${verticalConfig.basePath}/${sport}/${event}`

    // Mirror original `if (!resolveEventBasePath(eventRoute) || expectedPath !== currentPath)`:
    // redirect when the event isn't actually a sports event (no base path) OR
    // when the canonical path disagrees with the current URL.
    if (!cached.hasEventBasePath || cached.expectedPath !== currentPath) {
      redirect({
        href: cached.expectedPath,
        locale: resolvedLocale,
      })
    }

    return (
      <>
        <EventStructuredData
          event={cached.targetCard.event}
          locale={resolvedLocale}
          pagePath={resolveEventPagePath(cached.targetCard.event)}
          site={cached.runtimeTheme.site}
        />
        <EventMarketChannelProvider markets={cached.allMarkets}>
          <SportsEventCenter
            card={cached.targetCard}
            marketViewCards={cached.marketViewCards}
            sportSlug={cached.resolvedSportSlug}
            sportLabel={cached.sportLabel}
            initialMarketViewKey={resolveSportsEventMarketViewKey(cached.canonicalEventSlug)}
            marketContextEnabled={cached.marketContextEnabled}
            vertical={vertical}
            key={`is-bookmarked-${cached.targetCard.event.is_bookmarked}`}
          />
        </EventMarketChannelProvider>
      </>
    )
  }

  // Phase B v2 discovery branch — synthetic SportsGamesCard projected from
  // the per-game sidecar. Adjustment 7: pass `marketViewCards={[]}` and
  // `relatedCards={[]}` explicitly. These are dispatcher-boundary props (not
  // SportsGamesCard fields) so the sports template gracefully renders without
  // tabbed market views or a related-games sidebar in the MVP scope.
  return (
    <>
      <EventStructuredData
        event={cached.card.event}
        locale={resolvedLocale}
        pagePath={resolveEventPagePath(cached.card.event)}
        site={cached.runtimeTheme.site}
      />
      <EventMarketChannelProvider markets={cached.card.detailMarkets}>
        <SportsEventCenter
          card={cached.card}
          marketViewCards={[]}
          relatedCards={[]}
          sportSlug={cached.resolvedSportSlug}
          sportLabel={cached.sportLabel}
          initialMarketViewKey={resolveSportsEventMarketViewKey(event)}
          marketContextEnabled={cached.marketContextEnabled}
          vertical={vertical}
          key={`is-bookmarked-${cached.card.event.is_bookmarked}`}
        />
      </EventMarketChannelProvider>
    </>
  )
}

/**
 * Cached data fetcher for `renderSportsVerticalEventMarketPage`. Returns null
 * sentinel for missing data — outer caller invokes notFound().
 *
 * Phase B v2 scope: market sub-route is Kuest-only (no discovery branch
 * because per-game discovery slugs render through the bare event URL, no
 * market sub-route is exposed).
 */
interface KuestSportsMarketCachedData {
  canonicalEventSlug: string
  expectedPath: string
  hasEventBasePath: boolean
  targetCard: ReturnType<typeof buildSportsGamesCards>[number]
  marketViewCards: SportsGamesCardMarketView[]
  allMarkets: ReturnType<typeof mergeSportsGamesCardMarkets>
  relatedCards: ReturnType<typeof buildSportsGamesCards>
  resolvedSportSlug: string
  sportLabel: string
  marketContextEnabled: boolean
  runtimeTheme: Awaited<ReturnType<typeof loadRuntimeThemeState>>
}

async function fetchSportsMarketCachedData(
  locale: SupportedLocale,
  sport: string,
  league: string | undefined,
  event: string,
  market: string,
  vertical: SportsVertical,
): Promise<KuestSportsMarketCachedData | null> {
  'use cache'

  const canonicalEventSlug = await resolveCanonicalEventSlugFromSportsPath(sport, event, league)
  if (!canonicalEventSlug) {
    return null
  }

  cacheTag(cacheTags.event(canonicalEventSlug))

  const eventRoute = await getEventRouteBySlug(canonicalEventSlug)
  if (!eventRoute) {
    return null
  }

  const expectedPath = resolveEventMarketPath(eventRoute, market)
  const hasEventBasePath = resolveEventBasePath(eventRoute) !== null

  const [{ data: groupedEvents }, { data: canonicalSportSlug }] = await Promise.all([
    EventRepository.getSportsEventGroupBySlug(canonicalEventSlug, '', locale),
    SportsMenuRepository.resolveCanonicalSlugByAlias(sport),
  ])
  const cardGroups = buildSportsGamesCardGroups(groupedEvents ?? [])
  const targetGroup = cardGroups[0] ?? null
  const targetCard = targetGroup?.primaryCard ?? null
  if (!targetGroup || !targetCard) {
    return null
  }
  const allMarkets = mergeSportsGamesCardMarkets(targetGroup.marketViewCards.map(view => view.card))

  const resolvedSportSlug = canonicalSportSlug
    || targetCard.event.sports_sport_slug
    || sport
  const [{ data: layoutData }, { data: relatedEventsResult }, runtimeTheme, marketContextSettings] = await Promise.all([
    SportsMenuRepository.getLayoutData(vertical),
    EventRepository.listEvents({
      tag: vertical,
      sportsVertical: vertical,
      search: '',
      userId: '',
      bookmarked: false,
      status: 'active',
      locale,
      sportsSportSlug: resolvedSportSlug,
      sportsSection: 'games',
    }),
    loadRuntimeThemeState(),
    loadMarketContextSettings(),
  ])

  const relatedCards = buildSportsGamesCards(relatedEventsResult ?? [])
    .filter(relatedCard => !isSameSportsGame(relatedCard, targetCard))
    .filter(relatedCard => relatedCard.event.sports_ended !== true)
    .filter(relatedCard => relatedCard.event.status === 'active')
    .filter((relatedCard) => {
      const relatedSportSlug = relatedCard.event.sports_sport_slug?.trim().toLowerCase()
      return !relatedSportSlug || relatedSportSlug === resolvedSportSlug.toLowerCase()
    })
    .slice(0, 3)

  const sportLabel = layoutData?.h1TitleBySlug[resolvedSportSlug] ?? resolvedSportSlug.toUpperCase()
  const marketContextEnabled = marketContextSettings.enabled && Boolean(marketContextSettings.apiKey)

  return {
    canonicalEventSlug,
    expectedPath,
    hasEventBasePath,
    targetCard,
    marketViewCards: targetGroup.marketViewCards,
    allMarkets,
    relatedCards,
    resolvedSportSlug,
    sportLabel,
    marketContextEnabled,
    runtimeTheme,
  }
}

export async function generateSportsVerticalEventMarketMetadata({
  locale,
  sport,
  league,
  event,
  market,
}: SportsVerticalEventMarketPageParams): Promise<Metadata> {
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale

  if (!hasValidSportsEventPageParams({ sport, league, event })) {
    notFound()
  }

  const shell = await loadSportsShellData(sport, league, event)
  if (!shell) {
    notFound()
  }

  // Market sub-route is Kuest-only — discovery games render at the bare
  // event URL with no market sub-segment.
  if (shell.kind !== 'kuest') {
    notFound()
  }

  return await buildEventPageMetadata({
    eventSlug: shell.canonicalEventSlug,
    locale: resolvedLocale,
    marketSlug: market,
  })
}

export async function renderSportsVerticalEventMarketPage({
  locale,
  sport,
  league,
  event,
  market,
  vertical,
}: RenderSportsVerticalEventMarketPageParams) {
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale

  if (!hasValidSportsEventPageParams({ sport, league, event })) {
    notFound()
  }

  const cached = await fetchSportsMarketCachedData(resolvedLocale, sport, league, event, market, vertical)
  if (!cached) {
    notFound()
  }

  const verticalConfig = getSportsVerticalConfig(vertical)
  const currentPath = league?.trim()
    ? `${verticalConfig.basePath}/${sport}/${league}/${event}/${market}`
    : `${verticalConfig.basePath}/${sport}/${event}/${market}`

  if (!cached.hasEventBasePath || cached.expectedPath !== currentPath) {
    redirect({
      href: cached.expectedPath,
      locale: resolvedLocale,
    })
  }

  return (
    <>
      <EventStructuredData
        event={cached.targetCard.event}
        locale={resolvedLocale}
        pagePath={resolveEventMarketPath(cached.targetCard.event, market)}
        marketSlug={market}
        site={cached.runtimeTheme.site}
      />
      <EventMarketChannelProvider markets={cached.allMarkets}>
        <SportsEventCenter
          card={cached.targetCard}
          marketViewCards={cached.marketViewCards}
          relatedCards={cached.relatedCards}
          sportSlug={cached.resolvedSportSlug}
          sportLabel={cached.sportLabel}
          initialMarketSlug={market}
          initialMarketViewKey={resolveSportsEventMarketViewKey(cached.canonicalEventSlug)}
          marketContextEnabled={cached.marketContextEnabled}
          vertical={vertical}
          key={`is-bookmarked-${cached.targetCard.event.is_bookmarked}`}
        />
      </EventMarketChannelProvider>
    </>
  )
}
