import type { HomeV2CategoryConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { EventRepository } from '@/lib/db/queries/event'
import { filterHomeEvents } from '@/lib/home-events'

const CATEGORY_GRID_SIZE = 4

export interface CategorySection {
  config: HomeV2CategoryConfig
  events: Event[]
}

async function fetchCategory(
  config: HomeV2CategoryConfig,
  locale: SupportedLocale,
): Promise<CategorySection> {
  const { data, error } = await EventRepository.listEvents({
    tag: config.tagSlug,
    mainTag: config.tagSlug,
    search: '',
    sortBy: 'trending',
    userId: '',
    bookmarked: false,
    status: 'active',
    locale,
  })

  if (error || !data) {
    return { config, events: [] }
  }

  const filtered = filterHomeEvents(data, {
    currentTimestamp: Date.now(),
    status: 'active',
  })

  return {
    config,
    events: filtered.slice(0, CATEGORY_GRID_SIZE),
  }
}

export async function fetchCategoryEvents(
  categories: readonly HomeV2CategoryConfig[],
  locale: SupportedLocale,
): Promise<CategorySection[]> {
  return Promise.all(categories.map(c => fetchCategory(c, locale)))
}
