'use cache'

import type { Metadata } from 'next'
import type { SupportedLocale } from '@/i18n/locales'
import type { EventPageContentData } from '@/lib/event-page-data'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import EventContent from '@/app/[locale]/(platform)/event/[slug]/_components/EventContent'
import EventStructuredData from '@/components/seo/EventStructuredData'
import { redirect } from '@/i18n/navigation'
import { buildEventPageMetadata } from '@/lib/event-open-graph'
import {

  getEventRouteBySlug,
  loadEventPagePublicContentData,
} from '@/lib/event-page-data'
import { resolveEventBasePath, resolveEventPagePath } from '@/lib/events-routing'
import {
  isDiscoveryEnabledForSlug,
  loadDiscoveredEventPageData,
} from '@/lib/polymarket/discovery'
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
  return await buildEventPageMetadata({
    eventSlug: slug,
    locale: resolvedLocale,
  })
}

async function CachedEventPageContent({
  locale,
  slug,
}: {
  locale: SupportedLocale
  slug: string
}) {
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
    const [data, theme] = await Promise.all([
      loadDiscoveredEventPageData(slug),
      loadRuntimeThemeState(),
    ])
    eventPageData = data
    runtimeTheme = theme
  }
  else {
    notFound()
  }

  if (!eventPageData) {
    notFound()
  }

  return (
    <>
      <EventStructuredData
        event={eventPageData.event}
        locale={locale}
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

export default async function EventPage({ params }: PageProps<'/[locale]/event/[slug]'>) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const resolvedLocale = locale as SupportedLocale
  if (slug === STATIC_PARAMS_PLACEHOLDER) {
    notFound()
  }

  return <CachedEventPageContent locale={resolvedLocale} slug={slug} />
}
