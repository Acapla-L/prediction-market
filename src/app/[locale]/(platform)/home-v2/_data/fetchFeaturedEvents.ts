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

  // Hero uses EventChart (CLOB price history). Exclude events that would use
  // EventLiveSeriesChart instead — their internal markers are tuned to a 332px
  // chart and don't scale cleanly into a compact hero slide.
  const heroEligible = filtered.filter(event => !event.has_live_chart)

  return heroEligible.slice(0, FEATURED_COUNT)
}
