import type { SidebarData } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'
import { getExtracted } from 'next-intl/server'
import SidebarGameListCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarGameListCard'
import { SidebarStaticListCard } from '@/app/[locale]/(platform)/home-v2/_components/SidebarListCard'
import SidebarMarketplaceCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarMarketplaceCard'

interface HomeV2SidebarProps {
  data: SidebarData
}

export default async function HomeV2Sidebar({ data }: HomeV2SidebarProps) {
  const t = await getExtracted()

  const futuresRows = [
    ...data.futures.map(future => ({ label: future.title, href: future.href })),
    { label: t('See all'), href: data.futuresShowAllHref },
  ]

  return (
    <aside className="flex flex-col gap-3 lg:gap-4">
      {/* Marketplace card lives here on desktop; on mobile it's rendered under the hero in page.tsx. */}
      <div className="hidden lg:block">
        <SidebarMarketplaceCard />
      </div>
      <SidebarGameListCard title={t('Trending')} games={data.trendingGames} />
      <SidebarStaticListCard title={t('Sports Futures')} rows={futuresRows} />
      <SidebarGameListCard title={t('New Markets')} games={data.newGames} />
    </aside>
  )
}
