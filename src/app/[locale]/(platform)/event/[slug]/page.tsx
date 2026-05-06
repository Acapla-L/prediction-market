import type { Metadata } from 'next'
import type { SupportedLocale } from '@/i18n/locales'
import type { EventPageContentData } from '@/lib/event-page-data'
import { setRequestLocale } from 'next-intl/server'
import { cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import EventContent from '@/app/[locale]/(platform)/event/[slug]/_components/EventContent'
import EventStructuredData from '@/components/seo/EventStructuredData'
import { redirect } from '@/i18n/navigation'
import { cacheTags } from '@/lib/cache-tags'
import {
  buildEventOgImageUrl,
  buildEventPageMetadata,
  buildEventPageUrl,
} from '@/lib/event-open-graph'
import {
  getEventRouteBySlug,
  loadEventPagePublicContentData,
} from '@/lib/event-page-data'
import { resolveEventBasePath, resolveEventPagePath } from '@/lib/events-routing'
import {
  isDiscoveryEnabledForSlug,
  loadDiscoveredEventPageData,
  loadDiscoveredEventShellData,
} from '@/lib/polymarket/discovery'
import {
  isGamesDiscoveryEnabledForSlug,
  loadDiscoveredGamePageData,
  loadDiscoveredGameShellData,
} from '@/lib/polymarket/games-discovery'
import { STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

export async function generateStaticParams() {
  return [{ slug: STATIC_PARAMS_PLACEHOLDER }]
}

export async function generateMetadata({ params }: PageProps<'/[locale]/event/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    notFound()
  }

  // Discovery slugs are NOT in the Kuest events table. The Kuest path
  // (buildEventPageMetadata → loadEventPageShellData → getEventTitleBySlug)
  // returns null and calls notFound() inside generateMetadata, which Next.js
  // streams via RSC and injects NEXT_HTTP_ERROR_FALLBACK;404 — flipping the
  // correctly-rendered discovery page to the not-found boundary mid-render
  // (React error #419 hydration mismatch). Branch to a sidecar-backed shell
  // loader symmetric with loadEventPageShellData.
  if (isDiscoveryEnabledForSlug(slug)) {
    const { row, site } = await loadDiscoveredEventShellData(slug)
    if (!row) {
      notFound()
    }
    return buildDiscoveryMetadata(row.title, slug, resolvedLocale, site.name)
  }

  // Phase B per-game discovery — symmetric with the futures branch above.
  // Default-off in MVP via POLYMARKET_GAMES_DISCOVERY_ENABLED=false; isolated
  // from Phase A v2 path so a flag flip cannot regress futures behavior.
  if (isGamesDiscoveryEnabledForSlug(slug)) {
    const { row, site } = await loadDiscoveredGameShellData(slug)
    if (!row || row.isArchived) {
      notFound()
    }
    return buildDiscoveryMetadata(row.title, slug, resolvedLocale, site.name)
  }

  return await buildEventPageMetadata({
    eventSlug: slug,
    locale: resolvedLocale,
  })
}

function buildDiscoveryMetadata(
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

interface EventPageCachedData {
  eventPageData: EventPageContentData
  runtimeTheme: Awaited<ReturnType<typeof loadRuntimeThemeState>>
  locale: SupportedLocale
}

// 'use cache' data-fetcher — never calls notFound() so the HTTP response
// status is not committed inside the cache boundary. Returns null for any
// unknown/disabled slug so the outer EventPage component can call notFound()
// with a proper HTTP 404 status. (Calling notFound() inside 'use cache' in
// Next.js 16 Cache Components causes the response to be committed as 200
// before the not-found throw is processed, producing a hydration mismatch.)
async function fetchEventPageCachedData(
  locale: SupportedLocale,
  slug: string,
): Promise<EventPageCachedData | null> {
  'use cache'

  const eventRoute = await getEventRouteBySlug(slug)

  let eventPageData: EventPageContentData | null = null
  let runtimeTheme: Awaited<ReturnType<typeof loadRuntimeThemeState>>

  if (eventRoute) {
    const sportsPath = resolveEventBasePath(eventRoute)
    if (sportsPath) {
      redirect({
        href: sportsPath,
        locale,
      })
    }

    const [data, theme] = await Promise.all([
      loadEventPagePublicContentData(slug, locale),
      loadRuntimeThemeState(),
    ])
    eventPageData = data
    runtimeTheme = theme
  }
  else if (isDiscoveryEnabledForSlug(slug)) {
    // No row in the main events table — fall back to the Polymarket discovery
    // sidecar for allowlisted slugs. See Phase A v2 plan §A.4.
    cacheTag(cacheTags.discoveredEvent(slug))
    const [data, theme] = await Promise.all([
      loadDiscoveredEventPageData(slug),
      loadRuntimeThemeState(),
    ])
    eventPageData = data
    runtimeTheme = theme
  }
  else if (isGamesDiscoveryEnabledForSlug(slug)) {
    // Phase B per-game discovery sidecar. Default-off via env var; symmetric
    // with the Phase A v2 branch above. Order matters: Kuest events check
    // runs first so any future Kuest-synced per-game event takes precedence
    // (defensive).
    cacheTag(cacheTags.discoveredGame(slug))
    const [data, theme] = await Promise.all([
      loadDiscoveredGamePageData(slug),
      loadRuntimeThemeState(),
    ])
    eventPageData = data
    runtimeTheme = theme
  }
  else {
    return null
  }

  if (!eventPageData) {
    return null
  }

  return { eventPageData, runtimeTheme: runtimeTheme!, locale }
}

export default async function EventPage({ params }: PageProps<'/[locale]/event/[slug]'>) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    notFound()
  }

  const cached = await fetchEventPageCachedData(resolvedLocale, slug)
  if (!cached) {
    notFound()
  }

  const { eventPageData, runtimeTheme } = cached

  return (
    <>
      <EventStructuredData
        event={eventPageData.event}
        locale={resolvedLocale}
        pagePath={resolveEventPagePath(eventPageData.event)}
        site={runtimeTheme.site}
      />
      <EventContent
        event={eventPageData.event}
        changeLogEntries={eventPageData.changeLogEntries}
        user={null}
        marketContextEnabled={eventPageData.marketContextEnabled}
        seriesEvents={eventPageData.seriesEvents}
        liveChartConfig={eventPageData.liveChartConfig}
        key={`is-bookmarked-${eventPageData.event.is_bookmarked}`}
      />
    </>
  )
}
