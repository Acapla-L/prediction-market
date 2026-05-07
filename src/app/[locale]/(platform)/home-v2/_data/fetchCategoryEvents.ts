import type { HomeV2TagSectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { EventRepository } from '@/lib/db/queries/event'
import { filterHomeEvents } from '@/lib/home-events'

const CATEGORY_GRID_SIZE = 4

export interface CategorySection {
  config: HomeV2TagSectionConfig
  events: Event[]
}

/**
 * Fetch events for one tag-driven section (Sports overview only as of Step 3).
 * The page orchestrator dispatches per-section based on `kind` and routes
 * `kind: 'league'` configs to `fetchLeagueEvents` instead.
 */
export async function fetchTagCategoryEvents(
  config: HomeV2TagSectionConfig,
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
