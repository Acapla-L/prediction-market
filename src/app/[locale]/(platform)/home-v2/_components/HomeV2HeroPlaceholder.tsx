import type { Event } from '@/types'
import AppLink from '@/components/AppLink'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveEventPagePath } from '@/lib/events-routing'
import { formatVolume } from '@/lib/formatters'
import { buildChanceByMarket } from '@/lib/market-chance'

interface HomeV2HeroPlaceholderProps {
  events: Event[]
}

function pickOutcomeProbability(event: Event, outcomeIndex: 0 | 1): number {
  const chanceByMarket = buildChanceByMarket(event.markets, {})
  const primary = event.markets[0]
  if (!primary) {
    return 0
  }
  if (outcomeIndex === OUTCOME_INDEX.YES) {
    return Math.round(chanceByMarket[primary.condition_id] ?? 0)
  }
  return Math.round(100 - (chanceByMarket[primary.condition_id] ?? 0))
}

function resolveCategoryLabel(event: Event): string {
  const mainCategory = event.tags?.find(tag => tag.isMainCategory)
  return (mainCategory?.name || event.main_tag || event.tags?.[0]?.name || 'Featured').toUpperCase()
}

export default function HomeV2HeroPlaceholder({ events }: HomeV2HeroPlaceholderProps) {
  const first = events[0]

  if (!first) {
    return (
      <Card className="flex h-96 items-center justify-center border-dashed p-6 text-sm text-muted-foreground">
        Featured markets unavailable
      </Card>
    )
  }

  const yesProbability = pickOutcomeProbability(first, OUTCOME_INDEX.YES)
  const noProbability = 100 - yesProbability
  const categoryLabel = resolveCategoryLabel(first)
  const href = resolveEventPagePath(first)
  const totalMarkets = Math.max(first.total_markets_count, first.markets.length)

  return (
    <Card className="group relative overflow-hidden p-0 transition-all hover:shadow-lg hover:shadow-black/10">
      <AppLink intentPrefetch href={href} className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <Badge variant="outline" className="text-2xs font-semibold tracking-wider">
            {categoryLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            1 of
            {' '}
            {events.length}
          </span>
        </div>

        <div className="px-6 pt-3">
          <h2 className="line-clamp-2 text-xl/snug font-semibold text-foreground lg:text-2xl">
            {first.title}
          </h2>
        </div>

        <div className="
          mx-6 mt-4 flex h-56 items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/30
        "
        >
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Chart — wiring in phase 5
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 px-6">
          <span className="
            inline-flex items-center gap-1.5 rounded-full bg-(--yes)/10 px-3 py-1 text-xs font-semibold text-(--yes)
          "
          >
            Yes
            <span className="tabular-nums">
              {yesProbability}
              %
            </span>
          </span>
          <span className="
            inline-flex items-center gap-1.5 rounded-full bg-(--no)/10 px-3 py-1 text-xs font-semibold text-(--no)
          "
          >
            No
            <span className="tabular-nums">
              {noProbability}
              %
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 px-6 pt-3 pb-5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            Vol
            {' '}
            {formatVolume(first.volume ?? 0)}
          </span>
          <span aria-hidden>·</span>
          <span>
            {totalMarkets}
            {' '}
            {totalMarkets === 1 ? 'market' : 'markets'}
          </span>
        </div>
      </AppLink>
    </Card>
  )
}
