import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { EventRepository } from '@/lib/db/queries/event'

export async function fetchFeaturedEvents(
  slugs: readonly string[],
  locale: SupportedLocale,
): Promise<Event[]> {
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const { data, error } = await EventRepository.getEventBySlug(slug, '', locale)
        if (error || !data) {
          return null
        }
        return data
      }
      catch {
        return null
      }
    }),
  )

  return results.filter((event): event is Event => event != null)
}
