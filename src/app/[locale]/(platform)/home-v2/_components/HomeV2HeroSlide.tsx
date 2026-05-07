'use client'

import type { HeroChartConfig } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'
import type { Event } from '@/types'
import type { PredictionChartCursorSnapshot, SeriesConfig } from '@/types/PredictionChartTypes'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import HomeV2HeroChartSkeleton from '@/app/[locale]/(platform)/home-v2/_components/HomeV2HeroChartSkeleton'
import AppLink from '@/components/AppLink'
import EventIconImage from '@/components/EventIconImage'
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
      className="flex min-w-0 flex-[0_0_100%] flex-col gap-2 px-1"
    >
      {/* Top row: league logo + title left, "View market →" right. No category pill. */}
      <div className="flex items-start justify-between gap-3 px-1">
        <AppLink
          intentPrefetch
          href={href}
          className="group flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-foreground sm:gap-3"
        >
          {event.icon_url
            ? (
                <div
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center self-start overflow-hidden rounded-sm sm:size-10"
                >
                  <EventIconImage
                    src={event.icon_url}
                    alt=""
                    sizes="40px"
                    containerClassName="size-full rounded-sm"
                  />
                </div>
              )
            : null}
          <h2 className="line-clamp-2 text-lg/tight font-bold text-foreground sm:text-xl/tight lg:text-2xl/tight">
            {event.title}
          </h2>
        </AppLink>
        <AppLink
          intentPrefetch
          href={href}
          className="
            shrink-0 pt-1 text-xs font-medium whitespace-nowrap text-primary transition-colors
            hover:text-primary/80
          "
        >
          View market →
        </AppLink>
      </div>

      {/* Two-column desktop (40% outcomes left / 60% chart right).
          Mobile: chart on top (order-1), outcomes below (order-2). */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[40%_60%] lg:gap-4">
        {/* Outcome list column — vertically stacked rows. */}
        {seriesEntries.length > 0 && (
          <div className="order-2 flex flex-col gap-1.5 px-1 lg:order-1 lg:gap-2">
            {seriesEntries.map(s => (
              <div
                key={s.key}
                className="flex min-w-0 items-center gap-2 rounded-md py-1 text-sm"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {s.label}
                </span>
                <span className="shrink-0 font-semibold text-foreground tabular-nums">
                  {s.currentPercent}
                  %
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Chart column. Margin reserves room for right-side Y-axis labels and bottom date axis. */}
        <div
          ref={containerRef}
          className="relative order-1 w-full overflow-hidden px-1 lg:order-2"
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
                    margin={{ top: 8, right: 36, bottom: 22, left: 4 }}
                    showXAxis
                    showYAxis
                    showHorizontalGrid
                    gridLineOpacity={0.2}
                    lineStrokeWidth={2}
                    xAxisTickCount={4}
                    onCursorDataChange={setSnapshot}
                    tooltipValueFormatter={formatPercent}
                  />
                  {hoverDate && (
                    <div
                      className="
                        pointer-events-none absolute top-1 left-2 rounded-md border border-border/60 bg-card/90 px-2
                        py-1 text-xs shadow-sm backdrop-blur-sm
                      "
                    >
                      <span className="text-muted-foreground">{hoverDate}</span>
                    </div>
                  )}
                </>
              )
            : <HomeV2HeroChartSkeleton />}
        </div>
      </div>

      {/* Footer: Volume + market count. */}
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
