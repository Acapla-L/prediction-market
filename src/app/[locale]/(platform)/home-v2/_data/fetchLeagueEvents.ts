'use cache'

import type { HomeV2LeagueSectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { SupportedLocale } from '@/i18n/locales'
import type { DiscoveredGamesLeague, DiscoveredGamesLeagueSlug } from '@/lib/polymarket/games-leagues'
import type { Event } from '@/types'
import { cacheTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { DISCOVERED_GAMES_LEAGUES, getLeaguesBySportRouteSlug } from '@/lib/polymarket/games-leagues'
import { DiscoveredGameMarketsPayloadSchema } from '@/lib/polymarket/normalize-games-discovery-payload'
import { buildSyntheticEvent } from '@/lib/polymarket/synthesize-sports-card'

const LEAGUE_GRID_SIZE = 4

export interface LeagueSection {
  config: HomeV2LeagueSectionConfig
  events: Event[]
}

interface ParsedSlugTeams {
  awayAbbr: string
  homeAbbr: string
}

/**
 * Local mirror of `parseGameSlugTeams` — kept here to avoid importing the
 * full sports-card module (which pulls server-only deps) for one helper.
 * Kept in sync manually with `parseGameSlugTeams` in
 * `synthesize-sports-card.ts`; no automated drift-lock exists for this mirror.
 *
 * `teamOrderConvention` controls which abbreviation slot is the away team.
 * Defaults to `'away_first'` (US sports); soccer leagues pass `'home_first'`.
 */
function parseSlugTeams(
  slug: string,
  teamOrderConvention: 'away_first' | 'home_first' = 'away_first',
): ParsedSlugTeams | null {
  const parts = slug.split('-')
  if (parts.length !== 6) {
    return null
  }
  const [, firstAbbr, secondAbbr, year, month, day] = parts as [string, string, string, string, string, string]
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return null
  }
  if (!firstAbbr || !secondAbbr) {
    return null
  }
  const awayAbbr = teamOrderConvention === 'home_first' ? secondAbbr : firstAbbr
  const homeAbbr = teamOrderConvention === 'home_first' ? firstAbbr : secondAbbr
  return { awayAbbr, homeAbbr }
}

/**
 * Sortable epoch-ms for a synthetic Event's start time. Returns `+Infinity`
 * when missing or unparseable so such events sink to the end of the merge.
 */
function eventStartMs(event: Event): number {
  const raw = event.sports_start_time
  if (!raw) {
    return Number.POSITIVE_INFINITY
  }
  const parsed = new Date(raw).getTime()
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

function parsePayload(serialized: string) {
  let data: unknown
  try {
    data = JSON.parse(serialized)
  }
  catch {
    return null
  }
  const parsed = DiscoveredGameMarketsPayloadSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/**
 * Project up to `limit` upcoming rows for ONE league into `Event[]`, ordered
 * by `game_start_time` ASC. Registers the league's discovery + teams cache
 * tags. Returns `[]` (and still registers tags) when the league is unknown or
 * the DB yields nothing.
 */
async function fetchSingleLeagueEvents(
  leagueSlug: DiscoveredGamesLeagueSlug,
  leagueEntry: DiscoveredGamesLeague | undefined,
  limit: number,
): Promise<Event[]> {
  cacheTag(cacheTags.discoveredGamesList(leagueSlug))
  cacheTag(cacheTags.teamsCache(leagueSlug))

  if (!leagueEntry) {
    return []
  }

  const { data: rows, error } = await DiscoveredGamesRepository.listUpcomingByLeague(
    leagueSlug,
    limit,
    new Date(),
  )
  if (error || !rows || rows.length === 0) {
    return []
  }

  const events = await Promise.all(
    rows.map(async (row): Promise<Event | null> => {
      const parsedSlug = parseSlugTeams(row.slug, leagueEntry.teamOrderConvention)
      if (!parsedSlug) {
        return null
      }
      const payload = parsePayload(row.marketsPayload)
      if (!payload) {
        return null
      }
      if (payload.markets.length === 0) {
        return null
      }

      const [{ data: homeRow }, { data: awayRow }] = await Promise.all([
        TeamsCacheRepository.getByAbbreviation(row.league, parsedSlug.homeAbbr),
        TeamsCacheRepository.getByAbbreviation(row.league, parsedSlug.awayAbbr),
      ])

      const homeTeam = homeRow
        ? {
            name: homeRow.name,
            abbreviation: homeRow.abbreviation,
            record: homeRow.record,
            color: homeRow.color,
            logoUrl: homeRow.logoUrl,
            hostStatus: 'home' as const,
          }
        : {
            name: parsedSlug.homeAbbr.toUpperCase(),
            abbreviation: parsedSlug.homeAbbr,
            record: null,
            color: null,
            logoUrl: null,
            hostStatus: 'home' as const,
          }

      const awayTeam = awayRow
        ? {
            name: awayRow.name,
            abbreviation: awayRow.abbreviation,
            record: awayRow.record,
            color: awayRow.color,
            logoUrl: awayRow.logoUrl,
            hostStatus: 'away' as const,
          }
        : {
            name: parsedSlug.awayAbbr.toUpperCase(),
            abbreviation: parsedSlug.awayAbbr,
            record: null,
            color: null,
            logoUrl: null,
            hostStatus: 'away' as const,
          }

      try {
        return buildSyntheticEvent(row, payload, homeTeam, awayTeam, leagueEntry.sportRouteSlug)
      }
      catch {
        return null
      }
    }),
  )

  return events.filter((e): e is Event => e !== null)
}

/**
 * Fetch the top N upcoming games for one home-v2 league section as `Event[]`.
 *
 * Three modes (mutually exclusive on the config):
 *   - `placeholder: true`   → returns `[]` without touching the DB.
 *   - `leagueSlug` set      → one-league section (MLB/NBA/NHL/FIFA WC).
 *   - `sportRouteSlug` set  → multi-league merge (`'soccer'` → EPL+La Liga+MLS).
 *                             Each league fetches up to `LEAGUE_GRID_SIZE`
 *                             upcoming rows; the union is re-sorted by
 *                             `gameStartTime` ASC and capped at `LEAGUE_GRID_SIZE`.
 *
 * Cache tags are registered per contributing league:
 *   - `discoveredGamesList(league)` — busted by the games-discovery sync
 *   - `teamsCache(league)`          — busted by the teams sync
 *
 * Per-locale isolation isn't required: the sidecar payload is locale-neutral.
 * The `locale` arg is accepted for symmetry with `fetchCategoryEvents` and
 * future i18n hooks, but is currently unused.
 */
export async function fetchLeagueEvents(
  config: HomeV2LeagueSectionConfig,
  _locale: SupportedLocale,
): Promise<LeagueSection> {
  if (config.placeholder) {
    return { config, events: [] }
  }

  // Multi-league merge mode (Phase B v2 v3 soccer): union of every league
  // sharing the configured sport-route alias.
  if (config.sportRouteSlug) {
    const leagues = getLeaguesBySportRouteSlug(config.sportRouteSlug)
    if (leagues.length === 0) {
      return { config, events: [] }
    }
    const perLeague = await Promise.all(
      leagues.map(league =>
        fetchSingleLeagueEvents(league.slug, league, LEAGUE_GRID_SIZE),
      ),
    )
    const merged = perLeague
      .flat()
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))
      .slice(0, LEAGUE_GRID_SIZE)
    return { config, events: merged }
  }

  if (!config.leagueSlug) {
    return { config, events: [] }
  }

  const leagueEntry = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === config.leagueSlug)
  const events = await fetchSingleLeagueEvents(config.leagueSlug, leagueEntry, LEAGUE_GRID_SIZE)
  return { config, events }
}
