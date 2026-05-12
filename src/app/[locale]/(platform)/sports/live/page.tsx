import type { Metadata } from 'next'
import type { SupportedLocale } from '@/i18n/locales'
import { getExtracted, setRequestLocale } from 'next-intl/server'
import { Suspense } from 'react'
import SportsGamesCenter from '@/app/[locale]/(platform)/sports/_components/SportsGamesCenter'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

export async function generateMetadata({ params }: PageProps<'/[locale]/sports/live'>): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getExtracted()

  const runtimeTheme = await loadRuntimeThemeState()
  const siteName = runtimeTheme.site.name

  return {
    title: t('Sports Live Prediction Markets & Live Odds'),
    description: t(`Trade on live sports in real time on {siteName}. Trade on NBA, NHL, UFC, MLB, soccer, and 20+ sports with moneyline, spread, and total markets. Real-time odds and scores.`, { siteName }),
  }
}

// Uncached data-fetching child rendered INSIDE a <Suspense> boundary (see
// SportsLivePage). This is the Next.js 16 Cache Components pattern for a route
// that does uncached data access: the static shell (layout + page chrome + the
// Suspense fallback) is prerenderable, and this async child — the slow
// `EventRepository.listEvents` fat-lateral-join — is deferred/streamed at
// request time instead of being prerendered at build time. That removes the
// build-time `USE_CACHE_TIMEOUT` failure mode this page hit (2026-05-12) AND
// the "Uncached data accessed outside of <Suspense>" error — and it's the
// right behaviour for "live sports games" data (always fresh, no stale cache
// window). NOT wrapped in `'use cache'`.
async function SportsLiveContent({ locale }: { locale: SupportedLocale }) {
  setRequestLocale(locale)
  const [{ data: events }, { data: layoutData }] = await Promise.all([
    EventRepository.listEvents({
      tag: 'sports',
      sportsVertical: 'sports',
      search: '',
      userId: '',
      bookmarked: false,
      status: 'active',
      locale,
      sportsSection: 'games',
    }),
    SportsMenuRepository.getLayoutData('sports'),
  ])
  const cards = buildSportsGamesCards(events ?? [])

  return (
    <SportsGamesCenter
      cards={cards}
      sportSlug="live"
      sportTitle="Live"
      pageMode="liveAndSoon"
      categoryTitleBySlug={layoutData?.h1TitleBySlug ?? {}}
      vertical="sports"
    />
  )
}

export default async function SportsLivePage({ params }: PageProps<'/[locale]/sports/live'>) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div key="sports-live-page" className="contents">
      <Suspense
        fallback={(
          <SportsGamesCenter
            cards={[]}
            sportSlug="live"
            sportTitle="Live"
            pageMode="liveAndSoon"
            categoryTitleBySlug={{}}
            vertical="sports"
          />
        )}
      >
        <SportsLiveContent locale={locale as SupportedLocale} />
      </Suspense>
    </div>
  )
}
