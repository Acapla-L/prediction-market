import type { CategorySection } from '@/app/[locale]/(platform)/home-v2/_data/fetchCategoryEvents'
import { ChevronRightIcon } from 'lucide-react'
import EventCard from '@/app/[locale]/(platform)/(home)/_components/EventCard'
import AppLink from '@/components/AppLink'

interface HomeV2CategorySectionProps {
  section: CategorySection
  currentTimestamp: number
  title: string
  viewAllLabel: string
}

export default function HomeV2CategorySection({
  section,
  currentTimestamp,
  title,
  viewAllLabel,
}: HomeV2CategorySectionProps) {
  const { config, events } = section

  if (events.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <AppLink
          intentPrefetch
          href={config.href}
          className="
            group inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors
            hover:text-primary/80
          "
        >
          {viewAllLabel}
          <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </AppLink>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {events.map(event => (
          <EventCard
            key={event.id}
            event={event}
            currentTimestamp={currentTimestamp}
          />
        ))}
      </div>
    </section>
  )
}
