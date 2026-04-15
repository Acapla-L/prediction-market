import type { Event } from '@/types'
import { getExtracted } from 'next-intl/server'
import {
  SidebarEventListCard,
  SidebarStaticListCard,
} from '@/app/[locale]/(platform)/home-v2/_components/SidebarListCard'
import SidebarMarketplaceCard from '@/app/[locale]/(platform)/home-v2/_components/SidebarMarketplaceCard'

interface HomeV2SidebarProps {
  trending: Event[]
  fresh: Event[]
  highestVolume: Event[]
}

export default async function HomeV2Sidebar({ trending, fresh, highestVolume }: HomeV2SidebarProps) {
  const t = await getExtracted()

  // TODO: replace # placeholders once futures landing pages or series slugs are confirmed
  const futuresRows = [
    { label: t('NBA Championship'), href: '#' },
    { label: t('Premier League Winner'), href: '#' },
    { label: t('2026 NHL Stanley Cup Champion'), href: '#' },
  ]

  return (
    <aside className="flex flex-col gap-4">
      <SidebarMarketplaceCard />
      <SidebarEventListCard title={t('Trending')} events={trending} />
      <SidebarStaticListCard title={t('Futures')} rows={futuresRows} />
      <SidebarEventListCard title={t('New')} events={fresh} />
      <SidebarEventListCard title={t('Highest Volume')} events={highestVolume} />
    </aside>
  )
}
