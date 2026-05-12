import type { Metadata } from 'next'
import type { SupportedLocale } from '@/i18n/locales'
import { setRequestLocale } from 'next-intl/server'
import { connection } from 'next/server'
import SportsGamesCenter from '@/app/[locale]/(platform)/sports/_components/SportsGamesCenter'
import { buildSportsGamesCards } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'
import { EventRepository } from '@/lib/db/queries/event'
import { SportsMenuRepository } from '@/lib/db/queries/sports-menu'

export const metadata: Metadata = {
  title: 'Sports Upcoming',
}

export default async function SportsSoonPage({ params }: PageProps<'/[locale]/sports/soon'>) {
  // Render on-demand at request time — NOT statically prerendered at build
  // time. The "upcoming sports games" data here is `EventRepository.listEvents`
  // (the fat lateral-join event-list query); under Next.js's parallel 400+-page
  // static-gen pass that query frequently failed to fill within the build-time
  // prerender cache-fill timeout, producing repeated `USE_CACHE_TIMEOUT` build
  // failures on this page (2026-05-12, after the soccer re-ship enlarged the
  // page set). `connection()` opts the route out of static prerendering; the
  // page renders fresh per request (also semantically correct for "upcoming"
  // data — no stale cache window). Removed the module-level `'use cache'`
  // directive (incompatible with `connection()`); the per-request fetch is a
  // 2-query Promise.all, well within the post-pool-hardening `max: 5` budget.
  await connection()

  const { locale } = await params
  setRequestLocale(locale)
  const [{ data: events }, { data: layoutData }] = await Promise.all([
    EventRepository.listEvents({
      tag: 'sports',
      sportsVertical: 'sports',
      search: '',
      userId: '',
      bookmarked: false,
      status: 'active',
      locale: locale as SupportedLocale,
      sportsSection: 'games',
    }),
    SportsMenuRepository.getLayoutData('sports'),
  ])
  const cards = buildSportsGamesCards(events ?? [])

  return (
    <div key="sports-soon-page" className="contents">
      <SportsGamesCenter
        cards={cards}
        sportSlug="soon"
        sportTitle="Upcoming Sports Games"
        pageMode="soon"
        categoryTitleBySlug={layoutData?.h1TitleBySlug ?? {}}
        vertical="sports"
      />
    </div>
  )
}
