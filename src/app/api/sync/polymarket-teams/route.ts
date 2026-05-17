import type { TeamsOnlyLeague } from '@/lib/polymarket/games-leagues'
import { revalidateTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import { z } from 'zod'
import { isCronAuthorized } from '@/lib/auth-cron'
import { cacheTags } from '@/lib/cache-tags'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { POLYMARKET_GAMMA_BASE_DEFAULT } from '@/lib/polymarket/constants'
import { ALL_TEAMS_CACHE_LEAGUES } from '@/lib/polymarket/games-leagues'

// Long-running cron sync — match the legacy Kuest sync routes' ceiling.
export const maxDuration = 300

interface LeagueSyncResult {
  league: string
  status: 'ok' | 'network_error' | 'schema_error' | 'partial'
  team_count?: number
  skipped_count?: number
  error_count?: number
  error?: string
}

interface TeamsSyncResponse {
  ok: boolean
  disabled?: boolean
  message?: string
  league_count?: number
  results?: LeagueSyncResult[]
}

/**
 * Polymarket Gamma `/teams` response schema.
 *
 * Verified against `tests/fixtures/polymarket-gamma-mlb-teams.json` (32 entries
 * — 30 real MLB teams + 2 league-level all-star placeholders, "American" and
 * "National", which are filtered out by `isLeaguePlaceholder` below).
 *
 * Optional fields tolerate Polymarket adding/removing entries on individual
 * teams (e.g., a team without a logo during preseason) — we only require the
 * fields we actually persist.
 */
const TeamSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  league: z.string(),
  abbreviation: z.string(),
  alias: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  record: z.string().optional().nullable(),
})

const TeamsResponseSchema = z.array(TeamSchema)

/**
 * League-level placeholder filter (e.g. MLB returns the All-Star roster
 * placeholders "American" / "National" alongside the 30 real teams). These are
 * NOT real teams and must NOT be persisted to `teams_cache` — the projection
 * layer parses team abbreviations from per-game slugs and would never match
 * these. Three layered tiers, evaluated in order:
 *
 *   Tier 1 (authoritative): the abbreviation matches a known league-level
 *     placeholder, sourced from the league registry's `placeholderAbbreviations`
 *     field (`src/lib/polymarket/games-leagues.ts`). Source-of-truth migration
 *     (Phase B v2 v2): the per-league Set lives on the registry entry, not here.
 *   Tier 2 (always-on belt-and-suspenders): the team name contains the literal
 *     "all-star" substring — catches abbreviations we haven't yet enumerated.
 *   Tier 3 (opt-in heuristic): both `logo` and `color` are null. Per Polymarket
 *     support, placeholder rosters consistently ship with both null — but so do
 *     some real teams (FIFA WC Switzerland, WNBA expansion teams), so this tier
 *     is OPT-IN per-league via `DiscoveredGamesLeague.applyLogoColorPlaceholderHeuristic`.
 *
 * Adding a league: populate `placeholderAbbreviations` on the registry entry;
 * set `applyLogoColorPlaceholderHeuristic: true` only if the league has rotating
 * all-star / international rosters that may introduce new placeholder variants.
 */
function isLeaguePlaceholder(
  team: z.infer<typeof TeamSchema>,
  league: TeamsOnlyLeague,
): boolean {
  const abbr = team.abbreviation.toLowerCase()

  // Tier 1 (authoritative): explicit per-league Set. Workstream-1 caught
  // all-star/exhibition rosters via this mechanism in Phase B v2 v2.
  if (league.placeholderAbbreviations?.has(abbr)) {
    return true
  }

  // Tier 2 (always-on belt-and-suspenders): name-pattern match. Catches
  // rosters whose abbreviation we haven't yet enumerated but whose name
  // string contains the standard "All-Star" tell.
  if (team.name.toLowerCase().includes('all-star')) {
    return true
  }

  // Tier 3 (opt-in heuristic): logo+color absence. Per Polymarket support,
  // placeholder rosters consistently ship with both null. Per the empirical
  // §Investigate.E probe, real teams in FIFA WC (Switzerland) and WNBA
  // (expansion teams) ALSO ship with both null — the heuristic is therefore
  // OPT-IN per-league via `applyLogoColorPlaceholderHeuristic`. Default off.
  if (league.applyLogoColorPlaceholderHeuristic && team.logo == null && team.color == null) {
    return true
  }

  return false
}

function getGammaBase(): string {
  return process.env.POLYMARKET_GAMMA_BASE || POLYMARKET_GAMMA_BASE_DEFAULT
}

const TEAMS_PAGE_LIMIT = 50
// UFC ships ~1000+ fighters under the `ufc` league code; UCL ~491; covers all
// current and foreseeable leagues with comfortable headroom.
const TEAMS_HARD_CAP = 1200

const TEAMS_FETCH_HEADERS = {
  'User-Agent': 'WirePredictions/1.0 (+https://wirepredictions.vercel.app)',
  'Accept': 'application/json',
} as const

type FetchAllTeamsResult
  = | { ok: true, teams: z.infer<typeof TeamSchema>[] }
    | { ok: false, kind: 'network' | 'schema', error: string }

/**
 * NEW-11: paginate `GET /teams?league=<apiCode>&limit&offset` until a short
 * page (fewer than `TEAMS_PAGE_LIMIT` rows) or the hard cap is hit. Mirrors
 * `fetchPolymarketGammaEventsBySeriesPaged` in `client.ts`: a failure on the
 * FIRST page is fatal (`ok: false`); a failure on a LATER page returns the
 * partial accumulation rather than discarding good rows.
 */
async function fetchAllTeams(apiCode: string): Promise<FetchAllTeamsResult> {
  const accumulated: z.infer<typeof TeamSchema>[] = []
  let offset = 0

  while (true) {
    const url = `${getGammaBase()}/teams?league=${encodeURIComponent(apiCode)}&limit=${TEAMS_PAGE_LIMIT}&offset=${offset}`

    let res: Response
    try {
      res = await fetch(url, { cache: 'no-store', headers: TEAMS_FETCH_HEADERS })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return offset === 0 ? { ok: false, kind: 'network', error: message } : { ok: true, teams: accumulated }
    }

    if (!res.ok) {
      return offset === 0
        ? { ok: false, kind: 'network', error: `Gamma /teams returned HTTP ${res.status}` }
        : { ok: true, teams: accumulated }
    }

    let raw: unknown
    try {
      raw = await res.json()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return offset === 0 ? { ok: false, kind: 'schema', error: `JSON parse failed: ${message}` } : { ok: true, teams: accumulated }
    }

    const parsed = TeamsResponseSchema.safeParse(raw)
    if (!parsed.success) {
      return offset === 0
        ? { ok: false, kind: 'schema', error: `Zod validation failed: ${parsed.error.issues.length} issue(s)` }
        : { ok: true, teams: accumulated }
    }

    accumulated.push(...parsed.data)

    if (parsed.data.length < TEAMS_PAGE_LIMIT) {
      break
    }
    if (accumulated.length >= TEAMS_HARD_CAP) {
      console.warn('[polymarket-teams] hard cap reached', { apiCode, count: accumulated.length })
      break
    }
    offset += TEAMS_PAGE_LIMIT
  }

  return { ok: true, teams: accumulated }
}

/**
 * GET / POST /api/sync/polymarket-teams
 *
 * Per-league teams cache sync (Phase B v2). Triggered hourly by pg_cron at :42
 * (rescheduled in PR 1 of the cascade fix sequence, 2026-05-16 — see
 * docs/plans/cascade-fix-plan-2026-05-15.md §PR 1 for the full minute layout).
 * For each enabled Phase B league:
 *   1. Paginates `GET /teams?league=<apiCode>&limit&offset` from Polymarket Gamma
 *   2. Filters out league-level placeholders (e.g. MLB All-Star rosters)
 *   3. Upserts each real team into `teams_cache` keyed by (league, abbreviation)
 *   4. On per-team failure, calls `markFailure` (preserves last-known-good metadata)
 *   5. After per-league processing, invalidates `cacheTags.teamsCache(league)`
 *
 * Default-off via `POLYMARKET_GAMES_DISCOVERY_ENABLED=false` env var (shared
 * with the per-game discovery route — Phase B v2 reuses the same kill switch
 * since teams data only matters when per-game discovery is enabled).
 */
async function handleTeamsSync(request: Request): Promise<NextResponse<TeamsSyncResponse | { error: string }>> {
  // Cache Components: opt this route out of static rendering.
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  // Kill switch — share with per-game discovery. When per-game discovery is
  // disabled, teams sync is moot (nothing reads `teams_cache` until per-game
  // pages render). Operators flip both at once via the same env var.
  const flag = (process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED ?? 'false').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return NextResponse.json({
      ok: true,
      disabled: true,
      message: 'POLYMARKET_GAMES_DISCOVERY_ENABLED is not set to "true". Skipping teams sync.',
    })
  }

  const results: LeagueSyncResult[] = []

  for (const league of ALL_TEAMS_CACHE_LEAGUES) {
    // NEW-10: query `/teams` by the league's Gamma API code when it differs
    // from our registry slug (e.g. La Liga: query `?league=lal`, write
    // `teams_cache(league='laliga')`). All writes and `revalidateTag` calls
    // below stay keyed on `league.slug`.
    const apiCode = league.teamsApiCode ?? league.slug

    const fetched = await fetchAllTeams(apiCode)
    if (!fetched.ok) {
      results.push({
        league: league.slug,
        status: fetched.kind === 'network' ? 'network_error' : 'schema_error',
        error: fetched.error,
      })
      continue
    }

    let teamCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const team of fetched.teams) {
      if (isLeaguePlaceholder(team, league)) {
        skippedCount++
        continue
      }

      try {
        // PreWork.1: persist `league.slug` (the iteration value from the league
        // registry, used to construct the Gamma request) rather than
        // `team.league` from the upstream response. Polymarket can return
        // case/format variants (e.g. "MLB" vs "mlb") on individual rows; the
        // projection layer's `getByAbbreviation(league, abbreviation)` lookup
        // would miss while a row exists under the upstream-formatted league
        // value. Pinning to the registry slug keeps writes and reads symmetric.
        const upsert = await TeamsCacheRepository.upsertSuccess({
          league: league.slug,
          team_id: team.id,
          name: team.name,
          alias: team.alias ?? null,
          abbreviation: team.abbreviation.toLowerCase(),
          logo_url: team.logo ?? null,
          color: team.color ?? null,
          record: team.record ?? null,
        })

        if (upsert.error || !upsert.data) {
          await TeamsCacheRepository.markFailure({
            league: league.slug,
            abbreviation: team.abbreviation.toLowerCase(),
            error: upsert.error || 'upsert returned no row',
          })
          errorCount++
          continue
        }

        teamCount++
      }
      catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        await TeamsCacheRepository.markFailure({
          league: league.slug,
          abbreviation: team.abbreviation.toLowerCase(),
          error: message,
        })
        errorCount++
      }
    }

    // Invalidate cached reads for this league after all upserts complete.
    revalidateTag(cacheTags.teamsCache(league.slug), 'max')

    results.push({
      league: league.slug,
      status: errorCount > 0 ? 'partial' : 'ok',
      team_count: teamCount,
      skipped_count: skippedCount,
      error_count: errorCount,
    })
  }

  return NextResponse.json({
    ok: true,
    league_count: ALL_TEAMS_CACHE_LEAGUES.length,
    results,
  })
}

export async function GET(request: Request) {
  return handleTeamsSync(request)
}

export async function POST(request: Request) {
  return handleTeamsSync(request)
}
