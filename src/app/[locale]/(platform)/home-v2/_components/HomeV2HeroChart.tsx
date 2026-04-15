'use client'

import type { Event } from '@/types'
import type { PredictionChartCursorSnapshot, SeriesConfig } from '@/types/PredictionChartTypes'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMarketTargets, useEventPriceHistory } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import HomeV2HeroChartSkeleton from '@/app/[locale]/(platform)/home-v2/_components/HomeV2HeroChartSkeleton'
import { OUTCOME_INDEX } from '@/lib/constants'

const PredictionChart = dynamic(
  () => import('@/components/PredictionChart'),
  { ssr: false, loading: () => <HomeV2HeroChartSkeleton /> },
)

const CHART_HEIGHT = 200
const CHART_MARGIN = { top: 8, right: 8, bottom: 16, left: 8 }

interface HomeV2HeroChartProps {
  event: Event
}

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(400)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') {
      return
    }
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

export default function HomeV2HeroChart({ event }: HomeV2HeroChartProps) {
  const [containerRef, width] = useContainerWidth()
  const [snapshot, setSnapshot] = useState<PredictionChartCursorSnapshot | null>(null)

  const targets = useMemo(
    () => buildMarketTargets(event.markets, OUTCOME_INDEX.YES),
    [event.markets],
  )

  const primaryConditionId = event.markets[0]?.condition_id ?? ''

  const series = useMemo<SeriesConfig[]>(
    () => [{ key: primaryConditionId, name: 'Yes', color: 'var(--primary)' }],
    [primaryConditionId],
  )

  const { normalizedHistory } = useEventPriceHistory({
    eventId: event.id,
    range: '1D',
    targets,
    eventCreatedAt: event.created_at,
    eventResolvedAt: event.resolved_at ?? null,
  })

  const hoverPercent = useMemo(() => {
    if (!snapshot) {
      return null
    }
    const raw = snapshot.values[primaryConditionId]
    return typeof raw === 'number' ? Math.round(raw * 100) : null
  }, [snapshot, primaryConditionId])

  const hoverDate = useMemo(() => {
    if (!snapshot) {
      return null
    }
    return snapshot.date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [snapshot])

  const hasData = normalizedHistory.length > 0

  return (
    <div ref={containerRef} className="relative h-[200px] w-full">
      {hasData && width > 0
        ? (
            <>
              <PredictionChart
                data={normalizedHistory}
                series={series}
                width={width}
                height={CHART_HEIGHT}
                margin={CHART_MARGIN}
                showXAxis={false}
                showYAxis={false}
                showHorizontalGrid
                gridLineOpacity={0.2}
                lineStrokeWidth={2}
                showAreaFill
                areaFillTopOpacity={0.18}
                areaFillBottomOpacity={0}
                onCursorDataChange={setSnapshot}
                tooltipValueFormatter={value => `${Math.round(value * 100)}%`}
              />
              {hoverPercent !== null && hoverDate && (
                <div className="
                  pointer-events-none absolute top-2 right-2 rounded-md border border-border/60 bg-card/90 px-2 py-1
                  text-xs shadow-sm backdrop-blur-sm
                "
                >
                  <span className="font-semibold text-primary tabular-nums">
                    {hoverPercent}
                    %
                  </span>
                  <span className="ml-2 text-muted-foreground">{hoverDate}</span>
                </div>
              )}
            </>
          )
        : (
            <HomeV2HeroChartSkeleton label="Chart unavailable" />
          )}
    </div>
  )
}
