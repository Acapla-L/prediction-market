'use cache'

import type { HomeV2LeagueSectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
import type { SupportedLocale } from '@/i18n/locales'
import type { Event } from '@/types'
import { cacheTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredGamesRepository } from '@/lib/db/queries/discovered-games'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'
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
 * Drift-locked by the synthesize-sports-card test suite covering its sibling.
 */
function parseSlugTeams(slug: string): ParsedSlugTeams | null {
  const parts = slug.split('-')
  if (parts.length !== 6) {
    return null
  }
  const [, awayAbbr, homeAbbr, year, month, day] = parts as [string, string, string, string, string, string]
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return null
  }
  if (!awayAbbr || !homeAbbr) {
    return null
  }
  return { awayAbbr, homeAbbr }
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

function buildTeamObject(
  row: TeamCacheRow | undefined,
  abbreviation: string,
  hostStatus: 'home' | 'away',
) {
  if (row) {
    return {
      name: row.name,
      abbreviation: row.abbreviation,
      record: row.record,
      color: row.color,
      logoUrl: row.logoUrl,
      hostStatus,
    }
  }
  return {
    name: abbreviation.toUpperCase(),
    abbreviation,
    record: null,
    color: null,
    logoUrl: null,
    hostStatus,
  }
}

/**
 * Fetch the top N upcoming games for one league section as `Event[]`.
 *
 * Returns `{ config, events: [] }` immediately when:
 *   - The section is a `placeholder` (Soccer until Phase B v2 v3)
 *   - `leagueSlug` is missing
 *   - The league registry entry can't be found
 *   - The DB lookup errors or yields zero rows
 *
 * Otherwise: fetches up to `LEAGUE_GRID_SIZE` upcoming rows from
 * `discovered_polymarket_games` AND the full `teams_cache` for the league
 * in ONE concurrent `Promise.all` (2 DB round-trips, 2 simultaneous pooler
 * checkouts), then builds an in-memory abbreviation → team map and does O(n)
 * lookups during row iteration — NO per-row DB calls.
 *
 * Performance contract (Fix A1, 2026-05-11):
 *   - Per league section: 2 DB queries, peak 2 simultaneous pooler checkouts
 *     (down from 1 + 2N = 9 queries / 8 peak for LEAGUE_GRID_SIZE=4 prior).
 *   - Matches the batched pattern of `loadDiscoveredGameSportsCardsByLeague`
 *     (the list-route helper) — drift-locked by the test below.
 *
 * Cache tags:
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
  if (config.placeholder || !config.leagueSlug) {
    return { config, events: [] }
  }

  const leagueEntry = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === config.leagueSlug)
  if (!leagueEntry) {
    return { config, events: [] }
  }

  cacheTag(cacheTags.discoveredGamesList(config.leagueSlug))
  cacheTag(cacheTags.teamsCache(config.leagueSlug))

  // Batched fetch — one round-trip for rows, one for teams (2 simultaneous
  // pooler checkouts, peak). Replaces the prior per-row N+1 fan-out
  // (`Promise.all(rows.map(...Promise.all([getByAbbreviation(home), getByAbbreviation(away)])))`)
  // which checked out 1 + 2*LEAGUE_GRID_SIZE pooler connections per league
  // and was the dominant amplifier in the 2026-05-11 EMAXCONN incident.
  const [{ data: rows, error: rowsError }, { data: teams }] = await Promise.all([
    DiscoveredGamesRepository.listUpcomingByLeague(
      config.leagueSlug,
      LEAGUE_GRID_SIZE,
      new Date(),
    ),
    TeamsCacheRepository.listByLeague(config.leagueSlug),
  ])

  if (rowsError || !rows || rows.length === 0) {
    return { config, events: [] }
  }

  // O(n) map build — keyed by abbreviation (the value parsed out of the
  // per-game slug). `teams` may be null on transient DB error from
  // `listByLeague`; in that case every lookup falls through to the
  // abbreviation-only fallback in `buildTeamObject`, matching the prior
  // per-row error path.
  const teamMap = new Map<string, TeamCacheRow>()
  for (const team of teams ?? []) {
    teamMap.set(team.abbreviation, team)
  }

  const events: Event[] = []
  for (const row of rows) {
    const parsedSlug = parseSlugTeams(row.slug)
    if (!parsedSlug) {
      continue
    }
    const payload = parsePayload(row.marketsPayload)
    if (!payload || payload.markets.length === 0) {
      continue
    }

    const homeTeam = buildTeamObject(teamMap.get(parsedSlug.homeAbbr), parsedSlug.homeAbbr, 'home')
    const awayTeam = buildTeamObject(teamMap.get(parsedSlug.awayAbbr), parsedSlug.awayAbbr, 'away')

    try {
      const event = buildSyntheticEvent(row, payload, homeTeam, awayTeam, leagueEntry.sportRouteSlug)
      events.push(event)
    }
    catch {
      // Drop the row silently — same behavior as the prior per-row try/catch.
    }
  }

  return { config, events }
}
