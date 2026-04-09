import type { TimeRange } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { Event } from '@/types'
import { useMemo } from 'react'
import { useEventMarketQuotes } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventMidPrices'
import {
  buildMarketTargets,
  useEventPriceHistory,
} from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import {
  computeChanceChanges,
  resolveEventHistoryEndAt,
} from '@/app/[locale]/(platform)/event/[slug]/_utils/EventChartUtils'
import { resolveDisplayPrice } from '@/lib/market-chance'

interface UseEventMarketChanceDataParams {
  event: Event
  range: TimeRange
}

export function useEventMarketChanceData({
  event,
  range,
}: UseEventMarketChanceDataParams) {
  const eventHistoryEndAt = useMemo(
    () => resolveEventHistoryEndAt(event),
    [event],
  )
  const yesMarketTargets = useMemo(
    () => buildMarketTargets(event.markets),
    [event.markets],
  )
  const yesPriceHistory = useEventPriceHistory({
    eventId: event.id,
    range,
    targets: yesMarketTargets,
    eventCreatedAt: event.created_at,
    eventResolvedAt: eventHistoryEndAt,
  })
  const marketQuotesByMarket = useEventMarketQuotes(yesMarketTargets)
  const displayChanceByMarket = useMemo(() => {
    const marketIds = new Set([
      ...Object.keys(marketQuotesByMarket),
      ...Object.keys(yesPriceHistory.latestRawPrices),
    ])
    const entries: Array<[string, number]> = []

    marketIds.forEach((marketId) => {
      const quote = marketQuotesByMarket[marketId]
      const lastTrade = yesPriceHistory.latestRawPrices[marketId]
      const displayPrice = resolveDisplayPrice({
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        midpoint: quote?.mid ?? null,
        lastTrade,
      })

      if (displayPrice != null) {
        entries.push([marketId, displayPrice * 100])
      }
    })

    return Object.fromEntries(entries)
  }, [marketQuotesByMarket, yesPriceHistory.latestRawPrices])
  const chanceChangeByMarket = useMemo(
    () => computeChanceChanges(yesPriceHistory.normalizedHistory),
    [yesPriceHistory.normalizedHistory],
  )

  return {
    displayChanceByMarket,
    chanceChangeByMarket,
    marketQuotesByMarket,
    yesMarketTargets,
    yesPriceHistory,
  }
}
