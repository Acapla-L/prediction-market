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
import SidebarMarketplaceCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarMarketplaceCard'
import { HOME_V2_CATEGORIES } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import { fetchTagCategoryEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import { fetchFeaturedFuturesData } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'
import { fetchLeagueEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchLeagueEvents'
import { fetchSidebarData } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'
import { cacheTags } from '@/lib/cache-tags'

interface HomeV2PageProps {
  params: Promise<{ locale: string }>
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

export default async function HomeV2Page({ params }: HomeV2PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  cacheTag(cacheTags.eventsList)
  const resolvedLocale = locale as SupportedLocale

  const t = await getExtracted()
  const [featuredFutures, sidebarData, ...sections] = await Promise.all([
    fetchFeaturedFuturesData(resolvedLocale),
    fetchSidebarData(resolvedLocale),
    ...HOME_V2_CATEGORIES.map(c => resolveSection(c, resolvedLocale)),
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

        {/* RIGHT COLUMN */}
        <HomeV2Sidebar data={sidebarData} />
      </div>
    </main>
  )
}
