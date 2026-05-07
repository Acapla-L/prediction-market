'use client'

import type { HeroChartConfig } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'
import type { Event } from '@/types'
import type { PredictionChartCursorSnapshot, SeriesConfig } from '@/types/PredictionChartTypes'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import HomeV2HeroChartSkeleton from '@/app/[locale]/(platform)/home-v2/_components/HomeV2HeroChartSkeleton'
import AppLink from '@/components/AppLink'
import { Badge } from '@/components/ui/badge'
import { useIsMobile } from '@/hooks/useIsMobile'
import { resolveEventPagePath } from '@/lib/events-routing'
import { formatVolume } from '@/lib/formatters'

// PredictionChart is the pure Visx renderer used by every chart on the platform.
// We render it directly with pre-fetched server-side data — no client-side hooks,
// no EventChart wrapper, no WebSocket. Just props → chart.
const PredictionChart = dynamic(
  () => import('@/components/PredictionChart'),
  { ssr: false, loading: () => <HomeV2HeroChartSkeleton /> },
)

interface HomeV2HeroSlideProps {
  event: Event
  isActive: boolean
  /** Multi-line chart config (top-4 outcomes). Null → renders skeleton. */
  chartConfig: HeroChartConfig | null
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

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export default function HomeV2HeroSlide({ event, isActive, chartConfig }: HomeV2HeroSlideProps) {
  const [containerRef, containerWidth] = useContainerWidth()
  const isMobile = useIsMobile()
  const chartHeight = isMobile ? 140 : 180
  const [snapshot, setSnapshot] = useState<PredictionChartCursorSnapshot | null>(null)
  const categoryLabel = resolveCategoryLabel(event)
  const href = resolveEventPagePath(event)
  const totalMarkets = Math.max(event.total_markets_count, event.markets.length)

  const dataPoints = chartConfig?.dataPoints ?? []
  const seriesEntries = chartConfig?.series ?? []

  const series = useMemo<SeriesConfig[]>(
    () => seriesEntries.map(s => ({ key: s.key, name: s.label, color: s.color })),
    [seriesEntries],
  )

  // Hover tooltip — show the leading series' value at the cursor (or first
  // available). For multi-line, header label row is always visible; the
  // tooltip itself is decorative.
  const hoverDate = useMemo(() => {
    if (!snapshot) {
      return null
    }
    return snapshot.date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }, [snapshot])

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

      {/* Top-4 outcome label row — Polymarket-style header. */}
      {seriesEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
          {seriesEntries.map(s => (
            <div key={s.key} className="flex min-w-0 items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate font-medium text-foreground">{s.label}</span>
              <span className="ml-auto shrink-0 font-semibold text-foreground tabular-nums sm:ml-0">
                {s.currentPercent}
                %
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden px-1"
        style={{ height: chartHeight }}
      >
        {isActive && containerWidth > 0 && dataPoints.length > 0 && series.length > 0
          ? (
              <>
                <PredictionChart
                  data={dataPoints}
                  series={series}
                  width={Math.max(0, containerWidth - 8)}
                  height={chartHeight}
                  margin={{ top: 8, right: 8, bottom: 16, left: 8 }}
                  showXAxis={false}
                  showYAxis={false}
                  showHorizontalGrid
                  gridLineOpacity={0.2}
                  lineStrokeWidth={2}
                  onCursorDataChange={setSnapshot}
                  tooltipValueFormatter={formatPercent}
                />
                {hoverDate && (
                  <div
                    className="
                      pointer-events-none absolute top-2 right-2 rounded-md border border-border/60 bg-card/90 px-2 py-1
                      text-xs shadow-sm backdrop-blur-sm
                    "
                  >
                    <span className="text-muted-foreground">{hoverDate}</span>
                  </div>
                )}
              </>
            )
          : <HomeV2HeroChartSkeleton />}
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
