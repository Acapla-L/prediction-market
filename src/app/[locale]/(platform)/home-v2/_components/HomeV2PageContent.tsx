'use cache'

import type { HomeV2SectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { CategorySection } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import type { LeagueSection } from '@/app/[locale]/(platform)/home-v2/_data/fetchLeagueEvents'
import type { SupportedLocale } from '@/i18n/locales'
import { getExtracted } from 'next-intl/server'
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
  cacheTag(cacheTags.eventsList)

  const t = await getExtracted()
  const [featuredFutures, sidebarData, ...sections] = await Promise.all([
    fetchFeaturedFuturesData(locale),
    fetchSidebarData(locale),
    ...HOME_V2_CATEGORIES.map(c => resolveSection(c, locale)),
  ])

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
