import type { Metadata } from 'next'
import type { SupportedLocale } from '@/i18n/locales'
import { setRequestLocale } from 'next-intl/server'
import { Suspense } from 'react'
import SportsGamesCenter from '@/app/[locale]/(platform)/sports/_components/SportsGamesCenter'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'

export const metadata: Metadata = {
  title: 'Sports Upcoming',
}

// Uncached data-fetching child rendered INSIDE a <Suspense> boundary (see
// SportsSoonPage). This is the Next.js 16 Cache Components pattern for a route
// that does uncached data access: the static shell (layout + page chrome + the
// Suspense fallback) is prerenderable, and this async child — the slow
// `EventRepository.listEvents` fat-lateral-join — is deferred/streamed at
// request time instead of being prerendered at build time. That removes the
// build-time `USE_CACHE_TIMEOUT` failure mode this page hit (2026-05-12) AND
// the "Uncached data accessed outside of <Suspense>" error — and it's the
// right behaviour for "upcoming sports games" data (always fresh, no stale
// cache window). NOT wrapped in `'use cache'`.
async function SportsSoonContent({ locale }: { locale: SupportedLocale }) {
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
      sportSlug="soon"
      sportTitle="Upcoming Sports Games"
      pageMode="soon"
      categoryTitleBySlug={layoutData?.h1TitleBySlug ?? {}}
      vertical="sports"
    />
  )
}

export default async function SportsSoonPage({ params }: PageProps<'/[locale]/sports/soon'>) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div key="sports-soon-page" className="contents">
      <Suspense
        fallback={(
          <SportsGamesCenter
            cards={[]}
            sportSlug="soon"
            sportTitle="Upcoming Sports Games"
            pageMode="soon"
            categoryTitleBySlug={{}}
            vertical="sports"
          />
        )}
      >
        <SportsSoonContent locale={locale as SupportedLocale} />
      </Suspense>
    </div>
  )
}
