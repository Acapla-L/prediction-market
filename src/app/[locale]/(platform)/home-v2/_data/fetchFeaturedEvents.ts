import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { EventRepository } from '@/lib/db/queries/event'
import { filterHomeEvents } from '@/lib/home-events'

const FEATURED_COUNT = 3

export async function fetchFeaturedEvents(locale: SupportedLocale): Promise<Event[]> {
  const { data, error } = await EventRepository.listEvents({
    tag: 'trending',
    mainTag: '',
    search: '',
    sortBy: 'trending',
    userId: '',
    bookmarked: false,
    status: 'active',
    locale,
  })

  if (error || !data) {
    return []
  }

  const filtered = filterHomeEvents(data, {
    currentTimestamp: Date.now(),
    status: 'active',
  })

  // Only events with has_live_chart have real chart data on this platform.
  // Non-live-chart events have $0 CLOB trading volume — their price history
  // endpoints return empty arrays. Live-chart events use Chainlink/Massive
  // oracle price feeds which always have data.
  const heroEligible = filtered.filter(event => event.has_live_chart)

  return heroEligible.slice(0, FEATURED_COUNT)
}
