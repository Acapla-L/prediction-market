'use client'

import type { Event } from '@/types'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import EventMarketChannelProvider from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider'
import HomeV2HeroChartSkeleton from '@/app/[locale]/(platform)/home-v2/_components/HomeV2HeroChartSkeleton'
import AppLink from '@/components/AppLink'
import { Badge } from '@/components/ui/badge'
import { useIsMobile } from '@/hooks/useIsMobile'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveEventPagePath } from '@/lib/events-routing'
import { formatVolume } from '@/lib/formatters'
import { buildChanceByMarket } from '@/lib/market-chance'

// Reuse the same chart component that works on event detail pages. Dynamic
// import keeps the heavy Visx bundle out of first paint.
const EventChart = dynamic(
  () => import('@/app/[locale]/(platform)/event/[slug]/_components/EventChart'),
  { ssr: false, loading: () => <HomeV2HeroChartSkeleton /> },
)

interface HomeV2HeroSlideProps {
  event: Event
  isActive: boolean
}

function pickOutcomeProbability(event: Event, outcomeIndex: 0 | 1): number {
  const chanceByMarket = buildChanceByMarket(event.markets, {})
  const primary = event.markets[0]
  if (!primary) {
    return 0
  }
  const yesChance = chanceByMarket[primary.condition_id] ?? 0
  if (outcomeIndex === OUTCOME_INDEX.YES) {
    return Math.round(yesChance)
  }
  return Math.round(100 - yesChance)
}

function resolveCategoryLabel(event: Event): string {
  const mainCategory = event.tags?.find(tag => tag.isMainCategory)
  return (mainCategory?.name || event.main_tag || event.tags?.[0]?.name || 'Featured').toUpperCase()
}

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') {
      return
    }
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setWidth(Math.max(0, Math.floor(entry.contentRect.width)))
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

export default function HomeV2HeroSlide({ event, isActive }: HomeV2HeroSlideProps) {
  const [containerRef, containerWidth] = useContainerWidth()
  const isMobile = useIsMobile()
  const chartHeight = isMobile ? 140 : 180
  const yesProbability = pickOutcomeProbability(event, OUTCOME_INDEX.YES)
  const noProbability = 100 - yesProbability
  const categoryLabel = resolveCategoryLabel(event)
  const href = resolveEventPagePath(event)
  const totalMarkets = Math.max(event.total_markets_count, event.markets.length)

  return (
    <article
      aria-roledescription="slide"
      className="flex min-w-0 flex-[0_0_100%] flex-col gap-2 px-1 lg:gap-3"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <Badge variant="outline" className="text-2xs font-semibold tracking-wider">
          {categoryLabel}
        </Badge>
        <AppLink
          intentPrefetch
          href={href}
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          View market →
        </AppLink>
      </div>

      <AppLink
        intentPrefetch
        href={href}
        className="group block px-1 transition-colors hover:text-foreground"
      >
        <h2 className="line-clamp-2 text-base/snug font-semibold text-foreground sm:text-lg/snug lg:text-xl/snug">
          {event.title}
        </h2>
      </AppLink>

      <div
        ref={containerRef}
        className="relative w-full px-1"
        style={{ height: chartHeight }}
      >
        {isActive && containerWidth > 0
          ? (
              <EventMarketChannelProvider markets={event.markets}>
                <EventChart
                  event={event}
                  isMobile={isMobile}
                  showControls={false}
                  showSeriesNavigation={false}
                  chartWidth={containerWidth - 8}
                  chartHeight={chartHeight}
                />
              </EventMarketChannelProvider>
            )
          : <HomeV2HeroChartSkeleton />}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="
          inline-flex items-center gap-1.5 rounded-full bg-(--yes)/10 px-3 py-1 text-xs font-semibold text-(--yes)
        "
        >
          Yes
          <span className="tabular-nums">
            {yesProbability}
            %
          </span>
        </span>
        <span className="
          inline-flex items-center gap-1.5 rounded-full bg-(--no)/10 px-3 py-1 text-xs font-semibold text-(--no)
        "
        >
          No
          <span className="tabular-nums">
            {noProbability}
            %
          </span>
        </span>
      </div>

      <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          Vol
          {' '}
          {formatVolume(event.volume ?? 0)}
        </span>
        <span aria-hidden>·</span>
        <span>
          {totalMarkets}
          {' '}
          {totalMarkets === 1 ? 'market' : 'markets'}
        </span>
      </div>
    </article>
  )
}
