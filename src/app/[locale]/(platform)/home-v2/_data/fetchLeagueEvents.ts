'use cache'

import type { HomeV2LeagueSectionConfig } from '@/app/[locale]/(platform)/home-v2/_config/categories'
import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
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
 * Project up to `limit` upcoming rows for ONE league into `Event[]`, ordered
 * by `game_start_time` ASC. Registers the league's discovery + teams cache
 * tags. Returns `[]` (and still registers tags) when the league is unknown or
 * the DB yields nothing.
 *
 * Performance contract (Fix A1, 2026-05-11): per league section issues exactly
 * 2 DB queries (rows + the full league teams_cache) in ONE concurrent
 * `Promise.all` — peak 2 simultaneous pooler checkouts — then builds an
 * in-memory abbreviation → team `Map` and does O(1) lookups during row
 * iteration. NO per-row `getByAbbreviation` fan-out (that 1 + 2N pattern was
 * the dominant amplifier in the 2026-05-11 EMAXCONN cascade). Mirrors the
 * batched pattern of `loadDiscoveredGameSportsCardsByLeague` (the list-route
 * helper). Drift-locked by `tests/unit/fetchLeagueEventsBatchedPattern.test.ts`.
 *
 * `leagueSlug` is the registry slug (e.g. `'mlb'`, `'epl'`) — also the
 * teams_cache key (per NEW-10). When called repeatedly for a multi-league
 * section it is invoked sequentially (see `fetchLeagueEvents`), so peak
 * concurrency stays at 2 regardless of league count.
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

  // Batched fetch — one round-trip for rows, one for the league's teams_cache
  // (2 simultaneous pooler checkouts, peak). Replaces the prior per-row N+1
  // fan-out which checked out 1 + 2*limit pooler connections per league.
  const [{ data: rows, error: rowsError }, { data: teams }] = await Promise.all([
    DiscoveredGamesRepository.listUpcomingByLeague(leagueSlug, limit, new Date()),
    TeamsCacheRepository.listByLeague(leagueSlug),
  ])

  if (rowsError || !rows || rows.length === 0) {
    return []
  }

  // O(1) lookup map keyed by abbreviation (the value parsed out of each
  // per-game slug). `teams` may be null on transient DB error from
  // `listByLeague`; in that case every lookup falls through to the
  // abbreviation-only fallback in `buildTeamObject`.
  const teamMap = new Map<string, TeamCacheRow>()
  for (const team of teams ?? []) {
    teamMap.set(team.abbreviation, team)
  }

  const events: Event[] = []
  for (const row of rows) {
    const parsedSlug = parseSlugTeams(row.slug, leagueEntry.teamOrderConvention)
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
      events.push(buildSyntheticEvent(row, payload, homeTeam, awayTeam, leagueEntry.sportRouteSlug))
    }
    catch {
      // Drop the row silently — same behavior as the prior per-row try/catch.
    }
  }

  return events
}

/**
 * Fetch the top N upcoming games for one home-v2 league section as `Event[]`.
 *
 * Three modes (mutually exclusive on the config):
 *   - `placeholder: true`   → returns `{ config, events: [] }` without touching the DB.
 *   - `leagueSlug` set      → one-league section (MLB/NBA/NHL/FIFA WC).
 *   - `sportRouteSlug` set  → multi-league merge (`'soccer'` → EPL+La Liga+MLS).
 *                             Each league fetches up to `LEAGUE_GRID_SIZE`
 *                             upcoming rows SEQUENTIALLY (peak 2 pooler
 *                             checkouts overall — consistent with Fix A2);
 *                             the union is re-sorted by `gameStartTime` ASC
 *                             and capped at `LEAGUE_GRID_SIZE`.
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
  // sharing the configured sport-route alias. Fetched sequentially so the
  // home-v2 cold-render pooler-checkout peak stays at ~2 regardless of how
  // many leagues co-mingle under one section (consistent with Fix A2's
  // sequential `for...of` over HOME_V2_CATEGORIES).
  if (config.sportRouteSlug) {
    const leagues = getLeaguesBySportRouteSlug(config.sportRouteSlug)
    if (leagues.length === 0) {
      return { config, events: [] }
    }
    const merged: Event[] = []
    for (const league of leagues) {
      const leagueEvents = await fetchSingleLeagueEvents(league.slug, league, LEAGUE_GRID_SIZE)
      merged.push(...leagueEvents)
    }
    // Dedup by event.slug (league-prefixed slugs never collide cross-league,
    // but a defensive dedup costs nothing), re-sort by start time, cap.
    const seen = new Set<string>()
    const deduped = merged.filter((e) => {
      if (seen.has(e.slug)) {
        return false
      }
      seen.add(e.slug)
      return true
    })
    deduped.sort((a, b) => eventStartMs(a) - eventStartMs(b))
    return { config, events: deduped.slice(0, LEAGUE_GRID_SIZE) }
  }

  if (!config.leagueSlug) {
    return { config, events: [] }
  }

  const leagueEntry = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === config.leagueSlug)
  const events = await fetchSingleLeagueEvents(config.leagueSlug, leagueEntry, LEAGUE_GRID_SIZE)
  return { config, events }
}
