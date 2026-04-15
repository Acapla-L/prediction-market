'use cache'

import type { SupportedLocale } from '@/i18n/locales'
import { getExtracted, setRequestLocale } from 'next-intl/server'
import { cacheTag } from 'next/cache'
import HomeV2CategorySection from '@/app/[locale]/(platform)/home-v2/_components/HomeV2CategorySection'
import HomeV2Hero from '@/app/[locale]/(platform)/home-v2/_components/HomeV2Hero'
import HomeV2InfoStrip from '@/app/[locale]/(platform)/home-v2/_components/HomeV2InfoStrip'
import HomeV2Sidebar from '@/app/[locale]/(platform)/home-v2/_components/HomeV2Sidebar'
import { HOME_V2_CATEGORIES } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import { FEATURED_EVENT_SLUGS } from '@/app/[locale]/(platform)/home-v2/_config/featured'
import { fetchCategoryEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import { fetchFeaturedEvents } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedEvents'
import { fetchSidebarLists } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarLists'
import { cacheTags } from '@/lib/cache-tags'

interface HomeV2PageProps {
  params: Promise<{ locale: string }>
}

function getServerCurrentTimestamp() {
  return Date.now()
}

export default async function HomeV2Page({ params }: HomeV2PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  cacheTag(cacheTags.eventsList)
  const resolvedLocale = locale as SupportedLocale

  const t = await getExtracted()
  const [featuredEvents, sidebarLists, categorySections] = await Promise.all([
    fetchFeaturedEvents(FEATURED_EVENT_SLUGS, resolvedLocale),
    fetchSidebarLists(resolvedLocale),
    fetchCategoryEvents(HOME_V2_CATEGORIES, resolvedLocale),
  ])

  const currentTimestamp = getServerCurrentTimestamp()

  const categoryTitleMap: Record<string, string> = {
    'Sports': t('Sports'),
    'Finance & Economy': t('Finance & Economy'),
    'Politics & World': t('Politics & World'),
    'Tech & Science': t('Tech & Science'),
  }

  return (
    <main className="container py-4 lg:py-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
          <HomeV2Hero events={featuredEvents} />

          <HomeV2InfoStrip />

          <div className="flex flex-col gap-8 lg:gap-10">
            {categorySections.map(section => (
              <HomeV2CategorySection
                key={section.config.id}
                section={section}
                currentTimestamp={currentTimestamp}
                title={categoryTitleMap[section.config.titleKey] ?? section.config.titleKey}
                viewAllLabel={t('View all')}
              />
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <HomeV2Sidebar
          trending={sidebarLists.trending}
          fresh={sidebarLists.fresh}
        />
      </div>
    </main>
  )
}
