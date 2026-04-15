import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { EventRepository } from '@/lib/db/queries/event'
import { filterHomeEvents } from '@/lib/home-events'

interface SidebarLists {
  trending: Event[]
  fresh: Event[]
  highestVolume: Event[]
}

const SIDEBAR_LIST_LIMIT = 3

async function fetchSorted(sortBy: 'trending' | 'created_at' | 'volume', locale: SupportedLocale) {
  const { data, error } = await EventRepository.listEvents({
    tag: 'trending',
    mainTag: '',
    search: '',
    sortBy,
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

  return filtered.slice(0, SIDEBAR_LIST_LIMIT)
}

export async function fetchSidebarLists(locale: SupportedLocale): Promise<SidebarLists> {
  const [trending, fresh, highestVolume] = await Promise.all([
    fetchSorted('trending', locale),
    fetchSorted('created_at', locale),
    fetchSorted('volume', locale),
  ])

  return { trending, fresh, highestVolume }
}
