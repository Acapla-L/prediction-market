import type { Event } from '@/types'
import { ChevronRightIcon } from 'lucide-react'
import AppLink from '@/components/AppLink'
import { Card } from '@/components/ui/card'
import { OUTCOME_INDEX } from '@/lib/constants'
import { resolveEventPagePath } from '@/lib/events-routing'
import { buildChanceByMarket } from '@/lib/market-chance'

interface SidebarListCardProps {
  title: string
  events: Event[]
  emptyLabel?: string
}

interface StaticRow {
  label: string
  href: string
}

interface SidebarStaticListCardProps {
  title: string
  rows: readonly StaticRow[]
}

function getLeadingProbability(event: Event): number {
  const chanceByMarket = buildChanceByMarket(event.markets, {})
  const primary = event.markets[0]
  if (!primary) {
    return 0
  }
  const yesChance = chanceByMarket[primary.condition_id] ?? 0
  return Math.round(Math.max(yesChance, 100 - yesChance))
}

function getLeadingOutcomeLabel(event: Event): string {
  const chanceByMarket = buildChanceByMarket(event.markets, {})
  const primary = event.markets[0]
  if (!primary) {
    return ''
  }
  const yesChance = chanceByMarket[primary.condition_id] ?? 0
  const leadingIndex = yesChance >= 50 ? OUTCOME_INDEX.YES : OUTCOME_INDEX.NO
  const outcome = primary.outcomes.find(o => o.outcome_index === leadingIndex) ?? primary.outcomes[leadingIndex]
  return outcome?.outcome_text ?? ''
}

function SidebarCardShell({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
      </div>
      <div className="flex flex-col">
        {children}
      </div>
    </Card>
  )
}

export function SidebarEventListCard({ title, events, emptyLabel = 'No markets available' }: SidebarListCardProps) {
  if (events.length === 0) {
    return (
      <SidebarCardShell title={title}>
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      </SidebarCardShell>
    )
  }

  return (
    <SidebarCardShell title={title}>
      {events.map((event, index) => {
        const probability = getLeadingProbability(event)
        const outcomeLabel = getLeadingOutcomeLabel(event)
        const href = resolveEventPagePath(event)
        const isLast = index === events.length - 1

        return (
          <AppLink
            key={event.id}
            intentPrefetch
            href={href}
            className={`
              group flex items-center gap-3 px-4 py-3 transition-all duration-150
              hover:bg-accent/40 hover:pl-5
              ${isLast ? '' : 'border-b border-border/40'}
            `}
          >
            <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="line-clamp-2 flex-1 text-xs/snug font-medium text-foreground">
              {event.title}
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="text-xs font-semibold text-primary tabular-nums">
                {probability}
                %
              </span>
              {outcomeLabel && (
                <span className="text-2xs tracking-wide text-muted-foreground uppercase">
                  {outcomeLabel}
                </span>
              )}
            </span>
          </AppLink>
        )
      })}
    </SidebarCardShell>
  )
}

export function SidebarStaticListCard({ title, rows }: SidebarStaticListCardProps) {
  return (
    <SidebarCardShell title={title}>
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1
        return (
          <a
            key={row.label}
            href={row.href}
            className={`
              group flex items-center gap-3 px-4 py-3 transition-all duration-150
              hover:bg-accent/40 hover:pl-5
              ${isLast ? '' : 'border-b border-border/40'}
            `}
          >
            <span className="flex-1 text-xs font-medium text-foreground">
              {row.label}
            </span>
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </a>
        )
      })}
    </SidebarCardShell>
  )
}
