import type { SupportedLocale } from '@/i18n/locales'
import type { FifaOverlayResult } from '@/lib/polymarket/types'
import type { ThemeSiteIdentity } from '@/lib/theme-site-identity'
import type {
  ConditionChangeLogEntry,
  Event,
  EventLiveChartConfig,
  EventSeriesEntry,
} from '@/types'
import { cacheTag } from 'next/cache'
import { loadMarketContextSettings } from '@/lib/ai/market-context-config'
import { cacheTags } from '@/lib/cache-tags'
import { EventRepository } from '@/lib/db/queries/event'
import { FIFA_EVENT_SLUG } from '@/lib/polymarket/constants'
import { getFifaOverlay } from '@/lib/polymarket/fifa-overlay'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import 'server-only'

export interface EventPageContentData {
  event: Event
  marketContextEnabled: boolean
  changeLogEntries: ConditionChangeLogEntry[]
  seriesEvents: EventSeriesEntry[]
  liveChartConfig: EventLiveChartConfig | null
}

export interface EventPageShellData {
  route: Awaited<ReturnType<typeof getEventRouteBySlug>>
  title: string | null
  site: ThemeSiteIdentity
}

export async function resolveCanonicalEventSlugFromSportsPath(
  sportSlug: string,
  eventSlug: string,
  leagueSlug?: string | null,
) {
  const { data, error } = await EventRepository.getCanonicalEventSlugBySportsPath(
    sportSlug,
    eventSlug,
    leagueSlug,
  )
  if (error || !data?.slug) {
    return null
  }

  return data.slug
}

export async function getEventTitleBySlug(eventSlug: string, locale: SupportedLocale) {
  'use cache'
  cacheTag(cacheTags.event(eventSlug))

  const { data } = await EventRepository.getEventTitleBySlug(eventSlug, locale)
  return data?.title ?? null
}

export async function getEventRouteBySlug(eventSlug: string) {
  'use cache'
  cacheTag(cacheTags.event(eventSlug))

  const { data, error } = await EventRepository.getEventRouteBySlug(eventSlug)
  if (error || !data) {
    return null
  }

  return data
}

export async function loadEventPagePublicContentData(
  eventSlug: string,
  locale: SupportedLocale,
): Promise<EventPageContentData | null> {
  'use cache'
  cacheTag(cacheTags.event(eventSlug))

  const marketContextSettings = await loadMarketContextSettings()

  const marketContextEnabled = marketContextSettings.enabled && Boolean(marketContextSettings.apiKey)

  const [eventResult, changeLogResult] = await Promise.all([
    EventRepository.getEventBySlug(eventSlug, '', locale),
    EventRepository.getEventConditionChangeLogBySlug(eventSlug),
  ])

  const { data: event, error } = eventResult
  if (error || !event) {
    return null
  }

  if (changeLogResult.error) {
    console.warn('Failed to load event change log:', changeLogResult.error)
  }

  let seriesEvents: EventSeriesEntry[] = []
  let liveChartConfig: EventLiveChartConfig | null = null

  if (event.series_slug) {
    const [seriesEventsResult, liveChartConfigResult] = await Promise.all([
      EventRepository.getSeriesEventsBySeriesSlug(event.series_slug),
      EventRepository.getLiveChartConfigBySeriesSlug(event.series_slug),
    ])

    if (seriesEventsResult.error) {
      console.warn('Failed to load event series events:', seriesEventsResult.error)
    }
    else {
      seriesEvents = seriesEventsResult.data ?? []
    }

    if (liveChartConfigResult.error) {
      console.warn('Failed to load event live chart config:', liveChartConfigResult.error)
    }
    else {
      liveChartConfig = liveChartConfigResult.data ?? null
    }
  }

  if (event.series_slug && !seriesEvents.some(seriesEvent => seriesEvent.slug === event.slug)) {
    seriesEvents = [
      {
        id: event.id,
        slug: event.slug,
        status: event.status,
        end_date: event.end_date,
        resolved_at: event.resolved_at ?? null,
        created_at: event.created_at,
        resolved_direction: null,
      },
      ...seriesEvents,
    ]
  }

  // FIFA Polymarket overlay — scope-locked to the single event slug.
  // Every other slug skips this block and renders with the existing Kuest
  // data path byte-for-byte unchanged. See
  // `docs/plans/fifa-polymarket-overlay-implementation-plan.md`.
  let finalEvent = event
  if (event.slug === FIFA_EVENT_SLUG) {
    const overlay = await getFifaOverlay()
    if (overlay.stale) {
      console.warn(
        '[fifa-overlay] Serving event with stale=true at',
        overlay.lastUpdatedAt.toISOString(),
      )
    }
    finalEvent = applyFifaOverlay(event, overlay)
  }

  return {
    event: finalEvent,
    marketContextEnabled,
    changeLogEntries: changeLogResult.data ?? [],
    seriesEvents,
    liveChartConfig,
  }
}

/**
 * Stitch Polymarket overlay data onto a FIFA event's markets by matching
 * `market.short_title` against `overlay.marketsByCountry`.
 *
 * **Revision 1 invariant:** this function NEVER writes to `outcome.token_id`
 * or removes any existing field. It only:
 *   - Overrides `market.price`, `market.probability`, `market.volume` when a
 *     matching overlay entry exists.
 *   - Overrides `outcome.buy_price` and `outcome.sell_price` on both YES
 *     (outcome_index 0) and NO (outcome_index 1) outcomes. (NOT
 *     `last_trade_price` — that field is not on the exported `Outcome` type.)
 *   - Sets the new optional `outcome.polymarket_token_id` field to the
 *     Polymarket CLOB token ID for YES/NO respectively.
 *
 * The Kuest `token_id` survives intact for every Kuest code path (Buy click,
 * wallet/order flow, relayer, 60s volume poll).
 *
 * Markets without a matching overlay entry pass through untouched.
 * Non-FIFA events pass through untouched (defensive — the loader's guard
 * clause already filters on slug, but this keeps the function safe against
 * future callers).
 *
 * Pure function — returns a new `Event`; never mutates its arguments.
 * Exported for direct unit testing in
 * `tests/unit/eventPageDataFifaOverlay.test.ts`.
 */
export function applyFifaOverlay(event: Event, overlay: FifaOverlayResult): Event {
  if (event.slug !== FIFA_EVENT_SLUG) {
    return event
  }

  const stitchedMarkets = event.markets.map((market) => {
    const key = market.short_title ?? ''
    const overlayMarket = overlay.marketsByCountry[key]
    if (!overlayMarket) {
      return market
    }

    const yesPrice = overlayMarket.yesPrice
    const noPrice = overlayMarket.noPrice

    return {
      ...market,
      price: yesPrice ?? market.price,
      probability: yesPrice != null ? yesPrice * 100 : market.probability,
      volume: overlayMarket.volume,
      outcomes: market.outcomes.map((outcome) => {
        if (outcome.outcome_index === 0) {
          return {
            ...outcome,
            buy_price: yesPrice ?? outcome.buy_price,
            sell_price: yesPrice ?? outcome.sell_price,
            polymarket_token_id: overlayMarket.yesTokenId,
          }
        }
        if (outcome.outcome_index === 1) {
          return {
            ...outcome,
            buy_price: noPrice ?? outcome.buy_price,
            sell_price: noPrice ?? outcome.sell_price,
            polymarket_token_id: overlayMarket.noTokenId,
          }
        }
        return outcome
      }),
    }
  })

  return { ...event, markets: stitchedMarkets }
}

export async function loadEventPageShellData(
  eventSlug: string,
  locale: SupportedLocale,
): Promise<EventPageShellData> {
  'use cache'
  cacheTag(cacheTags.event(eventSlug))
  cacheTag(cacheTags.settings)

  const [route, title, runtimeTheme] = await Promise.all([
    getEventRouteBySlug(eventSlug),
    getEventTitleBySlug(eventSlug, locale),
    loadRuntimeThemeState(),
  ])

  return {
    route,
    title,
    site: runtimeTheme.site,
  }
}
