import type { SidebarData } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'
import { getExtracted } from 'next-intl/server'
import SidebarGameListCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarGameListCard'
import { SidebarStaticListCard } from '@/app/[locale]/(platform)/home-v2/_components/SidebarListCard'

interface HomeV2SidebarListsProps {
  data: SidebarData
}

/**
 * Renders the three sidebar event-list cards (Trending, Sports Futures,
 * New Markets) without the Marketplace card. Used inline on mobile between
 * the Info Strip and the first category section, while the full
 * `HomeV2Sidebar` (with Marketplace card) renders in the desktop right rail.
 */
export default async function HomeV2SidebarLists({ data }: HomeV2SidebarListsProps) {
  const t = await getExtracted()

  const futuresRows = [
    ...data.futures.map(future => ({ label: future.title, href: future.href })),
    { label: t('See all'), href: data.futuresShowAllHref },
  ]

  return (
    <div className="flex flex-col gap-3">
      <SidebarGameListCard title={t('Trending')} games={data.trendingGames} />
      <SidebarStaticListCard title={t('Sports Futures')} rows={futuresRows} />
      <SidebarGameListCard title={t('New Markets')} games={data.newGames} />
    </div>
  )
}
