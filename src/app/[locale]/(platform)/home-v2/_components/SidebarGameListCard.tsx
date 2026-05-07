import type { SidebarGameWithLeading } from '@/app/[locale]/(platform)/home-v2/_data/fetchSidebarData'
import AppLink from '@/components/AppLink'
import { Card } from '@/components/ui/card'
import { getLeagueForGameSlug } from '@/lib/polymarket/games-leagues'

interface SidebarGameListCardProps {
  title: string
  games: SidebarGameWithLeading[]
  emptyLabel?: string
}

interface ResolvedGameRow {
  key: string
  href: string | null
  awayLabel: string
  homeLabel: string
  leadingLabel: string | null
  leadingPercent: number | null
}

function resolveRow(game: SidebarGameWithLeading): ResolvedGameRow {
  const league = getLeagueForGameSlug(game.row.slug)
  const href = league ? `/sports/${league.sportRouteSlug}/${game.row.slug}` : null
  return {
    key: game.row.slug,
    href,
    awayLabel: (game.row.awayTeamLabel ?? '').toUpperCase(),
    homeLabel: (game.row.homeTeamLabel ?? '').toUpperCase(),
    leadingLabel: game.leading?.label ?? null,
    leadingPercent: game.leading?.percent ?? null,
  }
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

export default function SidebarGameListCard({
  title,
  games,
  emptyLabel = 'No games available',
}: SidebarGameListCardProps) {
  if (games.length === 0) {
    return (
      <SidebarCardShell title={title}>
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      </SidebarCardShell>
    )
  }

  const rows = games.map(resolveRow)

  return (
    <SidebarCardShell title={title}>
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1
        const hasTeams = row.awayLabel.length > 0 && row.homeLabel.length > 0
        const teamsLine = hasTeams
          ? `${row.awayLabel} @ ${row.homeLabel}`
          : '—'

        const hasLeading = row.leadingLabel !== null && row.leadingPercent !== null
        const inner = (
          <>
            <span className="line-clamp-1 flex-1 text-xs/snug font-medium text-foreground">
              {teamsLine}
            </span>
            {hasLeading && (
              <span className="
                line-clamp-1 max-w-[45%] shrink-0 text-2xs tracking-wide text-muted-foreground tabular-nums
              "
              >
                {row.leadingLabel}
                {' '}
                {row.leadingPercent}
                %
              </span>
            )}
          </>
        )

        const className = `
          group flex items-center gap-3 px-4 py-3 transition-all duration-150
          hover:bg-accent/40 hover:pl-5
          ${isLast ? '' : 'border-b border-border/40'}
        `

        return row.href
          ? (
              <AppLink
                key={row.key}
                intentPrefetch
                href={row.href}
                className={className}
              >
                {inner}
              </AppLink>
            )
          : (
              <div key={row.key} className={className}>
                {inner}
              </div>
            )
      })}
    </SidebarCardShell>
  )
}
