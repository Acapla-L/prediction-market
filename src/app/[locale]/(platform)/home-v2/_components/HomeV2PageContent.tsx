'use cache'

import type { HomeV2SectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { CategorySection } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import type { LeagueSection } from '@/app/[locale]/(platform)/home-v2/_data/fetchLeagueEvents'
import type { SupportedLocale } from '@/i18n/locales'
import { getExtracted, setRequestLocale } from 'next-intl/server'
import { cacheTag } from 'next/cache'
import HomeV2CategorySection from '@/app/[locale]/(platform)/home-v2/_components/HomeV2CategorySection'
import HomeV2Hero from '@/app/[locale]/(platform)/home-v2/_components/HomeV2Hero'
import HomeV2InfoStrip from '@/app/[locale]/(platform)/home-v2/_components/HomeV2InfoStrip'
import HomeV2Sidebar from '@/app/[locale]/(platform)/home-v2/_components/HomeV2Sidebar'
import HomeV2SidebarLists from '@/app/[locale]/(platform)/home-v2/_components/HomeV2SidebarLists'
import SidebarMarketplaceCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarMarketplaceCard'
import { HOME_V2_CATEGORIES } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import { fetchTagCategoryEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import { fetchFeaturedFuturesData } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'
import { fetchLeagueEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchLeagueEvents'
import { fetchSidebarData } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'
import { cacheTags } from '@/lib/cache-tags'

interface HomeV2PageContentProps {
  locale: SupportedLocale
}

type ResolvedSection = CategorySection | LeagueSection

function getServerCurrentTimestamp() {
  return Date.now()
}

async function resolveSection(
  config: HomeV2SectionConfig,
  locale: SupportedLocale,
): Promise<ResolvedSection> {
  if (config.kind === 'tag') {
    return fetchTagCategoryEvents(config, locale)
  }
  return fetchLeagueEvents(config, locale)
}

export default async function HomeV2PageContent({ locale }: HomeV2PageContentProps) {
  // setRequestLocale must be called inside the 'use cache' scope (not just at
  // the page-wrapper level) so that getExtracted() reads the primed locale
  // instead of falling back to headers() — which is forbidden inside cache.
  // Page wrappers also call setRequestLocale for next-intl's static-rendering
  // contract; calling it twice with the same value is a no-op.
  setRequestLocale(locale)
  cacheTag(cacheTags.eventsList)

  const t = await getExtracted()

  // Cold-render fan-out control (Fix A2 2026-05-11, revised Fix F-3 2026-05-12):
  //   - Phase 1: featured-futures + sidebar in parallel — both lightweight
  //     (futures = 1 DB + ~12 Polymarket HTTP, sidebar = 2 sequential DB
  //     queries; peak ~2 simultaneous Supavisor checkouts).
  //   - Phase 2: sport sections in BOUNDED CHUNKS of `SECTION_CONCURRENCY`
  //     (was a fully-serial `for...of`; before that, an unbounded top-level
  //     `Promise.all` of N sections). Each section issues 2 DB queries (A1's
  //     batched team-cache lookup), so a chunk of 3 = ≤6 simultaneous pooler
  //     checkouts — under the postgres.js pool `max` (10). Bounded so it can't
  //     re-create the pre-A1 fan-out (7 league sections × inner `Promise.all`
  //     of 8 per-row team lookups = ~58 simultaneous checkouts → the 2026-05-11
  //     EMAXCONN cascade); chunked rather than fully serial so a cold render
  //     completes ~3× faster and holds pool slots for a correspondingly
  //     shorter window (a fully-serial render was a long-duration slot drip
  //     that overlapped with whatever else was contending).
  const SECTION_CONCURRENCY = 3
  const [featuredFutures, sidebarData] = await Promise.all([
    fetchFeaturedFuturesData(locale),
    fetchSidebarData(locale),
  ])
  const sections: ResolvedSection[] = []
  for (let i = 0; i < HOME_V2_CATEGORIES.length; i += SECTION_CONCURRENCY) {
    const chunk = HOME_V2_CATEGORIES.slice(i, i + SECTION_CONCURRENCY)
    const resolved = await Promise.all(chunk.map(c => resolveSection(c, locale)))
    sections.push(...resolved)
  }

  const currentTimestamp = getServerCurrentTimestamp()

  // Title lookup keyed by `titleKey` from each section config. The Kuest
  // `getExtracted` returns the source string when no extracted match exists,
  // so adding a key here without a matching i18n entry still renders the
  // English label safely.
  const sectionTitleMap: Record<string, string> = {
    Sports: t('Sports'),
    Baseball: t('Baseball'),
    Basketball: t('Basketball'),
    Hockey: t('Hockey'),
    Soccer: t('Soccer'),
  }

  return (
    <main className="container py-4 lg:py-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
          <HomeV2Hero
            events={featuredFutures.events}
            chartDataByEvent={featuredFutures.chartDataByEvent}
          />

          {/* Marketplace card appears under the hero on mobile; on desktop it lives in the sidebar. */}
          <div className="lg:hidden">
            <SidebarMarketplaceCard />
          </div>

          <HomeV2InfoStrip />

          {/* Mobile-only inline sidebar lists. On desktop the full sidebar
              (including the Marketplace card) renders in the right rail
              below; this block is hidden at lg+ to avoid duplication. */}
          <div className="lg:hidden">
            <HomeV2SidebarLists data={sidebarData} />
          </div>

          <div className="flex flex-col gap-8 lg:gap-10">
            {sections.map(section => (
              <HomeV2CategorySection
                key={section.config.id}
                id={section.config.id}
                events={section.events}
                href={section.config.href}
                currentTimestamp={currentTimestamp}
                title={sectionTitleMap[section.config.titleKey] ?? section.config.titleKey}
                viewAllLabel={t('View all')}
              />
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN — desktop only. The mobile equivalents render
            inline above (lists) and under the hero (Marketplace card). */}
        <div className="hidden lg:block">
          <HomeV2Sidebar data={sidebarData} />
        </div>
      </div>
    </main>
  )
}
